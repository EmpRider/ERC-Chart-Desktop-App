import {
  ipcContractVersion,
  isUtilityStatusMessage,
} from "@erc-chart/contracts";
import type { ProviderRuntimeHostBroker } from "./provider-instance.js";
import {
  isProviderUtilityChildMessage,
  type ProviderUtilityChildMessage,
  type ProviderUtilityLaunchDescriptor,
  type ProviderUtilityParentMessage,
} from "./provider-protocol.js";

export type ProviderUtilitySupervisorStatus =
  "idle" | "starting" | "ready" | "stopping" | "stopped" | "failed";

export type ProviderUtilityUnavailableCode =
  "PROVIDER_UTILITY_EXITED" | "PROVIDER_UTILITY_PROTOCOL_VIOLATION";

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
  readonly hostBroker?: ProviderRuntimeHostBroker;
}

export interface ProviderUtilitySupervisor {
  readonly start: (
    providerProfileId: string,
    entryPath: string,
    launch?: ProviderUtilityLaunchDescriptor,
  ) => Promise<void>;
  readonly shutdown: (providerProfileId: string) => Promise<void>;
  readonly shutdownAll: () => Promise<void>;
  readonly getStatus: (
    providerProfileId: string,
  ) => ProviderUtilitySupervisorStatus;
}

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
}

function requireProviderProfileId(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 128
  ) {
    throw new RangeError("Provider profile ID is required.");
  }
  return value;
}

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

  const fail = (
    providerProfileId: string,
    state: ProviderProcessState,
    error: Error | undefined,
    code: ProviderUtilityUnavailableCode | undefined,
    terminateChild: boolean,
  ): void => {
    if (state.status === "failed" || state.status === "stopped") return;
    const wasStarting = state.status === "starting";
    clearTimer(state);
    removeListeners(state);
    if (terminateChild) terminate(state);
    state.child = undefined;
    state.status = "failed";
    if (wasStarting)
      state.rejectStart?.(error ?? new Error("Provider utility failed."));
    state.resolveStart = undefined;
    state.rejectStart = undefined;
    if (code !== undefined) options.onUnavailable(providerProfileId, code);
  };

  const finishStopped = (state: ProviderProcessState): void => {
    clearTimer(state);
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
    launch?: ProviderUtilityLaunchDescriptor,
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
        "provider-host-network-response" | "provider-host-credential-response",
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
        if (options.hostBroker === undefined) {
          postHostFailure(
            "provider-host-network-response",
            message.requestId,
            "PROVIDER_HOST_UNAVAILABLE",
          );
          return true;
        }
        void options.hostBroker
          .requestNetwork(providerProfileId, message.request)
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
          });
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

    try {
      state.child = options.spawn(entryPath, [providerProfileId]);
      state.removeMessage = state.child.onMessage(onMessage);
      state.removeExit = state.child.onExit(onExit);
      if (launch !== undefined) {
        state.child.postMessage({
          type: "provider-initialize",
          contractVersion: ipcContractVersion,
          launch,
        });
      }
    } catch {
      fail(
        providerProfileId,
        state,
        new Error("Provider utility process could not start."),
        undefined,
        true,
      );
      return Promise.reject(
        new Error("Provider utility process could not start."),
      );
    }

    const started = new Promise<void>((resolve, reject) => {
      state.resolveStart = resolve;
      state.rejectStart = reject;
    });
    state.timer = options.scheduler.setTimeout(() => {
      fail(
        providerProfileId,
        state,
        new Error("Provider utility failed to become ready."),
        undefined,
        true,
      );
    }, startupTimeoutMs);
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

  return {
    start,
    shutdown,
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
