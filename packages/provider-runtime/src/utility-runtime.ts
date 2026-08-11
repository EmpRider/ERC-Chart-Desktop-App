import {
  ipcContractVersion,
  isUtilityControlMessage,
  type UtilityStatusMessage,
} from "@erc-chart/contracts";

export interface ProviderUtilityPort {
  readonly postMessage: (message: UtilityStatusMessage) => void;
  readonly onMessage: (listener: (message: unknown) => void) => () => void;
}

export interface ProviderUtilityRuntime {
  readonly providerProfileId: string;
  readonly shutdown: () => void;
}

export function createProviderUtilityRuntime(
  port: ProviderUtilityPort,
  providerProfileId: string,
): ProviderUtilityRuntime {
  if (providerProfileId.trim() === "") {
    throw new RangeError("Provider profile ID is required.");
  }

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

  return { providerProfileId, shutdown };
}
