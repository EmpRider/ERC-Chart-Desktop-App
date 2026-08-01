import {
  isRuntimeInfo,
  runtimeInfoChannel,
  type RuntimeInfo,
} from "@erc-chart/contracts";

export interface ErcChartBridge {
  readonly getRuntimeInfo: () => Promise<RuntimeInfo>;
}

export type BridgeInvoke = (
  channel: string,
  ...args: readonly unknown[]
) => Promise<unknown>;

export type BridgeExpose = (key: "ercChart", api: ErcChartBridge) => void;

export function createErcChartBridge(invoke: BridgeInvoke): ErcChartBridge {
  return {
    getRuntimeInfo: async (): Promise<RuntimeInfo> => {
      const result = await invoke(runtimeInfoChannel);
      if (!isRuntimeInfo(result)) {
        throw new Error("Runtime information unavailable.");
      }
      return result;
    },
  };
}

export function installBridge(
  expose: BridgeExpose,
  invoke: BridgeInvoke,
): void {
  expose("ercChart", createErcChartBridge(invoke));
}
