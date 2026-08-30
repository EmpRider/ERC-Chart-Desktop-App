import {
  isRuntimeInfo,
  isWorkspaceLoadResult,
  isWorkspaceSaveRequest,
  runtimeInfoChannel,
  workspaceLoadChannel,
  workspaceSaveChannel,
  type PersistedWorkspace,
  type RuntimeInfo,
} from "@erc-chart/contracts";

export interface ErcChartBridge {
  readonly getRuntimeInfo: () => Promise<RuntimeInfo>;
  readonly loadWorkspace: () => Promise<PersistedWorkspace | null>;
  readonly saveWorkspace: (workspace: PersistedWorkspace) => Promise<void>;
  readonly flushWorkspace: () => Promise<void>;
}

export type BridgeInvoke = (
  channel: string,
  ...args: readonly unknown[]
) => Promise<unknown>;

export type BridgeExpose = (key: "ercChart", api: ErcChartBridge) => void;

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
  };
}

export function installBridge(
  expose: BridgeExpose,
  invoke: BridgeInvoke,
): void {
  expose("ercChart", createErcChartBridge(invoke));
}
