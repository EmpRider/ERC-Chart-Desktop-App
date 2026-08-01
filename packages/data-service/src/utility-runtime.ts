import {
  ipcContractVersion,
  isUtilityControlMessage,
  type UtilityStatusMessage,
} from "@erc-chart/contracts";

export interface UtilityPort {
  readonly postMessage: (message: UtilityStatusMessage) => void;
  readonly onMessage: (listener: (message: unknown) => void) => () => void;
}

export interface UtilityRuntime {
  readonly shutdown: () => void;
}

export function createUtilityRuntime(port: UtilityPort): UtilityRuntime {
  let stopped = false;
  let removeListener = (): void => undefined;

  const shutdown = (): void => {
    if (stopped) return;
    stopped = true;
    removeListener();
    port.postMessage({ type: "stopped", contractVersion: ipcContractVersion });
  };

  removeListener = port.onMessage((message) => {
    if (isUtilityControlMessage(message)) shutdown();
  });
  port.postMessage({ type: "ready", contractVersion: ipcContractVersion });

  return { shutdown };
}
