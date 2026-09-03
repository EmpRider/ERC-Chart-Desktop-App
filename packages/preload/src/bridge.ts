import {
  isImportedProviderSession,
  isProviderImportCredentialValues,
  isProviderImportPreviewResult,
  isRuntimeInfo,
  isWorkspaceLoadResult,
  isWorkspaceSaveRequest,
  providerImportApproveChannel,
  providerImportCancelChannel,
  providerImportPreviewChannel,
  runtimeInfoChannel,
  workspaceLoadChannel,
  workspaceSaveChannel,
  type ImportedProviderSession,
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
}

export type BridgeInvoke = (
  channel: string,
  ...args: readonly unknown[]
) => Promise<unknown>;

export type BridgeExpose = (key: "ercChart", api: ErcChartBridge) => void;

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

export function createErcChartBridge(invoke: BridgeInvoke): ErcChartBridge {
  let latestSave: Promise<void> = Promise.resolve();
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
  };
}

export function installBridge(
  expose: BridgeExpose,
  invoke: BridgeInvoke,
): void {
  expose("ercChart", createErcChartBridge(invoke));
}
