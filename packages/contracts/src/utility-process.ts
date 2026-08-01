import { ipcContractVersion, type ContractVersion } from "./versions.js";

export interface UtilityShutdownMessage {
  readonly type: "shutdown";
  readonly contractVersion: ContractVersion;
}

export type UtilityControlMessage = UtilityShutdownMessage;

export interface UtilityReadyMessage {
  readonly type: "ready";
  readonly contractVersion: ContractVersion;
}

export interface UtilityStoppedMessage {
  readonly type: "stopped";
  readonly contractVersion: ContractVersion;
}

export interface UtilityErrorMessage {
  readonly type: "error";
  readonly contractVersion: ContractVersion;
  readonly code: string;
}

export type UtilityStatusMessage =
  UtilityReadyMessage | UtilityStoppedMessage | UtilityErrorMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isUtilityControlMessage(
  value: unknown,
): value is UtilityControlMessage {
  if (!isRecord(value)) return false;
  return (
    Object.keys(value).length === 2 &&
    value.type === "shutdown" &&
    value.contractVersion === ipcContractVersion
  );
}

export function isUtilityStatusMessage(
  value: unknown,
): value is UtilityStatusMessage {
  if (!isRecord(value) || value.contractVersion !== ipcContractVersion) {
    return false;
  }
  if (value.type === "ready" || value.type === "stopped") {
    return Object.keys(value).length === 2;
  }
  return (
    value.type === "error" &&
    Object.keys(value).length === 3 &&
    typeof value.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)
  );
}
