import { ipcContractVersion, type ContractVersion } from "./versions.js";

export const runtimeInfoChannel = "erc-chart:runtime-info";

export interface RuntimeInfo {
  readonly ipcContractVersion: ContractVersion;
  readonly applicationName: "ERC Chart";
}

export function isRuntimeInfo(value: unknown): value is RuntimeInfo {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    record.ipcContractVersion === ipcContractVersion &&
    record.applicationName === "ERC Chart"
  );
}
