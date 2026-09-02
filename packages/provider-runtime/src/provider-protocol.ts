import {
  ipcContractVersion,
  isUtilityControlMessage,
  isUtilityStatusMessage,
  type PluginManifestPermissions,
  type UtilityControlMessage,
  type UtilityStatusMessage,
} from "@erc-chart/contracts";
import type {
  ProviderNetworkRequest,
  ProviderNetworkResponse,
  ProviderStatus,
} from "@erc-chart/provider-sdk";

export interface ProviderUtilityLaunchDescriptor {
  readonly installationPath: string;
  readonly entry: string;
  readonly pluginId: string;
  readonly version: string;
  readonly permissions: PluginManifestPermissions;
  readonly settings: Readonly<Record<string, boolean | number | string>>;
}

export interface ProviderUtilityInitializeMessage {
  readonly type: "provider-initialize";
  readonly contractVersion: typeof ipcContractVersion;
  readonly launch: ProviderUtilityLaunchDescriptor;
}

export interface ProviderUtilityNetworkRequestMessage {
  readonly type: "provider-host-network-request";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly request: ProviderNetworkRequest;
}

export interface ProviderUtilityCredentialRequestMessage {
  readonly type: "provider-host-credential-request";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly credentialKey: string;
}

export interface ProviderUtilityLogMessage {
  readonly type: "provider-host-log";
  readonly contractVersion: typeof ipcContractVersion;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly code: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ProviderUtilityProviderStatusMessage {
  readonly type: "provider-host-status";
  readonly contractVersion: typeof ipcContractVersion;
  readonly status: ProviderStatus;
}

export interface ProviderUtilityNetworkSuccessMessage {
  readonly type: "provider-host-network-response";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly ok: true;
  readonly response: ProviderNetworkResponse;
}

export interface ProviderUtilityCredentialSuccessMessage {
  readonly type: "provider-host-credential-response";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly ok: true;
  readonly credential: string | null;
}

export interface ProviderUtilityHostFailureMessage {
  readonly type:
    "provider-host-network-response" | "provider-host-credential-response";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly ok: false;
  readonly code: string;
}

export type ProviderUtilityHostResponseMessage =
  | ProviderUtilityNetworkSuccessMessage
  | ProviderUtilityCredentialSuccessMessage
  | ProviderUtilityHostFailureMessage;

export type ProviderUtilityParentMessage =
  | UtilityControlMessage
  | ProviderUtilityInitializeMessage
  | ProviderUtilityHostResponseMessage;

export type ProviderUtilityChildMessage =
  | UtilityStatusMessage
  | ProviderUtilityNetworkRequestMessage
  | ProviderUtilityCredentialRequestMessage
  | ProviderUtilityLogMessage
  | ProviderUtilityProviderStatusMessage;

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u;
const versionPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const credentialKeyPattern = /^[a-z][a-z0-9_-]{0,63}$/u;
const requestIdPattern = /^[A-Za-z0-9._-]{1,96}$/u;
const codePattern = /^[A-Z][A-Z0-9_.-]{0,127}$/u;
const providerStatuses = new Set<ProviderStatus>([
  "disconnected",
  "connecting",
  "connected",
  "degraded",
  "reconnecting",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function isStringArray(
  value: unknown,
  maximum: number,
  validator: (item: string) => boolean,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    new Set(value).size === value.length &&
    value.every((item) => typeof item === "string" && validator(item))
  );
}

function isPermissions(value: unknown): value is PluginManifestPermissions {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["network", "credentials", "storage"])
  ) {
    return false;
  }
  return (
    isStringArray(value.network, 32, (item) => {
      try {
        const url = new URL(item);
        return url.protocol === "https:" || url.protocol === "wss:";
      } catch {
        return false;
      }
    }) &&
    isStringArray(value.credentials, 32, (item) =>
      credentialKeyPattern.test(item),
    ) &&
    isStringArray(
      value.storage,
      8,
      (item) => item === "plugin-settings" || item === "provider-cache",
    )
  );
}

function isSettings(
  value: unknown,
): value is Readonly<Record<string, boolean | number | string>> {
  return (
    isRecord(value) &&
    Object.keys(value).length <= 128 &&
    Object.entries(value).every(
      ([key, item]) =>
        /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u.test(key) &&
        (typeof item === "boolean" ||
          (typeof item === "number" && Number.isFinite(item)) ||
          (typeof item === "string" && item.length <= 8_192)),
    )
  );
}

function isLaunch(value: unknown): value is ProviderUtilityLaunchDescriptor {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "installationPath",
      "entry",
      "pluginId",
      "version",
      "permissions",
      "settings",
    ])
  ) {
    return false;
  }
  return (
    typeof value.installationPath === "string" &&
    value.installationPath.length > 0 &&
    value.installationPath.length <= 32_768 &&
    typeof value.entry === "string" &&
    value.entry.length > 0 &&
    value.entry.length <= 1_024 &&
    typeof value.pluginId === "string" &&
    pluginIdPattern.test(value.pluginId) &&
    typeof value.version === "string" &&
    versionPattern.test(value.version) &&
    isPermissions(value.permissions) &&
    isSettings(value.settings)
  );
}

function isHeaders(value: unknown): value is Readonly<Record<string, string>> {
  return (
    isRecord(value) &&
    Object.keys(value).length <= 128 &&
    Object.entries(value).every(
      ([key, item]) =>
        key.length > 0 &&
        key.length <= 256 &&
        typeof item === "string" &&
        item.length <= 16_384,
    )
  );
}

function isNetworkRequest(value: unknown): value is ProviderNetworkRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["url"], ["method", "headers", "body", "timeoutMs"]) ||
    typeof value.url !== "string" ||
    value.url.length > 32_768
  ) {
    return false;
  }
  if (
    value.method !== undefined &&
    (typeof value.method !== "string" || !/^[A-Z]{1,16}$/u.test(value.method))
  ) {
    return false;
  }
  if (value.headers !== undefined && !isHeaders(value.headers)) return false;
  if (
    value.body !== undefined &&
    typeof value.body !== "string" &&
    !(value.body instanceof Uint8Array)
  ) {
    return false;
  }
  if (typeof value.body === "string" && value.body.length > 2_000_000)
    return false;
  if (value.body instanceof Uint8Array && value.body.byteLength > 2_000_000)
    return false;
  return (
    value.timeoutMs === undefined ||
    (typeof value.timeoutMs === "number" &&
      Number.isSafeInteger(value.timeoutMs) &&
      value.timeoutMs >= 1 &&
      value.timeoutMs <= 120_000)
  );
}

function isNetworkResponse(value: unknown): value is ProviderNetworkResponse {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["status", "headers", "body"]) &&
    typeof value.status === "number" &&
    Number.isSafeInteger(value.status) &&
    value.status >= 100 &&
    value.status <= 599 &&
    isHeaders(value.headers) &&
    value.body instanceof Uint8Array &&
    value.body.byteLength <= 8_000_000
  );
}

function isHostFailure(value: Record<string, unknown>): boolean {
  return (
    value.ok === false &&
    hasExactKeys(value, [
      "type",
      "contractVersion",
      "requestId",
      "ok",
      "code",
    ]) &&
    typeof value.code === "string" &&
    codePattern.test(value.code)
  );
}

export function isProviderUtilityParentMessage(
  value: unknown,
): value is ProviderUtilityParentMessage {
  if (isUtilityControlMessage(value)) return true;
  if (!isRecord(value) || value.contractVersion !== ipcContractVersion)
    return false;
  if (value.type === "provider-initialize") {
    return (
      hasExactKeys(value, ["type", "contractVersion", "launch"]) &&
      isLaunch(value.launch)
    );
  }
  if (
    value.type !== "provider-host-network-response" &&
    value.type !== "provider-host-credential-response"
  ) {
    return false;
  }
  if (
    typeof value.requestId !== "string" ||
    !requestIdPattern.test(value.requestId)
  ) {
    return false;
  }
  if (isHostFailure(value)) return true;
  if (value.ok !== true) return false;
  if (value.type === "provider-host-network-response") {
    return (
      hasExactKeys(value, [
        "type",
        "contractVersion",
        "requestId",
        "ok",
        "response",
      ]) && isNetworkResponse(value.response)
    );
  }
  return (
    hasExactKeys(value, [
      "type",
      "contractVersion",
      "requestId",
      "ok",
      "credential",
    ]) &&
    (value.credential === null ||
      (typeof value.credential === "string" &&
        value.credential.length <= 16_384))
  );
}

export function isProviderUtilityChildMessage(
  value: unknown,
): value is ProviderUtilityChildMessage {
  if (isUtilityStatusMessage(value)) return true;
  if (!isRecord(value) || value.contractVersion !== ipcContractVersion)
    return false;
  if (value.type === "provider-host-network-request") {
    return (
      hasExactKeys(value, [
        "type",
        "contractVersion",
        "requestId",
        "request",
      ]) &&
      typeof value.requestId === "string" &&
      requestIdPattern.test(value.requestId) &&
      isNetworkRequest(value.request)
    );
  }
  if (value.type === "provider-host-credential-request") {
    return (
      hasExactKeys(value, [
        "type",
        "contractVersion",
        "requestId",
        "credentialKey",
      ]) &&
      typeof value.requestId === "string" &&
      requestIdPattern.test(value.requestId) &&
      typeof value.credentialKey === "string" &&
      credentialKeyPattern.test(value.credentialKey)
    );
  }
  if (value.type === "provider-host-log") {
    return (
      hasExactKeys(
        value,
        ["type", "contractVersion", "level", "code"],
        ["metadata"],
      ) &&
      ["debug", "info", "warn", "error"].includes(value.level as string) &&
      typeof value.code === "string" &&
      codePattern.test(value.code) &&
      (value.metadata === undefined || isRecord(value.metadata))
    );
  }
  if (value.type === "provider-host-status") {
    return (
      hasExactKeys(value, ["type", "contractVersion", "status"]) &&
      typeof value.status === "string" &&
      providerStatuses.has(value.status as ProviderStatus)
    );
  }
  return false;
}
