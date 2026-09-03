import { ipcContractVersion } from "@erc-chart/contracts";
import type {
  ProviderNetworkResponse,
  ProviderSubscription,
  ProviderWebSocketConnection,
  ProviderWebSocketHandlers,
} from "@erc-chart/provider-sdk";
import {
  instantiateInstalledProvider,
  planProviderConfigurationChange,
  ProviderRuntimeError,
  type InstalledProviderInstance,
  type ProviderRuntimeHostBroker,
} from "./provider-instance.js";
import {
  isProviderUtilityParentMessage,
  type ProviderUtilityChildMessage,
  type ProviderUtilityDataRequestMessage,
  type ProviderUtilityHostFailureMessage,
  type ProviderUtilityHostResponseMessage,
  type ProviderUtilityParentMessage,
} from "./provider-protocol.js";
import { requireProviderProfileId } from "./provider-profile-id.js";

export interface ProviderUtilityPort {
  readonly postMessage: (message: ProviderUtilityChildMessage) => void;
  readonly onMessage: (listener: (message: unknown) => void) => () => void;
}

export interface ProviderUtilityRuntime {
  readonly providerProfileId: string;
  readonly ready: Promise<InstalledProviderInstance>;
  readonly shutdown: () => void;
}

interface PendingHostRequest<T> {
  readonly kind: "network" | "credential" | "websocket-open";
  readonly socketId?: string;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

function hostFailure(message: ProviderUtilityHostFailureMessage): Error {
  return new Error(`Provider host request failed (${message.code}).`);
}

export function createProviderUtilityRuntime(
  port: ProviderUtilityPort,
  providerProfileIdValue: string,
): ProviderUtilityRuntime {
  const providerProfileId = requireProviderProfileId(providerProfileIdValue);
  let stopped = false;
  let initialized = false;
  let initializationSettled = false;
  let activeInstance: InstalledProviderInstance | undefined;
  let activePermissions:
    Parameters<typeof planProviderConfigurationChange>[3] | undefined;
  let removeListener = (): void => undefined;
  let requestSequence = 0;
  let socketSequence = 0;
  let resolveReady: (value: InstalledProviderInstance) => void = () =>
    undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  const ready = new Promise<InstalledProviderInstance>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const pending = new Map<string, PendingHostRequest<unknown>>();
  const activeSubscriptions = new Map<string, ProviderSubscription>();
  const pendingSubscriptions = new Set<string>();
  const activeWebSockets = new Map<string, ProviderWebSocketHandlers>();

  const rejectPending = (error: Error): void => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  const shutdown = (): void => {
    if (stopped) return;
    stopped = true;
    removeListener();
    rejectPending(new Error("Provider utility stopped."));
    for (const socketId of activeWebSockets.keys()) {
      port.postMessage({
        type: "provider-host-websocket-close",
        contractVersion: ipcContractVersion,
        socketId,
        code: 1000,
        reason: "Provider utility shutdown",
      });
    }
    activeWebSockets.clear();
    if (!initializationSettled)
      rejectReady(new Error("Provider utility stopped before initialization."));
    const subscriptions = [...activeSubscriptions.values()];
    activeSubscriptions.clear();
    pendingSubscriptions.clear();
    if (activeInstance === undefined && subscriptions.length === 0) {
      port.postMessage({
        type: "stopped",
        contractVersion: ipcContractVersion,
      });
      return;
    }
    void (async (): Promise<void> => {
      await Promise.allSettled(
        subscriptions.map((subscription) => subscription.unsubscribe()),
      );
      try {
        await activeInstance?.adapter.disconnect();
      } catch {
        // Shutdown remains bounded by the supervising host even if disconnect fails.
      }
      port.postMessage({
        type: "stopped",
        contractVersion: ipcContractVersion,
      });
    })();
  };

  const fail = (code: string): void => {
    if (stopped) return;
    rejectReady(new Error(code));
    rejectPending(new Error(code));
    port.postMessage({
      type: "error",
      contractVersion: ipcContractVersion,
      code,
    });
  };

  const nextRequestId = (): string => {
    requestSequence += 1;
    return `${providerProfileId}.${requestSequence}`;
  };

  const nextSocketId = (): string => {
    socketSequence += 1;
    return `${providerProfileId}.ws.${socketSequence}`;
  };

  const hostBroker: ProviderRuntimeHostBroker = {
    requestNetwork: async (
      _profileId,
      request,
    ): Promise<ProviderNetworkResponse> => {
      if (stopped) throw new Error("Provider utility is stopped.");
      const requestId = nextRequestId();
      const response = new Promise<ProviderNetworkResponse>(
        (resolve, reject) => {
          pending.set(requestId, {
            kind: "network",
            resolve: resolve as (value: unknown) => void,
            reject,
          });
        },
      );
      port.postMessage({
        type: "provider-host-network-request",
        contractVersion: ipcContractVersion,
        requestId,
        request,
      });
      return response;
    },
    openWebSocket: async (
      _profileId,
      request,
      handlers,
    ): Promise<ProviderWebSocketConnection> => {
      if (stopped) throw new Error("Provider utility is stopped.");
      const requestId = nextRequestId();
      const socketId = nextSocketId();
      activeWebSockets.set(socketId, handlers);
      const opened = new Promise<void>((resolve, reject) => {
        pending.set(requestId, {
          kind: "websocket-open",
          socketId,
          resolve: resolve as (value: unknown) => void,
          reject,
        });
      });
      port.postMessage({
        type: "provider-host-websocket-open-request",
        contractVersion: ipcContractVersion,
        requestId,
        socketId,
        request,
      });
      try {
        await opened;
      } catch (error) {
        activeWebSockets.delete(socketId);
        throw error;
      }
      return Object.freeze({
        send: (
          data: Parameters<ProviderWebSocketConnection["send"]>[0],
        ): void => {
          if (stopped || !activeWebSockets.has(socketId)) return;
          port.postMessage({
            type: "provider-host-websocket-send",
            contractVersion: ipcContractVersion,
            socketId,
            data,
          });
        },
        close: (code?: number, reason?: string): void => {
          if (stopped || !activeWebSockets.has(socketId)) return;
          port.postMessage({
            type: "provider-host-websocket-close",
            contractVersion: ipcContractVersion,
            socketId,
            ...(code === undefined ? {} : { code }),
            ...(reason === undefined ? {} : { reason }),
          });
        },
      });
    },
    getCredential: async (
      _profileId,
      credentialKey,
    ): Promise<string | null> => {
      if (stopped) throw new Error("Provider utility is stopped.");
      const requestId = nextRequestId();
      const response = new Promise<string | null>((resolve, reject) => {
        pending.set(requestId, {
          kind: "credential",
          resolve: resolve as (value: unknown) => void,
          reject,
        });
      });
      port.postMessage({
        type: "provider-host-credential-request",
        contractVersion: ipcContractVersion,
        requestId,
        credentialKey,
      });
      return response;
    },
    log: (_profileId, level, code, metadata): void => {
      if (stopped) return;
      port.postMessage({
        type: "provider-host-log",
        contractVersion: ipcContractVersion,
        level,
        code,
        ...(metadata === undefined ? {} : { metadata }),
      });
    },
    reportStatus: (_profileId, status): void => {
      if (stopped) return;
      port.postMessage({
        type: "provider-host-status",
        contractVersion: ipcContractVersion,
        status,
      });
    },
  };

  const handleHostResponse = (
    message: ProviderUtilityHostResponseMessage,
  ): void => {
    const request = pending.get(message.requestId);
    if (request === undefined) {
      fail("PROVIDER_UTILITY_PROTOCOL_VIOLATION");
      return;
    }
    const expectedType =
      request.kind === "network"
        ? "provider-host-network-response"
        : request.kind === "credential"
          ? "provider-host-credential-response"
          : "provider-host-websocket-open-response";
    if (message.type !== expectedType) {
      pending.delete(message.requestId);
      request.reject(new Error("Provider host response type mismatch."));
      fail("PROVIDER_UTILITY_PROTOCOL_VIOLATION");
      return;
    }
    pending.delete(message.requestId);
    if (!message.ok) {
      request.reject(hostFailure(message));
      return;
    }
    if (message.type === "provider-host-network-response") {
      request.resolve(message.response);
    } else if (message.type === "provider-host-credential-response") {
      request.resolve(message.credential);
    } else {
      if (message.socketId !== request.socketId) {
        request.reject(
          new Error("Provider websocket response socket mismatch."),
        );
        fail("PROVIDER_UTILITY_PROTOCOL_VIOLATION");
        return;
      }
      request.resolve(undefined);
    }
  };

  const handleWebSocketEvent = (
    message: Extract<
      ProviderUtilityParentMessage,
      {
        readonly type:
          | "provider-host-websocket-message"
          | "provider-host-websocket-closed"
          | "provider-host-websocket-error";
      }
    >,
  ): void => {
    const handlers = activeWebSockets.get(message.socketId);
    if (handlers === undefined) return;
    try {
      if (message.type === "provider-host-websocket-message") {
        handlers.onMessage(message.data);
      } else if (message.type === "provider-host-websocket-error") {
        handlers.onError(message.code);
      } else {
        activeWebSockets.delete(message.socketId);
        handlers.onClose({ code: message.code, reason: message.reason });
      }
    } catch {
      // Provider callback failures stay inside the provider lifecycle.
    }
  };

  const dataFailureCode = (error: unknown): string =>
    error instanceof ProviderRuntimeError
      ? error.code
      : "PROVIDER_DATA_OPERATION_FAILED";

  const handleDataRequest = async (
    message: ProviderUtilityDataRequestMessage,
  ): Promise<void> => {
    const instance = activeInstance;
    if (instance === undefined || stopped) {
      fail("PROVIDER_UTILITY_PROTOCOL_VIOLATION");
      return;
    }
    try {
      if (message.type === "provider-capabilities-request") {
        const capabilities = await instance.adapter.getCapabilities();
        if (stopped) return;
        port.postMessage({
          type: "provider-capabilities-response",
          contractVersion: ipcContractVersion,
          requestId: message.requestId,
          ok: true,
          capabilities,
        });
        return;
      }
      if (message.type === "provider-instruments-request") {
        const instruments = await instance.adapter.getInstruments();
        if (stopped) return;
        port.postMessage({
          type: "provider-instruments-response",
          contractVersion: ipcContractVersion,
          requestId: message.requestId,
          ok: true,
          instruments,
        });
        return;
      }
      if (message.type === "provider-history-request") {
        const candles = await instance.adapter.requestHistory(message.request);
        if (stopped) return;
        port.postMessage({
          type: "provider-history-response",
          contractVersion: ipcContractVersion,
          requestId: message.requestId,
          ok: true,
          candles,
        });
        return;
      }
      if (message.type === "provider-subscribe-request") {
        if (
          activeSubscriptions.has(message.subscriptionId) ||
          pendingSubscriptions.has(message.subscriptionId)
        ) {
          port.postMessage({
            type: "provider-subscribe-response",
            contractVersion: ipcContractVersion,
            requestId: message.requestId,
            ok: false,
            code: "PROVIDER_SUBSCRIPTION_DUPLICATE",
          });
          return;
        }
        pendingSubscriptions.add(message.subscriptionId);
        try {
          const subscription = await instance.adapter.subscribe(
            message.request,
            {
              onCandles: (candles): void => {
                if (stopped) return;
                port.postMessage({
                  type: "provider-subscription-candles",
                  contractVersion: ipcContractVersion,
                  subscriptionId: message.subscriptionId,
                  candles,
                });
              },
              onTicks: (ticks): void => {
                if (stopped) return;
                port.postMessage({
                  type: "provider-subscription-ticks",
                  contractVersion: ipcContractVersion,
                  subscriptionId: message.subscriptionId,
                  ticks,
                });
              },
              onError: (code): void => {
                if (stopped) return;
                port.postMessage({
                  type: "provider-subscription-error",
                  contractVersion: ipcContractVersion,
                  subscriptionId: message.subscriptionId,
                  code: /^[A-Z][A-Z0-9_.-]{0,127}$/u.test(code)
                    ? code
                    : "PROVIDER_SUBSCRIPTION_ERROR",
                });
              },
            },
          );
          if (stopped) {
            await subscription.unsubscribe().catch(() => undefined);
            return;
          }
          activeSubscriptions.set(message.subscriptionId, subscription);
          port.postMessage({
            type: "provider-subscribe-response",
            contractVersion: ipcContractVersion,
            requestId: message.requestId,
            ok: true,
          });
        } finally {
          pendingSubscriptions.delete(message.subscriptionId);
        }
        return;
      }
      const subscription = activeSubscriptions.get(message.subscriptionId);
      if (subscription === undefined) {
        port.postMessage({
          type: "provider-unsubscribe-response",
          contractVersion: ipcContractVersion,
          requestId: message.requestId,
          ok: false,
          code: "PROVIDER_SUBSCRIPTION_NOT_FOUND",
        });
        return;
      }
      await subscription.unsubscribe();
      activeSubscriptions.delete(message.subscriptionId);
      if (stopped) return;
      port.postMessage({
        type: "provider-unsubscribe-response",
        contractVersion: ipcContractVersion,
        requestId: message.requestId,
        ok: true,
      });
    } catch (error) {
      if (stopped) return;
      port.postMessage({
        type:
          message.type === "provider-capabilities-request"
            ? "provider-capabilities-response"
            : message.type === "provider-instruments-request"
              ? "provider-instruments-response"
              : message.type === "provider-history-request"
                ? "provider-history-response"
                : message.type === "provider-subscribe-request"
                  ? "provider-subscribe-response"
                  : "provider-unsubscribe-response",
        contractVersion: ipcContractVersion,
        requestId: message.requestId,
        ok: false,
        code: dataFailureCode(error),
      });
    }
  };

  const handleMessage = (message: ProviderUtilityParentMessage): void => {
    if (message.type === "shutdown") {
      shutdown();
      return;
    }
    if (
      message.type === "provider-host-network-response" ||
      message.type === "provider-host-credential-response" ||
      message.type === "provider-host-websocket-open-response"
    ) {
      if (!initialized || stopped) {
        fail("PROVIDER_UTILITY_PROTOCOL_VIOLATION");
        return;
      }
      handleHostResponse(message);
      return;
    }
    if (
      message.type === "provider-host-websocket-message" ||
      message.type === "provider-host-websocket-closed" ||
      message.type === "provider-host-websocket-error"
    ) {
      if (!initialized || stopped) {
        fail("PROVIDER_UTILITY_PROTOCOL_VIOLATION");
        return;
      }
      handleWebSocketEvent(message);
      return;
    }
    if (message.type === "provider-config-validation-request") {
      if (
        activeInstance === undefined ||
        activePermissions === undefined ||
        stopped
      ) {
        fail("PROVIDER_UTILITY_PROTOCOL_VIOLATION");
        return;
      }
      try {
        const plan = planProviderConfigurationChange(
          activeInstance.definition,
          activeInstance.settings,
          message.settings,
          activePermissions,
        );
        port.postMessage({
          type: "provider-config-validation-response",
          contractVersion: ipcContractVersion,
          requestId: message.requestId,
          ok: true,
          impact: plan.impact,
          settings: plan.settings,
          changedKeys: plan.changedKeys,
        });
      } catch (error) {
        port.postMessage({
          type: "provider-config-validation-response",
          contractVersion: ipcContractVersion,
          requestId: message.requestId,
          ok: false,
          code:
            error instanceof ProviderRuntimeError
              ? error.code
              : "PROVIDER_CONFIG_INVALID",
        });
      }
      return;
    }
    if (
      message.type === "provider-capabilities-request" ||
      message.type === "provider-instruments-request" ||
      message.type === "provider-history-request" ||
      message.type === "provider-subscribe-request" ||
      message.type === "provider-unsubscribe-request"
    ) {
      void handleDataRequest(message);
      return;
    }
    if (message.type !== "provider-initialize" || initialized || stopped) {
      fail("PROVIDER_UTILITY_PROTOCOL_VIOLATION");
      return;
    }
    initialized = true;
    void instantiateInstalledProvider({
      providerProfileId,
      ...message.launch,
      hostBroker,
    })
      .then(async (created) => {
        initializationSettled = true;
        if (stopped) return;
        await created.adapter.connect();
        if (stopped) {
          await created.adapter.disconnect().catch(() => undefined);
          return;
        }
        activeInstance = created;
        activePermissions = message.launch.permissions;
        resolveReady(created);
        port.postMessage({
          type: "ready",
          contractVersion: ipcContractVersion,
        });
      })
      .catch((error: unknown) => {
        initializationSettled = true;
        if (stopped) return;
        const code =
          error instanceof ProviderRuntimeError
            ? error.code
            : "PROVIDER_LOAD_FAILED";
        fail(code);
      });
  };

  removeListener = port.onMessage((message) => {
    if (!isProviderUtilityParentMessage(message)) {
      fail("PROVIDER_UTILITY_PROTOCOL_VIOLATION");
      return;
    }
    handleMessage(message);
  });

  return { providerProfileId, ready, shutdown };
}
