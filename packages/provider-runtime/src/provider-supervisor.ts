import {
  ipcContractVersion,
  isUtilityStatusMessage,
  type Candle,
} from "@erc-chart/contracts";
import type {
  ProviderCapabilities,
  ProviderDataSink,
  ProviderHistoryRequest,
  ProviderInstrument,
  ProviderSubscription,
  ProviderSubscriptionRequest,
  ProviderWebSocketConnection,
} from "@erc-chart/provider-sdk";
import type {
  ProviderConfigurationChangeImpact,
  ProviderRuntimeHostBroker,
} from "./provider-instance.js";
import { isProviderNetworkRequestAllowed } from "./provider-permissions.js";
import { requireProviderProfileId } from "./provider-profile-id.js";
import {
  isProviderUtilityChildMessage,
  type ProviderUtilityChildMessage,
  type ProviderUtilityDataRequestMessage,
  type ProviderUtilityDataResponseMessage,
  type ProviderUtilityLaunchDescriptor,
  type ProviderUtilityParentMessage,
} from "./provider-protocol.js";

export type ProviderUtilitySupervisorStatus =
  "idle" | "starting" | "ready" | "stopping" | "stopped" | "failed";

export type ProviderUtilityUnavailableCode =
  "PROVIDER_UTILITY_EXITED" | "PROVIDER_UTILITY_PROTOCOL_VIOLATION";

export type ProviderProfileLifecycleErrorCode =
  | "PROVIDER_PROFILE_NOT_READY"
  | "PROVIDER_PROFILE_CONFIG_BUSY"
  | "PROVIDER_PROFILE_CONFIG_INVALID"
  | "PROVIDER_PROFILE_CONFIG_VALIDATION_FAILED"
  | "PROVIDER_PROFILE_INVALIDATION_FAILED"
  | "PROVIDER_PROFILE_RESTART_FAILED"
  | "PROVIDER_PROFILE_RECOVERY_FAILED"
  | "PROVIDER_PROFILE_RESTORE_FAILED";

export class ProviderProfileLifecycleError extends Error {
  readonly code: ProviderProfileLifecycleErrorCode;

  constructor(code: ProviderProfileLifecycleErrorCode, message: string) {
    super(message);
    this.name = "ProviderProfileLifecycleError";
    this.code = code;
  }
}

export interface ProviderProfileConfigurationChangeResult {
  readonly impact: ProviderConfigurationChangeImpact;
  readonly settings: Readonly<Record<string, boolean | number | string>>;
  readonly changedKeys: readonly string[];
}

export interface ProviderUtilityChild {
  readonly postMessage: (message: ProviderUtilityParentMessage) => void;
  readonly kill: () => void;
  readonly onMessage: (listener: (message: unknown) => void) => () => void;
  readonly onExit: (listener: (code: number | null) => void) => () => void;
}

export interface ProviderUtilityScheduler {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (timer: unknown) => void;
}

export interface ProviderUtilitySupervisorOptions {
  readonly spawn: (
    entryPath: string,
    args: readonly string[],
  ) => ProviderUtilityChild;
  readonly scheduler: ProviderUtilityScheduler;
  readonly startupTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly onUnavailable: (
    providerProfileId: string,
    code: ProviderUtilityUnavailableCode,
  ) => void;
  readonly onProfileInvalidated?: (
    providerProfileId: string,
    impact: Exclude<ProviderConfigurationChangeImpact, "none">,
  ) => void | Promise<void>;
  readonly onProfileRestored?: (
    providerProfileId: string,
    impact: Exclude<ProviderConfigurationChangeImpact, "none">,
  ) => void | Promise<void>;
  readonly hostBroker?: ProviderRuntimeHostBroker;
}

export interface ProviderUtilitySupervisor {
  readonly start: (
    providerProfileId: string,
    entryPath: string,
    launch: ProviderUtilityLaunchDescriptor,
  ) => Promise<void>;
  readonly reconfigure: (
    providerProfileId: string,
    settings: Readonly<Record<string, boolean | number | string>>,
  ) => Promise<ProviderProfileConfigurationChangeResult>;
  readonly shutdown: (providerProfileId: string) => Promise<void>;
  readonly shutdownAll: () => Promise<void>;
  readonly getStatus: (
    providerProfileId: string,
  ) => ProviderUtilitySupervisorStatus;
  readonly getCapabilities: (
    providerProfileId: string,
  ) => Promise<ProviderCapabilities>;
  readonly getInstruments: (
    providerProfileId: string,
  ) => Promise<readonly ProviderInstrument[]>;
  readonly requestHistory: (
    providerProfileId: string,
    request: ProviderHistoryRequest,
  ) => Promise<readonly Candle[]>;
  readonly subscribe: (
    providerProfileId: string,
    request: ProviderSubscriptionRequest,
    sink: ProviderDataSink,
  ) => Promise<ProviderSubscription>;
}

interface PendingProviderDataRequest {
  readonly expectedType: ProviderUtilityDataResponseMessage["type"];
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

type ProviderUtilityDataRequestPayload =
  ProviderUtilityDataRequestMessage extends infer Message
    ? Message extends ProviderUtilityDataRequestMessage
      ? Omit<Message, "contractVersion" | "requestId">
      : never
    : never;

interface ProviderProcessState {
  status: ProviderUtilitySupervisorStatus;
  child: ProviderUtilityChild | undefined;
  timer: unknown | undefined;
  removeMessage: () => void;
  removeExit: () => void;
  resolveStart: (() => void) | undefined;
  rejectStart: ((error: Error) => void) | undefined;
  resolveShutdown: (() => void) | undefined;
  shutdownPromise: Promise<void> | undefined;
  permissions: ProviderUtilityLaunchDescriptor["permissions"] | undefined;
  inFlightNetwork: Set<AbortController>;
  activeWebSockets: Map<string, ProviderWebSocketConnection>;
  openingWebSockets: Set<string>;
  entryPath: string;
  launch: ProviderUtilityLaunchDescriptor;
  configRequestSequence: number;
  pendingConfiguration:
    | {
        readonly requestId: string;
        readonly resolve: (
          result: ProviderProfileConfigurationChangeResult,
        ) => void;
        readonly reject: (error: Error) => void;
      }
    | undefined;
  dataRequestSequence: number;
  subscriptionSequence: number;
  pendingData: Map<string, PendingProviderDataRequest>;
  subscriptionSinks: Map<string, ProviderDataSink>;
}

const maximumProviderNetworkRequestsPerProfile = 8;
const maximumProviderWebSocketsPerProfile = 4;

function requireTimeout(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${label} must be a positive safe integer.`);
  return value;
}

export function createProviderUtilitySupervisor(
  options: ProviderUtilitySupervisorOptions,
): ProviderUtilitySupervisor {
  const startupTimeoutMs = requireTimeout(
    options.startupTimeoutMs,
    "Provider startup timeout",
  );
  const shutdownTimeoutMs = requireTimeout(
    options.shutdownTimeoutMs,
    "Provider shutdown timeout",
  );
  const states = new Map<string, ProviderProcessState>();
  const reconfiguringProfiles = new Set<string>();

  const clearTimer = (state: ProviderProcessState): void => {
    if (state.timer === undefined) return;
    options.scheduler.clearTimeout(state.timer);
    state.timer = undefined;
  };

  const removeListeners = (state: ProviderProcessState): void => {
    const removeMessage = state.removeMessage;
    const removeExit = state.removeExit;
    state.removeMessage = (): void => undefined;
    state.removeExit = (): void => undefined;
    try {
      removeMessage();
    } catch {
      // Listener cleanup must not corrupt another provider lifecycle.
    }
    try {
      removeExit();
    } catch {
      // Listener cleanup must not corrupt another provider lifecycle.
    }
  };

  const terminate = (state: ProviderProcessState): void => {
    try {
      state.child?.kill();
    } catch {
      // The supervisor still fails closed if process termination reports failure.
    }
  };

  const abortInFlightNetwork = (state: ProviderProcessState): void => {
    for (const controller of state.inFlightNetwork) controller.abort();
    state.inFlightNetwork.clear();
  };

  const closeActiveWebSockets = (state: ProviderProcessState): void => {
    for (const connection of state.activeWebSockets.values()) {
      try {
        connection.close(1001, "Provider host shutdown");
      } catch {
        // Socket cleanup remains best-effort during provider teardown.
      }
    }
    state.activeWebSockets.clear();
    state.openingWebSockets.clear();
  };

  const rejectPendingConfiguration = (
    state: ProviderProcessState,
    error: Error,
  ): void => {
    state.pendingConfiguration?.reject(error);
    state.pendingConfiguration = undefined;
  };

  const rejectPendingData = (
    state: ProviderProcessState,
    error: Error,
  ): void => {
    for (const request of state.pendingData.values()) request.reject(error);
    state.pendingData.clear();
  };

  const clearSubscriptionSinks = (
    state: ProviderProcessState,
    code: string,
  ): void => {
    for (const sink of state.subscriptionSinks.values()) {
      try {
        sink.onError(code);
      } catch {
        // A downstream observer cannot corrupt provider process cleanup.
      }
    }
    state.subscriptionSinks.clear();
  };

  const fail = (
    providerProfileId: string,
    state: ProviderProcessState,
    error: Error | undefined,
    code: ProviderUtilityUnavailableCode | undefined,
    terminateChild: boolean,
  ): void => {
    if (state.status === "failed" || state.status === "stopped") return;
    const wasStarting = state.status === "starting";
    const wasStopping = state.status === "stopping";
    clearTimer(state);
    abortInFlightNetwork(state);
    closeActiveWebSockets(state);
    rejectPendingConfiguration(
      state,
      error ?? new Error("Provider utility became unavailable."),
    );
    rejectPendingData(
      state,
      error ?? new Error("Provider utility became unavailable."),
    );
    clearSubscriptionSinks(state, "PROVIDER_UTILITY_UNAVAILABLE");
    removeListeners(state);
    if (terminateChild) terminate(state);
    state.child = undefined;
    state.status = "failed";
    if (wasStarting)
      state.rejectStart?.(error ?? new Error("Provider utility failed."));
    state.resolveStart = undefined;
    state.rejectStart = undefined;
    if (wasStopping) state.resolveShutdown?.();
    state.resolveShutdown = undefined;
    state.shutdownPromise = undefined;
    if (code !== undefined) options.onUnavailable(providerProfileId, code);
  };

  const finishStopped = (state: ProviderProcessState): void => {
    clearTimer(state);
    abortInFlightNetwork(state);
    closeActiveWebSockets(state);
    rejectPendingConfiguration(
      state,
      new Error("Provider utility stopped during configuration validation."),
    );
    rejectPendingData(state, new Error("Provider utility stopped."));
    clearSubscriptionSinks(state, "PROVIDER_UTILITY_STOPPED");
    removeListeners(state);
    state.child = undefined;
    state.status = "stopped";
    state.resolveShutdown?.();
    state.resolveShutdown = undefined;
    state.shutdownPromise = undefined;
  };

  const start = (
    providerProfileIdValue: string,
    entryPath: string,
    launch: ProviderUtilityLaunchDescriptor,
  ): Promise<void> => {
    const providerProfileId = requireProviderProfileId(providerProfileIdValue);
    if (typeof entryPath !== "string" || entryPath.trim() === "")
      return Promise.reject(
        new RangeError("Provider utility entry path is required."),
      );
    const existing = states.get(providerProfileId);
    if (
      existing !== undefined &&
      !["failed", "stopped"].includes(existing.status)
    ) {
      return Promise.reject(new Error("Provider utility is already active."));
    }

    const state: ProviderProcessState = {
      status: "starting",
      child: undefined,
      timer: undefined,
      removeMessage: (): void => undefined,
      removeExit: (): void => undefined,
      resolveStart: undefined,
      rejectStart: undefined,
      resolveShutdown: undefined,
      shutdownPromise: undefined,
      permissions: launch.permissions,
      inFlightNetwork: new Set(),
      activeWebSockets: new Map(),
      openingWebSockets: new Set(),
      entryPath,
      launch,
      configRequestSequence: 0,
      pendingConfiguration: undefined,
      dataRequestSequence: 0,
      subscriptionSequence: 0,
      pendingData: new Map(),
      subscriptionSinks: new Map(),
    };
    states.set(providerProfileId, state);

    const protocolViolation = (): void =>
      fail(
        providerProfileId,
        state,
        new Error("Provider utility protocol violation."),
        "PROVIDER_UTILITY_PROTOCOL_VIOLATION",
        true,
      );

    const postHostFailure = (
      type:
        | "provider-host-network-response"
        | "provider-host-credential-response"
        | "provider-host-websocket-open-response",
      requestId: string,
      code: string,
    ): void => {
      try {
        state.child?.postMessage({
          type,
          contractVersion: ipcContractVersion,
          requestId,
          ok: false,
          code,
        });
      } catch {
        fail(
          providerProfileId,
          state,
          new Error("Provider host response could not be delivered."),
          "PROVIDER_UTILITY_PROTOCOL_VIOLATION",
          true,
        );
      }
    };

    const handleHostMessage = (
      message: ProviderUtilityChildMessage,
    ): boolean => {
      if (isUtilityStatusMessage(message)) return false;
      if (state.status !== "starting" && state.status !== "ready") {
        protocolViolation();
        return true;
      }
      if (message.type === "provider-config-validation-response") {
        const pending = state.pendingConfiguration;
        if (
          state.status !== "ready" ||
          pending === undefined ||
          pending.requestId !== message.requestId
        ) {
          protocolViolation();
          return true;
        }
        state.pendingConfiguration = undefined;
        if (!message.ok) {
          pending.reject(
            new ProviderProfileLifecycleError(
              "PROVIDER_PROFILE_CONFIG_INVALID",
              "Provider configuration was rejected by the provider schema.",
            ),
          );
          return true;
        }
        pending.resolve({
          impact: message.impact,
          settings: message.settings,
          changedKeys: message.changedKeys,
        });
        return true;
      }
      if (
        message.type === "provider-capabilities-response" ||
        message.type === "provider-instruments-response" ||
        message.type === "provider-history-response" ||
        message.type === "provider-subscribe-response" ||
        message.type === "provider-unsubscribe-response"
      ) {
        const pending = state.pendingData.get(message.requestId);
        if (
          state.status !== "ready" ||
          pending === undefined ||
          pending.expectedType !== message.type
        ) {
          protocolViolation();
          return true;
        }
        state.pendingData.delete(message.requestId);
        if (!message.ok) {
          const error = new Error(
            `Provider data operation failed (${message.code}).`,
          );
          Object.assign(error, { code: message.code });
          pending.reject(error);
          return true;
        }
        if (message.type === "provider-capabilities-response") {
          pending.resolve(message.capabilities);
        } else if (message.type === "provider-instruments-response") {
          pending.resolve(message.instruments);
        } else if (message.type === "provider-history-response") {
          pending.resolve(message.candles);
        } else {
          pending.resolve(undefined);
        }
        return true;
      }
      if (
        message.type === "provider-subscription-candles" ||
        message.type === "provider-subscription-ticks" ||
        message.type === "provider-subscription-error"
      ) {
        const sink = state.subscriptionSinks.get(message.subscriptionId);
        if (state.status !== "ready" || sink === undefined) {
          protocolViolation();
          return true;
        }
        try {
          if (message.type === "provider-subscription-candles") {
            sink.onCandles(message.candles);
          } else if (message.type === "provider-subscription-ticks") {
            sink.onTicks(message.ticks);
          } else {
            sink.onError(message.code);
          }
        } catch {
          // Consumer failures do not own provider process lifetime.
        }
        return true;
      }
      if (message.type === "provider-host-log") {
        try {
          options.hostBroker?.log(
            providerProfileId,
            message.level,
            message.code,
            message.metadata,
          );
        } catch {
          // Logging failures must not terminate a healthy provider process.
        }
        return true;
      }
      if (message.type === "provider-host-status") {
        try {
          options.hostBroker?.reportStatus(providerProfileId, message.status);
        } catch {
          // Status observers are diagnostics and must not own provider lifetime.
        }
        return true;
      }
      if (message.type === "provider-host-network-request") {
        if (
          state.permissions === undefined ||
          !isProviderNetworkRequestAllowed(
            message.request.url,
            state.permissions.network,
          )
        ) {
          postHostFailure(
            "provider-host-network-response",
            message.requestId,
            "PROVIDER_PERMISSION_DENIED",
          );
          return true;
        }
        if (options.hostBroker === undefined) {
          postHostFailure(
            "provider-host-network-response",
            message.requestId,
            "PROVIDER_HOST_UNAVAILABLE",
          );
          return true;
        }
        if (
          state.inFlightNetwork.size >= maximumProviderNetworkRequestsPerProfile
        ) {
          postHostFailure(
            "provider-host-network-response",
            message.requestId,
            "PROVIDER_HOST_NETWORK_FAILED",
          );
          return true;
        }
        const controller = new AbortController();
        state.inFlightNetwork.add(controller);
        let networkRequest: ReturnType<
          ProviderRuntimeHostBroker["requestNetwork"]
        >;
        try {
          networkRequest = options.hostBroker.requestNetwork(
            providerProfileId,
            message.request,
            controller.signal,
          );
        } catch {
          state.inFlightNetwork.delete(controller);
          postHostFailure(
            "provider-host-network-response",
            message.requestId,
            "PROVIDER_HOST_NETWORK_FAILED",
          );
          return true;
        }
        void networkRequest
          .then((response) => {
            if (state.status !== "starting" && state.status !== "ready") return;
            state.child?.postMessage({
              type: "provider-host-network-response",
              contractVersion: ipcContractVersion,
              requestId: message.requestId,
              ok: true,
              response,
            });
          })
          .catch(() => {
            if (state.status !== "starting" && state.status !== "ready") return;
            postHostFailure(
              "provider-host-network-response",
              message.requestId,
              "PROVIDER_HOST_NETWORK_FAILED",
            );
          })
          .finally(() => state.inFlightNetwork.delete(controller));
        return true;
      }
      if (message.type === "provider-host-websocket-open-request") {
        if (
          state.permissions === undefined ||
          !isProviderNetworkRequestAllowed(
            message.request.url,
            state.permissions.network,
          )
        ) {
          postHostFailure(
            "provider-host-websocket-open-response",
            message.requestId,
            "PROVIDER_PERMISSION_DENIED",
          );
          return true;
        }
        if (options.hostBroker?.openWebSocket === undefined) {
          postHostFailure(
            "provider-host-websocket-open-response",
            message.requestId,
            "PROVIDER_HOST_UNAVAILABLE",
          );
          return true;
        }
        if (
          state.activeWebSockets.has(message.socketId) ||
          state.openingWebSockets.has(message.socketId) ||
          state.activeWebSockets.size + state.openingWebSockets.size >=
            maximumProviderWebSocketsPerProfile
        ) {
          postHostFailure(
            "provider-host-websocket-open-response",
            message.requestId,
            "PROVIDER_HOST_WEBSOCKET_FAILED",
          );
          return true;
        }
        state.openingWebSockets.add(message.socketId);
        const queued: ProviderUtilityParentMessage[] = [];
        let opened = false;
        const deliver = (event: ProviderUtilityParentMessage): void => {
          if (!opened) {
            queued.push(event);
            return;
          }
          if (state.status !== "starting" && state.status !== "ready") return;
          try {
            state.child?.postMessage(event);
          } catch {
            protocolViolation();
          }
        };
        void options.hostBroker
          .openWebSocket(providerProfileId, message.request, {
            onMessage: (data): void =>
              deliver({
                type: "provider-host-websocket-message",
                contractVersion: ipcContractVersion,
                socketId: message.socketId,
                data,
              }),
            onError: (code): void =>
              deliver({
                type: "provider-host-websocket-error",
                contractVersion: ipcContractVersion,
                socketId: message.socketId,
                code,
              }),
            onClose: (event): void => {
              state.activeWebSockets.delete(message.socketId);
              state.openingWebSockets.delete(message.socketId);
              deliver({
                type: "provider-host-websocket-closed",
                contractVersion: ipcContractVersion,
                socketId: message.socketId,
                code: event.code,
                reason: event.reason,
              });
            },
          })
          .then((connection) => {
            state.openingWebSockets.delete(message.socketId);
            if (state.status !== "starting" && state.status !== "ready") {
              connection.close(1001, "Provider no longer active");
              return;
            }
            state.activeWebSockets.set(message.socketId, connection);
            state.child?.postMessage({
              type: "provider-host-websocket-open-response",
              contractVersion: ipcContractVersion,
              requestId: message.requestId,
              ok: true,
              socketId: message.socketId,
            });
            opened = true;
            for (const event of queued.splice(0)) deliver(event);
          })
          .catch(() => {
            state.openingWebSockets.delete(message.socketId);
            if (state.status !== "starting" && state.status !== "ready") return;
            postHostFailure(
              "provider-host-websocket-open-response",
              message.requestId,
              "PROVIDER_HOST_WEBSOCKET_FAILED",
            );
          });
        return true;
      }
      if (message.type === "provider-host-websocket-send") {
        const connection = state.activeWebSockets.get(message.socketId);
        if (connection === undefined) {
          protocolViolation();
          return true;
        }
        try {
          connection.send(message.data);
        } catch {
          try {
            state.child?.postMessage({
              type: "provider-host-websocket-error",
              contractVersion: ipcContractVersion,
              socketId: message.socketId,
              code: "PROVIDER_HOST_WEBSOCKET_SEND_FAILED",
            });
          } catch {
            protocolViolation();
          }
        }
        return true;
      }
      if (message.type === "provider-host-websocket-close") {
        const connection = state.activeWebSockets.get(message.socketId);
        if (connection === undefined) {
          protocolViolation();
          return true;
        }
        try {
          connection.close(message.code, message.reason);
        } catch {
          state.activeWebSockets.delete(message.socketId);
        }
        return true;
      }
      if (message.type === "provider-host-credential-request") {
        if (
          state.permissions === undefined ||
          !state.permissions.credentials.includes(message.credentialKey)
        ) {
          postHostFailure(
            "provider-host-credential-response",
            message.requestId,
            "PROVIDER_PERMISSION_DENIED",
          );
          return true;
        }
        if (options.hostBroker === undefined) {
          postHostFailure(
            "provider-host-credential-response",
            message.requestId,
            "PROVIDER_HOST_UNAVAILABLE",
          );
          return true;
        }
        void options.hostBroker
          .getCredential(providerProfileId, message.credentialKey)
          .then((credential) => {
            if (state.status !== "starting" && state.status !== "ready") return;
            state.child?.postMessage({
              type: "provider-host-credential-response",
              contractVersion: ipcContractVersion,
              requestId: message.requestId,
              ok: true,
              credential,
            });
          })
          .catch(() => {
            if (state.status !== "starting" && state.status !== "ready") return;
            postHostFailure(
              "provider-host-credential-response",
              message.requestId,
              "PROVIDER_HOST_CREDENTIAL_FAILED",
            );
          });
        return true;
      }
      return false;
    };

    const onMessage = (message: unknown): void => {
      if (!isProviderUtilityChildMessage(message)) {
        protocolViolation();
        return;
      }
      if (handleHostMessage(message)) return;
      if (message.type === "ready" && state.status === "starting") {
        clearTimer(state);
        state.status = "ready";
        state.resolveStart?.();
        state.resolveStart = undefined;
        state.rejectStart = undefined;
        return;
      }
      if (message.type === "error" && state.status === "starting") {
        fail(
          providerProfileId,
          state,
          new Error("Provider utility reported a startup error."),
          undefined,
          true,
        );
        return;
      }
      if (message.type === "stopped" && state.status === "stopping") {
        finishStopped(state);
        return;
      }
      protocolViolation();
    };

    const onExit = (): void => {
      if (state.status === "starting") {
        fail(
          providerProfileId,
          state,
          new Error("Provider utility exited before ready."),
          undefined,
          false,
        );
      } else if (state.status === "ready") {
        fail(
          providerProfileId,
          state,
          undefined,
          "PROVIDER_UTILITY_EXITED",
          false,
        );
      } else if (state.status === "stopping") {
        finishStopped(state);
      }
    };

    const started = new Promise<void>((resolve, reject) => {
      state.resolveStart = resolve;
      state.rejectStart = reject;
    });
    try {
      state.child = options.spawn(entryPath, [providerProfileId]);
      state.removeMessage = state.child.onMessage(onMessage);
      state.removeExit = state.child.onExit(onExit);
      state.timer = options.scheduler.setTimeout(() => {
        fail(
          providerProfileId,
          state,
          new Error("Provider utility failed to become ready."),
          undefined,
          true,
        );
      }, startupTimeoutMs);
      state.child.postMessage({
        type: "provider-initialize",
        contractVersion: ipcContractVersion,
        launch,
      });
    } catch {
      fail(
        providerProfileId,
        state,
        new Error("Provider utility process could not start."),
        undefined,
        true,
      );
      return started;
    }
    return started;
  };

  const shutdown = (providerProfileIdValue: string): Promise<void> => {
    const providerProfileId = requireProviderProfileId(providerProfileIdValue);
    const state = states.get(providerProfileId);
    if (
      state === undefined ||
      state.status === "idle" ||
      state.status === "stopped"
    )
      return Promise.resolve();
    if (state.status === "stopping")
      return state.shutdownPromise ?? Promise.resolve();
    if (state.status === "starting") {
      fail(
        providerProfileId,
        state,
        new Error("Provider utility stopped during startup."),
        undefined,
        true,
      );
      state.status = "stopped";
      return Promise.resolve();
    }
    if (state.status === "failed") {
      state.status = "stopped";
      return Promise.resolve();
    }

    state.status = "stopping";
    abortInFlightNetwork(state);
    state.shutdownPromise = new Promise<void>((resolve) => {
      state.resolveShutdown = resolve;
    });
    try {
      state.child?.postMessage({
        type: "shutdown",
        contractVersion: ipcContractVersion,
      });
    } catch {
      terminate(state);
      finishStopped(state);
      return state.shutdownPromise ?? Promise.resolve();
    }
    state.timer = options.scheduler.setTimeout(() => {
      terminate(state);
      finishStopped(state);
    }, shutdownTimeoutMs);
    return state.shutdownPromise;
  };

  const validateConfiguration = (
    state: ProviderProcessState,
    settings: Readonly<Record<string, boolean | number | string>>,
  ): Promise<ProviderProfileConfigurationChangeResult> => {
    if (state.status !== "ready" || state.child === undefined) {
      return Promise.reject(
        new ProviderProfileLifecycleError(
          "PROVIDER_PROFILE_NOT_READY",
          "Provider profile must be ready before it can be reconfigured.",
        ),
      );
    }
    if (state.pendingConfiguration !== undefined) {
      return Promise.reject(
        new ProviderProfileLifecycleError(
          "PROVIDER_PROFILE_CONFIG_BUSY",
          "Provider profile configuration is already being validated.",
        ),
      );
    }
    state.configRequestSequence += 1;
    const requestId = `cfg.${state.configRequestSequence}`;
    const pending = new Promise<ProviderProfileConfigurationChangeResult>(
      (resolve, reject) => {
        state.pendingConfiguration = { requestId, resolve, reject };
      },
    );
    try {
      state.child.postMessage({
        type: "provider-config-validation-request",
        contractVersion: ipcContractVersion,
        requestId,
        settings,
      });
    } catch {
      rejectPendingConfiguration(
        state,
        new Error(
          "Provider configuration validation request could not be delivered.",
        ),
      );
    }
    return pending;
  };

  const requireReadyState = (
    providerProfileIdValue: string,
  ): ProviderProcessState => {
    const providerProfileId = requireProviderProfileId(providerProfileIdValue);
    const state = states.get(providerProfileId);
    if (state?.status !== "ready" || state.child === undefined) {
      throw new ProviderProfileLifecycleError(
        "PROVIDER_PROFILE_NOT_READY",
        "Provider profile must be ready before requesting provider data.",
      );
    }
    return state;
  };

  const sendDataRequest = <T>(
    state: ProviderProcessState,
    expectedType: ProviderUtilityDataResponseMessage["type"],
    message: ProviderUtilityDataRequestPayload,
  ): Promise<T> => {
    state.dataRequestSequence += 1;
    const requestId = `data.${state.dataRequestSequence}`;
    const pending = new Promise<T>((resolve, reject) => {
      state.pendingData.set(requestId, {
        expectedType,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    });
    try {
      state.child?.postMessage({
        ...message,
        contractVersion: ipcContractVersion,
        requestId,
      } as ProviderUtilityParentMessage);
    } catch {
      const request = state.pendingData.get(requestId);
      state.pendingData.delete(requestId);
      request?.reject(
        new Error("Provider data request could not be delivered."),
      );
    }
    return pending;
  };

  const getCapabilities = (
    providerProfileId: string,
  ): Promise<ProviderCapabilities> =>
    sendDataRequest<ProviderCapabilities>(
      requireReadyState(providerProfileId),
      "provider-capabilities-response",
      { type: "provider-capabilities-request" },
    );

  const getInstruments = (
    providerProfileId: string,
  ): Promise<readonly ProviderInstrument[]> =>
    sendDataRequest<readonly ProviderInstrument[]>(
      requireReadyState(providerProfileId),
      "provider-instruments-response",
      { type: "provider-instruments-request" },
    );

  const requestHistory = (
    providerProfileId: string,
    request: ProviderHistoryRequest,
  ): Promise<readonly Candle[]> =>
    sendDataRequest<readonly Candle[]>(
      requireReadyState(providerProfileId),
      "provider-history-response",
      { type: "provider-history-request", request },
    );

  const subscribe = async (
    providerProfileIdValue: string,
    request: ProviderSubscriptionRequest,
    sink: ProviderDataSink,
  ): Promise<ProviderSubscription> => {
    const providerProfileId = requireProviderProfileId(providerProfileIdValue);
    const state = requireReadyState(providerProfileId);
    state.subscriptionSequence += 1;
    const subscriptionId = `sub.${state.subscriptionSequence}`;
    state.subscriptionSinks.set(subscriptionId, sink);
    try {
      await sendDataRequest<undefined>(state, "provider-subscribe-response", {
        type: "provider-subscribe-request",
        subscriptionId,
        request,
      });
    } catch (error) {
      state.subscriptionSinks.delete(subscriptionId);
      throw error;
    }

    let disposed = false;
    return {
      unsubscribe: async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        if (
          states.get(providerProfileId) !== state ||
          state.status !== "ready"
        ) {
          state.subscriptionSinks.delete(subscriptionId);
          return;
        }
        try {
          await sendDataRequest<undefined>(
            state,
            "provider-unsubscribe-response",
            {
              type: "provider-unsubscribe-request",
              subscriptionId,
            },
          );
        } finally {
          state.subscriptionSinks.delete(subscriptionId);
        }
      },
    };
  };

  const reconfigure = async (
    providerProfileIdValue: string,
    settings: Readonly<Record<string, boolean | number | string>>,
  ): Promise<ProviderProfileConfigurationChangeResult> => {
    const providerProfileId = requireProviderProfileId(providerProfileIdValue);
    if (reconfiguringProfiles.has(providerProfileId)) {
      throw new ProviderProfileLifecycleError(
        "PROVIDER_PROFILE_CONFIG_BUSY",
        "Provider profile configuration is already being changed.",
      );
    }
    const state = states.get(providerProfileId);
    if (state === undefined) {
      throw new ProviderProfileLifecycleError(
        "PROVIDER_PROFILE_NOT_READY",
        "Provider profile must be ready before it can be reconfigured.",
      );
    }
    reconfiguringProfiles.add(providerProfileId);
    try {
      let plan: ProviderProfileConfigurationChangeResult;
      try {
        plan = await validateConfiguration(state, settings);
      } catch (error) {
        if (error instanceof ProviderProfileLifecycleError) throw error;
        throw new ProviderProfileLifecycleError(
          "PROVIDER_PROFILE_CONFIG_VALIDATION_FAILED",
          "Provider configuration could not be validated.",
        );
      }
      if (plan.impact === "none") return plan;

      const impact = plan.impact;
      const previousEntryPath = state.entryPath;
      const previousLaunch = state.launch;
      const nextLaunch: ProviderUtilityLaunchDescriptor = {
        ...previousLaunch,
        settings: plan.settings,
      };
      try {
        await options.onProfileInvalidated?.(providerProfileId, impact);
      } catch {
        throw new ProviderProfileLifecycleError(
          "PROVIDER_PROFILE_INVALIDATION_FAILED",
          "Provider profile dependencies could not be invalidated.",
        );
      }

      await shutdown(providerProfileId);
      try {
        await start(providerProfileId, previousEntryPath, nextLaunch);
      } catch {
        try {
          await start(providerProfileId, previousEntryPath, previousLaunch);
          await options.onProfileRestored?.(providerProfileId, impact);
        } catch {
          throw new ProviderProfileLifecycleError(
            "PROVIDER_PROFILE_RECOVERY_FAILED",
            "Provider profile failed to restart and the previous configuration could not be restored.",
          );
        }
        throw new ProviderProfileLifecycleError(
          "PROVIDER_PROFILE_RESTART_FAILED",
          "Provider profile rejected the updated configuration and the previous configuration was restored.",
        );
      }

      try {
        await options.onProfileRestored?.(providerProfileId, impact);
      } catch {
        throw new ProviderProfileLifecycleError(
          "PROVIDER_PROFILE_RESTORE_FAILED",
          "Provider profile restarted but downstream subscriptions could not be restored.",
        );
      }
      return plan;
    } finally {
      reconfiguringProfiles.delete(providerProfileId);
    }
  };

  return {
    start,
    reconfigure,
    shutdown,
    getCapabilities,
    getInstruments,
    requestHistory,
    subscribe,
    shutdownAll: async (): Promise<void> => {
      await Promise.all(
        [...states.keys()].map((profileId) => shutdown(profileId)),
      );
    },
    getStatus: (providerProfileIdValue): ProviderUtilitySupervisorStatus => {
      const providerProfileId = requireProviderProfileId(
        providerProfileIdValue,
      );
      return states.get(providerProfileId)?.status ?? "idle";
    },
  };
}
