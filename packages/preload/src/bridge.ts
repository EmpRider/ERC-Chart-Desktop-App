import {
  indicatorImportApproveChannel,
  indicatorImportCancelChannel,
  indicatorImportPreviewChannel,
  indicatorsListChannel,
  isIndicatorImportPreviewResult,
  isInstalledIndicatorList,
  isInstalledIndicatorSummary,
  isImportedProviderSession,
  isProviderHistoryLoadRequest,
  isProviderHistoryResult,
  isProviderLiveEvent,
  isProviderLiveRequest,
  isProviderSessionRequest,
  isProviderManagementSnapshot,
  isProviderProfileCreateRequest,
  isProviderProfileSummary,
  isProviderProfileUpdateRequest,
  isProviderImportCredentialValues,
  isProviderImportPreviewResult,
  isPluginImportSourceKind,
  isRuntimeInfo,
  isWorkspaceLoadResult,
  isWorkspaceSaveRequest,
  providerImportApproveChannel,
  providerImportCancelChannel,
  providerImportPreviewChannel,
  providerHistoryLoadChannel,
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
  type Candle,
  type IndicatorImportPreview,
  type ImportedProviderSession,
  type InstalledIndicatorSummary,
  type ProviderHistoryLoadRequest,
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
  type PluginImportSourceKind,
  type RuntimeInfo,
} from "@erc-chart/contracts";

export interface ErcChartBridge {
  readonly getRuntimeInfo: () => Promise<RuntimeInfo>;
  readonly loadWorkspace: () => Promise<PersistedWorkspace | null>;
  readonly saveWorkspace: (workspace: PersistedWorkspace) => Promise<void>;
  readonly flushWorkspace: () => Promise<void>;
  readonly previewProviderImport: (
    sourceKind: PluginImportSourceKind,
  ) => Promise<ProviderImportPreview | null>;
  readonly approveProviderImport: (
    requestId: string,
    credentials?: ProviderImportCredentialValues,
  ) => Promise<ImportedProviderSession>;
  readonly cancelProviderImport: (requestId: string) => Promise<void>;
  readonly previewIndicatorImport: (
    sourceKind: PluginImportSourceKind,
  ) => Promise<IndicatorImportPreview | null>;
  readonly approveIndicatorImport: (
    requestId: string,
  ) => Promise<InstalledIndicatorSummary>;
  readonly cancelIndicatorImport: (requestId: string) => Promise<void>;
  readonly listIndicators: () => Promise<readonly InstalledIndicatorSummary[]>;
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
  readonly requestProviderHistory: (
    request: ProviderHistoryLoadRequest,
  ) => Promise<readonly Candle[]>;
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
  interface SaveWaiter {
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  }
  let activeSave: Promise<void> | undefined;
  let queuedWorkspace: PersistedWorkspace | undefined;
  let queuedWaiters: SaveWaiter[] = [];
  let flushWaiters: SaveWaiter[] = [];
  let lastSaveError: Error | undefined;
  let providerSubscriptionSequence = 0;

  const settleFlushWaiters = (): void => {
    if (activeSave !== undefined || queuedWorkspace !== undefined) return;
    const waiters = flushWaiters;
    flushWaiters = [];
    for (const waiter of waiters) {
      if (lastSaveError === undefined) waiter.resolve();
      else waiter.reject(lastSaveError);
    }
  };

  const startWorkspaceSave = (
    workspace: PersistedWorkspace,
    waiters: readonly SaveWaiter[],
  ): void => {
    const run = (async (): Promise<void> => {
      try {
        const result = await invoke(workspaceSaveChannel, workspace);
        if (result !== true) throw new Error();
        lastSaveError = undefined;
        for (const waiter of waiters) waiter.resolve();
      } catch {
        const error = new Error("Workspace could not be saved.");
        lastSaveError = error;
        for (const waiter of waiters) waiter.reject(error);
      }
    })();
    activeSave = run;
    void run.finally(() => {
      if (activeSave === run) activeSave = undefined;
      const nextWorkspace = queuedWorkspace;
      if (nextWorkspace !== undefined) {
        const nextWaiters = queuedWaiters;
        queuedWorkspace = undefined;
        queuedWaiters = [];
        startWorkspaceSave(nextWorkspace, nextWaiters);
      } else {
        settleFlushWaiters();
      }
    });
  };

  const saveWorkspace = (workspace: PersistedWorkspace): Promise<void> => {
    if (!isWorkspaceSaveRequest(workspace))
      return Promise.reject(new Error("Workspace could not be saved."));
    return new Promise<void>((resolve, reject) => {
      const waiter: SaveWaiter = { resolve, reject };
      if (activeSave === undefined) {
        startWorkspaceSave(workspace, [waiter]);
        return;
      }
      queuedWorkspace = workspace;
      queuedWaiters.push(waiter);
    });
  };

  const flushWorkspace = (): Promise<void> => {
    if (activeSave === undefined && queuedWorkspace === undefined) {
      return lastSaveError === undefined
        ? Promise.resolve()
        : Promise.reject(lastSaveError);
    }
    return new Promise<void>((resolve, reject) => {
      flushWaiters.push({ resolve, reject });
    });
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
    flushWorkspace,
    previewProviderImport: async (
      sourceKind: PluginImportSourceKind,
    ): Promise<ProviderImportPreview | null> => {
      try {
        if (!isPluginImportSourceKind(sourceKind)) throw new Error();
        const result = await invoke(providerImportPreviewChannel, sourceKind);
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
    previewIndicatorImport: async (
      sourceKind: PluginImportSourceKind,
    ): Promise<IndicatorImportPreview | null> => {
      try {
        if (!isPluginImportSourceKind(sourceKind)) throw new Error();
        const result = await invoke(indicatorImportPreviewChannel, sourceKind);
        if (!isIndicatorImportPreviewResult(result)) throw new Error();
        return result;
      } catch {
        throw new Error("Indicator import could not be prepared.");
      }
    },
    approveIndicatorImport: async (
      requestId: string,
    ): Promise<InstalledIndicatorSummary> => {
      const checkedRequestId = requireRequestId(requestId);
      try {
        const result = await invoke(
          indicatorImportApproveChannel,
          checkedRequestId,
        );
        if (!isInstalledIndicatorSummary(result)) throw new Error();
        return result;
      } catch {
        throw new Error("Indicator could not be installed.");
      }
    },
    cancelIndicatorImport: async (requestId: string): Promise<void> => {
      const checkedRequestId = requireRequestId(requestId);
      try {
        const result = await invoke(
          indicatorImportCancelChannel,
          checkedRequestId,
        );
        if (result !== true) throw new Error();
      } catch {
        throw new Error("Indicator import could not be cancelled.");
      }
    },
    listIndicators: async (): Promise<readonly InstalledIndicatorSummary[]> => {
      try {
        const result = await invoke(indicatorsListChannel);
        if (!isInstalledIndicatorList(result)) throw new Error();
        return result;
      } catch {
        throw new Error("Installed indicators could not be loaded.");
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
    requestProviderHistory: async (
      request: ProviderHistoryLoadRequest,
    ): Promise<readonly Candle[]> => {
      if (!isProviderHistoryLoadRequest(request)) {
        throw new Error("Provider history request is invalid.");
      }
      try {
        const result = await invoke(providerHistoryLoadChannel, request);
        if (!isProviderHistoryResult(result)) throw new Error();
        return result;
      } catch {
        throw new Error("Provider history could not be loaded.");
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
