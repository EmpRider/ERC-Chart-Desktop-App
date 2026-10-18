import { ipcContractVersion, type ContractVersion } from "./versions.js";

// Provider operations can include several 30-second HTTP requests and retries.
// Leave time for the upstream failure to return before the outer command expires.
export const dataUtilityUpstreamTimeoutMs = 120_000;
export const dataUtilityProviderCommandTimeoutMs = 125_000;

export type DataUtilityOperation =
  | "provider-capabilities"
  | "provider-instruments"
  | "provider-history"
  | "provider-subscribe"
  | "provider-unsubscribe"
  | "provider-invalidate"
  | "provider-restore"
  | "provider-shutdown"
  | "workspace-load"
  | "workspace-save"
  | "profile-list"
  | "profile-get"
  | "profile-create"
  | "profile-update"
  | "profile-delete"
  | "plugin-list"
  | "plugin-put"
  | "plugin-activate"
  | "plugin-disable"
  | "plugin-delete"
  | "process-info";

export type DataUtilityUpstreamOperation =
  | "get-capabilities"
  | "get-instruments"
  | "request-history"
  | "subscribe"
  | "unsubscribe";

export interface DataUtilityInitMessage {
  readonly type: "data-init";
  readonly contractVersion: ContractVersion;
  readonly generation: number;
  readonly databasePath: string;
  readonly instanceId: string;
  readonly legacyWorkspaceId: string;
}

export interface DataUtilityCommand {
  readonly type: "data-command";
  readonly contractVersion: ContractVersion;
  readonly requestId: string;
  readonly generation: number;
  readonly operation: DataUtilityOperation;
  readonly payload: unknown;
}

export interface DataUtilityResult {
  readonly type: "data-result";
  readonly contractVersion: ContractVersion;
  readonly requestId: string;
  readonly generation: number;
  readonly ok: boolean;
  readonly payload?: unknown;
  readonly code?: string;
}

export interface DataUtilityEvent {
  readonly type: "data-event";
  readonly contractVersion: ContractVersion;
  readonly generation: number;
  readonly subscriptionId: string;
  readonly event: "candles" | "ticks" | "error";
  readonly payload: unknown;
}

export interface DataUtilityUpstreamRequest {
  readonly type: "data-upstream-request";
  readonly contractVersion: ContractVersion;
  readonly requestId: string;
  readonly generation: number;
  readonly operation: DataUtilityUpstreamOperation;
  readonly providerProfileId: string;
  readonly payload: unknown;
}

export interface DataUtilityUpstreamResult {
  readonly type: "data-upstream-result";
  readonly contractVersion: ContractVersion;
  readonly requestId: string;
  readonly generation: number;
  readonly ok: boolean;
  readonly payload?: unknown;
  readonly code?: string;
}

export interface DataUtilityUpstreamEvent {
  readonly type: "data-upstream-event";
  readonly contractVersion: ContractVersion;
  readonly generation: number;
  readonly subscriptionId: string;
  readonly event: "candles" | "ticks" | "error";
  readonly payload: unknown;
}

const dataOperations = new Set<DataUtilityOperation>([
  "provider-capabilities",
  "provider-instruments",
  "provider-history",
  "provider-subscribe",
  "provider-unsubscribe",
  "provider-invalidate",
  "provider-restore",
  "provider-shutdown",
  "workspace-load",
  "workspace-save",
  "profile-list",
  "profile-get",
  "profile-create",
  "profile-update",
  "profile-delete",
  "plugin-list",
  "plugin-put",
  "plugin-activate",
  "plugin-disable",
  "plugin-delete",
  "process-info",
]);
const upstreamOperations = new Set<DataUtilityUpstreamOperation>([
  "get-capabilities",
  "get-instruments",
  "request-history",
  "subscribe",
  "unsubscribe",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactFields(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((field) => field in value) &&
    Object.keys(value).every((field) => allowed.has(field))
  );
}

function isGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedId(value: unknown, maximum = 256): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    /^[A-Za-z0-9._:-]+$/u.test(value)
  );
}

function isErrorCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[A-Z][A-Z0-9_]*$/u.test(value)
  );
}

function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 16) return false;
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return typeof value !== "string" || value.length <= 1_000_000;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return (
      value.length <= 100_000 &&
      value.every((item) => isJsonValue(item, depth + 1))
    );
  }
  if (!isRecord(value) || Object.keys(value).length > 256) return false;
  return Object.entries(value).every(
    ([key, item]) => key.length <= 256 && isJsonValue(item, depth + 1),
  );
}

export function isDataUtilityInitMessage(
  value: unknown,
): value is DataUtilityInitMessage {
  if (!isRecord(value)) return false;
  return (
    hasExactFields(value, [
      "type",
      "contractVersion",
      "generation",
      "databasePath",
      "instanceId",
      "legacyWorkspaceId",
    ]) &&
    value.type === "data-init" &&
    value.contractVersion === ipcContractVersion &&
    isGeneration(value.generation) &&
    typeof value.databasePath === "string" &&
    value.databasePath.length > 0 &&
    value.databasePath.length <= 4096 &&
    isBoundedId(value.instanceId) &&
    isBoundedId(value.legacyWorkspaceId)
  );
}

export function isDataUtilityCommand(
  value: unknown,
): value is DataUtilityCommand {
  if (!isRecord(value)) return false;
  return (
    hasExactFields(value, [
      "type",
      "contractVersion",
      "requestId",
      "generation",
      "operation",
      "payload",
    ]) &&
    value.type === "data-command" &&
    value.contractVersion === ipcContractVersion &&
    isBoundedId(value.requestId) &&
    isGeneration(value.generation) &&
    typeof value.operation === "string" &&
    dataOperations.has(value.operation as DataUtilityOperation) &&
    isJsonValue(value.payload)
  );
}

export function isDataUtilityResult(
  value: unknown,
): value is DataUtilityResult {
  if (!isRecord(value)) return false;
  if (
    !hasExactFields(
      value,
      ["type", "contractVersion", "requestId", "generation", "ok"],
      ["payload", "code"],
    ) ||
    value.type !== "data-result" ||
    value.contractVersion !== ipcContractVersion ||
    !isBoundedId(value.requestId) ||
    !isGeneration(value.generation) ||
    typeof value.ok !== "boolean"
  ) {
    return false;
  }
  if (value.ok)
    return (
      value.code === undefined &&
      (value.payload === undefined || isJsonValue(value.payload))
    );
  return value.payload === undefined && isErrorCode(value.code);
}

export function isDataUtilityEvent(value: unknown): value is DataUtilityEvent {
  if (!isRecord(value)) return false;
  return (
    hasExactFields(value, [
      "type",
      "contractVersion",
      "generation",
      "subscriptionId",
      "event",
      "payload",
    ]) &&
    value.type === "data-event" &&
    value.contractVersion === ipcContractVersion &&
    isGeneration(value.generation) &&
    isBoundedId(value.subscriptionId) &&
    (value.event === "candles" ||
      value.event === "ticks" ||
      value.event === "error") &&
    isJsonValue(value.payload)
  );
}

export function isDataUtilityUpstreamRequest(
  value: unknown,
): value is DataUtilityUpstreamRequest {
  if (!isRecord(value)) return false;
  return (
    hasExactFields(value, [
      "type",
      "contractVersion",
      "requestId",
      "generation",
      "operation",
      "providerProfileId",
      "payload",
    ]) &&
    value.type === "data-upstream-request" &&
    value.contractVersion === ipcContractVersion &&
    isBoundedId(value.requestId) &&
    isGeneration(value.generation) &&
    typeof value.operation === "string" &&
    upstreamOperations.has(value.operation as DataUtilityUpstreamOperation) &&
    isBoundedId(value.providerProfileId) &&
    isJsonValue(value.payload)
  );
}

export function isDataUtilityUpstreamResult(
  value: unknown,
): value is DataUtilityUpstreamResult {
  if (!isRecord(value)) return false;
  if (
    !hasExactFields(
      value,
      ["type", "contractVersion", "requestId", "generation", "ok"],
      ["payload", "code"],
    ) ||
    value.type !== "data-upstream-result" ||
    value.contractVersion !== ipcContractVersion ||
    !isBoundedId(value.requestId) ||
    !isGeneration(value.generation) ||
    typeof value.ok !== "boolean"
  ) {
    return false;
  }
  if (value.ok)
    return (
      value.code === undefined &&
      (value.payload === undefined || isJsonValue(value.payload))
    );
  return value.payload === undefined && isErrorCode(value.code);
}

export function isDataUtilityUpstreamEvent(
  value: unknown,
): value is DataUtilityUpstreamEvent {
  if (!isRecord(value)) return false;
  return (
    hasExactFields(value, [
      "type",
      "contractVersion",
      "generation",
      "subscriptionId",
      "event",
      "payload",
    ]) &&
    value.type === "data-upstream-event" &&
    value.contractVersion === ipcContractVersion &&
    isGeneration(value.generation) &&
    isBoundedId(value.subscriptionId) &&
    (value.event === "candles" ||
      value.event === "ticks" ||
      value.event === "error") &&
    isJsonValue(value.payload)
  );
}
