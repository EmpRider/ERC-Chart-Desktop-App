import {
  isImportedProviderSession,
  isProviderLiveEvent,
  isProviderLiveRequest,
  isProviderSessionRequest,
  isProviderManagementSnapshot,
  isProviderProfileCreateRequest,
  isProviderProfileSummary,
  isProviderProfileUpdateRequest,
  isProviderImportCredentialValues,
  isProviderImportPreviewResult,
  isRuntimeInfo,
  isWorkspaceLoadResult,
  isWorkspaceSaveRequest,
  providerImportApproveChannel,
  providerImportCancelChannel,
  providerImportPreviewChannel,
  providerLiveEventChannel,
  providerLiveSubscribeChannel,
  providerLiveUnsubscribeChannel,
  providerProfileCreateChannel,
  providerProfileDeleteChannel,
  providerProfilesListChannel,
  providerProfileStartChannel,
  providerSessionLoadChannel,
  providerProfileStopChannel,
  providerProfileUpdateChannel,
  runtimeInfoChannel,
  workspaceLoadChannel,
  workspaceSaveChannel,
  type ImportedProviderSession,
  type ProviderLiveEvent,
  type ProviderLiveRequest,
  type ProviderManagementSnapshot,
  type ProviderProfileCreateRequest,
  type ProviderProfileSummary,
  type ProviderProfileUpdateRequest,
  type ProviderSessionRequest,
  type PersistedWorkspace,
  type ProviderImportPreview,
  type ProviderImportCredentialValues,
  type RuntimeInfo,
} from "@erc-chart/contracts";

export interface ErcChartBridge {
  readonly getRuntimeInfo: () => Promise<RuntimeInfo>;
  readonly loadWorkspace: () => Promise<PersistedWorkspace | null>;
  readonly saveWorkspace: (workspace: PersistedWorkspace) => Promise<void>;
  readonly flushWorkspace: () => Promise<void>;
  readonly previewProviderImport: () => Promise<ProviderImportPreview | null>;
  readonly approveProviderImport: (
    requestId: string,
    credentials?: ProviderImportCredentialValues,
  ) => Promise<ImportedProviderSession>;
  readonly cancelProviderImport: (requestId: string) => Promise<void>;
  readonly listProviderProfiles: () => Promise<ProviderManagementSnapshot>;
  readonly createProviderProfile: (
    request: ProviderProfileCreateRequest,
  ) => Promise<ImportedProviderSession>;
  readonly updateProviderProfile: (
    request: ProviderProfileUpdateRequest,
  ) => Promise<ProviderProfileSummary>;
  readonly startProviderProfile: (
    profileId: string,
  ) => Promise<ImportedProviderSession>;
  readonly loadProviderSession: (
    request: ProviderSessionRequest,
  ) => Promise<ImportedProviderSession>;
  readonly stopProviderProfile: (profileId: string) => Promise<void>;
  readonly deleteProviderProfile: (profileId: string) => Promise<void>;
  readonly subscribeProviderData: (
    request: ProviderLiveRequest,
    listener: (event: ProviderLiveEvent) => void,
  ) => Promise<() => Promise<void>>;
}

export type BridgeInvoke = (
  channel: string,
  ...args: readonly unknown[]
) => Promise<unknown>;

export type BridgeExpose = (key: "ercChart", api: ErcChartBridge) => void;

export type BridgeListen = (
  channel: string,
  listener: (payload: unknown) => void,
) => () => void;

function requireRequestId(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 128
  ) {
    throw new Error("Provider import request is invalid.");
  }
  return value;
}

function requireProfileId(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._-]+$/u.test(value)
  ) {
    throw new Error("Provider profile is invalid.");
  }
  return value;
}

export function createErcChartBridge(
  invoke: BridgeInvoke,
  listen?: BridgeListen,
): ErcChartBridge {
  let latestSave: Promise<void> = Promise.resolve();
  let providerSubscriptionSequence = 0;
  const saveWorkspace = (workspace: PersistedWorkspace): Promise<void> => {
    if (!isWorkspaceSaveRequest(workspace))
      return Promise.reject(new Error("Workspace could not be saved."));
    latestSave = latestSave
      .catch(() => undefined)
      .then(async (): Promise<void> => {
        try {
          const result = await invoke(workspaceSaveChannel, workspace);
          if (result !== true) throw new Error();
        } catch {
          throw new Error("Workspace could not be saved.");
        }
      });
    return latestSave;
  };
  return {
    getRuntimeInfo: async (): Promise<RuntimeInfo> => {
      try {
        const result = await invoke(runtimeInfoChannel);
        if (!isRuntimeInfo(result)) {
          throw new Error("Runtime information unavailable.");
        }
        return result;
      } catch {
        throw new Error("Runtime information unavailable.");
      }
    },
    loadWorkspace: async (): Promise<PersistedWorkspace | null> => {
      try {
        const result = await invoke(workspaceLoadChannel);
        if (!isWorkspaceLoadResult(result)) throw new Error();
        return result;
      } catch {
        throw new Error("Workspace unavailable.");
      }
    },
    saveWorkspace,
    flushWorkspace: async (): Promise<void> => latestSave,
    previewProviderImport: async (): Promise<ProviderImportPreview | null> => {
      try {
        const result = await invoke(providerImportPreviewChannel);
        if (!isProviderImportPreviewResult(result)) throw new Error();
        return result;
      } catch {
        throw new Error("Provider import could not be prepared.");
      }
    },
    approveProviderImport: async (
      requestId: string,
      credentials: ProviderImportCredentialValues = {},
    ): Promise<ImportedProviderSession> => {
      const checkedRequestId = requireRequestId(requestId);
      if (!isProviderImportCredentialValues(credentials)) {
        throw new Error("Provider credentials are invalid.");
      }
      try {
        const result = await invoke(
          providerImportApproveChannel,
          checkedRequestId,
          credentials,
        );
        if (!isImportedProviderSession(result)) throw new Error();
        return result;
      } catch {
        throw new Error("Provider could not be installed and started.");
      }
    },
    cancelProviderImport: async (requestId: string): Promise<void> => {
      const checkedRequestId = requireRequestId(requestId);
      try {
        const result = await invoke(
          providerImportCancelChannel,
          checkedRequestId,
        );
        if (result !== true) throw new Error();
      } catch {
        throw new Error("Provider import could not be cancelled.");
      }
    },
    listProviderProfiles: async (): Promise<ProviderManagementSnapshot> => {
      try {
        const result = await invoke(providerProfilesListChannel);
        if (!isProviderManagementSnapshot(result)) throw new Error();
        return result;
      } catch {
        throw new Error("Provider profiles could not be loaded.");
      }
    },
    createProviderProfile: async (
      request: ProviderProfileCreateRequest,
    ): Promise<ImportedProviderSession> => {
      if (!isProviderProfileCreateRequest(request)) {
        throw new Error("Provider profile is invalid.");
      }
      try {
        const result = await invoke(providerProfileCreateChannel, request);
        if (!isImportedProviderSession(result)) throw new Error();
        return result;
      } catch {
        throw new Error("Provider profile could not be created.");
      }
    },
    updateProviderProfile: async (
      request: ProviderProfileUpdateRequest,
    ): Promise<ProviderProfileSummary> => {
      if (!isProviderProfileUpdateRequest(request)) {
        throw new Error("Provider profile update is invalid.");
      }
      try {
        const result = await invoke(providerProfileUpdateChannel, request);
        if (!isProviderProfileSummary(result)) throw new Error();
        return result;
      } catch {
        throw new Error("Provider profile could not be updated.");
      }
    },
    startProviderProfile: async (
      profileId: string,
    ): Promise<ImportedProviderSession> => {
      const checkedProfileId = requireProfileId(profileId);
      try {
        const result = await invoke(
          providerProfileStartChannel,
          checkedProfileId,
        );
        if (!isImportedProviderSession(result)) throw new Error();
        return result;
      } catch {
        throw new Error("Provider profile could not be started.");
      }
    },
    loadProviderSession: async (
      request: ProviderSessionRequest,
    ): Promise<ImportedProviderSession> => {
      if (!isProviderSessionRequest(request)) {
        throw new Error("Provider session request is invalid.");
      }
      try {
        const result = await invoke(providerSessionLoadChannel, request);
        if (!isImportedProviderSession(result)) throw new Error();
        return result;
      } catch {
        throw new Error("Provider timeframe could not be loaded.");
      }
    },
    stopProviderProfile: async (profileId: string): Promise<void> => {
      const checkedProfileId = requireProfileId(profileId);
      try {
        const result = await invoke(
          providerProfileStopChannel,
          checkedProfileId,
        );
        if (result !== true) throw new Error();
      } catch {
        throw new Error("Provider profile could not be stopped.");
      }
    },
    deleteProviderProfile: async (profileId: string): Promise<void> => {
      const checkedProfileId = requireProfileId(profileId);
      try {
        const result = await invoke(
          providerProfileDeleteChannel,
          checkedProfileId,
        );
        if (result !== true) throw new Error();
      } catch {
        throw new Error("Provider profile could not be removed.");
      }
    },
    subscribeProviderData: async (
      request: ProviderLiveRequest,
      listener: (event: ProviderLiveEvent) => void,
    ): Promise<() => Promise<void>> => {
      if (!isProviderLiveRequest(request) || typeof listener !== "function") {
        throw new Error("Provider live subscription is invalid.");
      }
      if (listen === undefined) {
        throw new Error("Provider live subscription is unavailable.");
      }
      providerSubscriptionSequence += 1;
      const subscriptionId = [
        "provider-live",
        Date.now().toString(36),
        providerSubscriptionSequence.toString(36),
        Math.random().toString(36).slice(2),
      ].join("-");
      const removeListener = listen(providerLiveEventChannel, (payload) => {
        if (
          !isProviderLiveEvent(payload) ||
          payload.subscriptionId !== subscriptionId
        ) {
          return;
        }
        try {
          listener(payload);
        } catch {
          // Renderer callbacks do not own the IPC listener lifecycle.
        }
      });
      try {
        const result = await invoke(providerLiveSubscribeChannel, {
          ...request,
          subscriptionId,
        });
        if (result !== true) throw new Error();
      } catch {
        removeListener();
        throw new Error("Provider live subscription could not be started.");
      }

      let disposed = false;
      return async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        removeListener();
        try {
          const result = await invoke(
            providerLiveUnsubscribeChannel,
            subscriptionId,
          );
          if (result !== true) throw new Error();
        } catch {
          throw new Error("Provider live subscription could not be stopped.");
        }
      };
    },
  };
}

export function installBridge(
  expose: BridgeExpose,
  invoke: BridgeInvoke,
  listen?: BridgeListen,
): void {
  expose("ercChart", createErcChartBridge(invoke, listen));
}
