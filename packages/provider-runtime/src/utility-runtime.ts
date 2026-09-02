import { ipcContractVersion } from "@erc-chart/contracts";
import type { ProviderNetworkResponse } from "@erc-chart/provider-sdk";
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
  readonly kind: "network" | "credential";
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
  let resolveReady: (value: InstalledProviderInstance) => void = () =>
    undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  const ready = new Promise<InstalledProviderInstance>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const pending = new Map<string, PendingHostRequest<unknown>>();

  const rejectPending = (error: Error): void => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  const shutdown = (): void => {
    if (stopped) return;
    stopped = true;
    removeListener();
    rejectPending(new Error("Provider utility stopped."));
    if (!initializationSettled)
      rejectReady(new Error("Provider utility stopped before initialization."));
    port.postMessage({ type: "stopped", contractVersion: ipcContractVersion });
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
        : "provider-host-credential-response";
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
    } else {
      request.resolve(message.credential);
    }
  };

  const handleMessage = (message: ProviderUtilityParentMessage): void => {
    if (message.type === "shutdown") {
      shutdown();
      return;
    }
    if (
      message.type === "provider-host-network-response" ||
      message.type === "provider-host-credential-response"
    ) {
      if (!initialized || stopped) {
        fail("PROVIDER_UTILITY_PROTOCOL_VIOLATION");
        return;
      }
      handleHostResponse(message);
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
      .then((created) => {
        initializationSettled = true;
        if (stopped) return;
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
