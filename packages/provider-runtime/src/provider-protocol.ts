import {
  ipcContractVersion,
  isUtilityControlMessage,
  isUtilityStatusMessage,
  type Candle,
  type PluginManifestPermissions,
  type Tick,
  type UtilityControlMessage,
  type UtilityStatusMessage,
} from "@erc-chart/contracts";
import type {
  ProviderCapabilities,
  ProviderHistoryRequest,
  ProviderInstrument,
  ProviderNetworkRequest,
  ProviderNetworkResponse,
  ProviderSubscriptionRequest,
  ProviderStatus,
  ProviderWebSocketRequest,
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

export interface ProviderUtilityConfigurationValidationRequestMessage {
  readonly type: "provider-config-validation-request";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly settings: Readonly<Record<string, boolean | number | string>>;
}

export interface ProviderUtilityConfigurationValidationSuccessMessage {
  readonly type: "provider-config-validation-response";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly ok: true;
  readonly impact: "none" | "restart" | "reconnect";
  readonly settings: Readonly<Record<string, boolean | number | string>>;
  readonly changedKeys: readonly string[];
}

export interface ProviderUtilityConfigurationValidationFailureMessage {
  readonly type: "provider-config-validation-response";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly ok: false;
  readonly code: string;
}

export type ProviderUtilityConfigurationValidationResponseMessage =
  | ProviderUtilityConfigurationValidationSuccessMessage
  | ProviderUtilityConfigurationValidationFailureMessage;

export interface ProviderUtilityCapabilitiesRequestMessage {
  readonly type: "provider-capabilities-request";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
}

export interface ProviderUtilityInstrumentsRequestMessage {
  readonly type: "provider-instruments-request";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
}

export interface ProviderUtilityHistoryRequestMessage {
  readonly type: "provider-history-request";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly request: ProviderHistoryRequest;
}

export interface ProviderUtilitySubscribeRequestMessage {
  readonly type: "provider-subscribe-request";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly subscriptionId: string;
  readonly request: ProviderSubscriptionRequest;
}

export interface ProviderUtilityUnsubscribeRequestMessage {
  readonly type: "provider-unsubscribe-request";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly subscriptionId: string;
}

export type ProviderUtilityDataRequestMessage =
  | ProviderUtilityCapabilitiesRequestMessage
  | ProviderUtilityInstrumentsRequestMessage
  | ProviderUtilityHistoryRequestMessage
  | ProviderUtilitySubscribeRequestMessage
  | ProviderUtilityUnsubscribeRequestMessage;

export interface ProviderUtilityCapabilitiesSuccessMessage {
  readonly type: "provider-capabilities-response";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly ok: true;
  readonly capabilities: ProviderCapabilities;
}

export interface ProviderUtilityInstrumentsSuccessMessage {
  readonly type: "provider-instruments-response";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly ok: true;
  readonly instruments: readonly ProviderInstrument[];
}

export interface ProviderUtilityHistorySuccessMessage {
  readonly type: "provider-history-response";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly ok: true;
  readonly candles: readonly Candle[];
}

export interface ProviderUtilitySubscriptionSuccessMessage {
  readonly type:
    "provider-subscribe-response" | "provider-unsubscribe-response";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly ok: true;
}

export interface ProviderUtilityDataFailureMessage {
  readonly type:
    | "provider-capabilities-response"
    | "provider-instruments-response"
    | "provider-history-response"
    | "provider-subscribe-response"
    | "provider-unsubscribe-response";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly ok: false;
  readonly code: string;
}

export type ProviderUtilityDataResponseMessage =
  | ProviderUtilityCapabilitiesSuccessMessage
  | ProviderUtilityInstrumentsSuccessMessage
  | ProviderUtilityHistorySuccessMessage
  | ProviderUtilitySubscriptionSuccessMessage
  | ProviderUtilityDataFailureMessage;

export interface ProviderUtilitySubscriptionCandlesMessage {
  readonly type: "provider-subscription-candles";
  readonly contractVersion: typeof ipcContractVersion;
  readonly subscriptionId: string;
  readonly candles: readonly Candle[];
}

export interface ProviderUtilitySubscriptionTicksMessage {
  readonly type: "provider-subscription-ticks";
  readonly contractVersion: typeof ipcContractVersion;
  readonly subscriptionId: string;
  readonly ticks: readonly Tick[];
}

export interface ProviderUtilitySubscriptionErrorMessage {
  readonly type: "provider-subscription-error";
  readonly contractVersion: typeof ipcContractVersion;
  readonly subscriptionId: string;
  readonly code: string;
}

export interface ProviderUtilityNetworkRequestMessage {
  readonly type: "provider-host-network-request";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly request: ProviderNetworkRequest;
}

export interface ProviderUtilityWebSocketOpenRequestMessage {
  readonly type: "provider-host-websocket-open-request";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly socketId: string;
  readonly request: ProviderWebSocketRequest;
}

export interface ProviderUtilityWebSocketSendMessage {
  readonly type: "provider-host-websocket-send";
  readonly contractVersion: typeof ipcContractVersion;
  readonly socketId: string;
  readonly data: string | Uint8Array;
}

export interface ProviderUtilityWebSocketCloseMessage {
  readonly type: "provider-host-websocket-close";
  readonly contractVersion: typeof ipcContractVersion;
  readonly socketId: string;
  readonly code?: number;
  readonly reason?: string;
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

export interface ProviderUtilityWebSocketOpenSuccessMessage {
  readonly type: "provider-host-websocket-open-response";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly ok: true;
  readonly socketId: string;
}

export interface ProviderUtilityWebSocketMessage {
  readonly type: "provider-host-websocket-message";
  readonly contractVersion: typeof ipcContractVersion;
  readonly socketId: string;
  readonly data: string | Uint8Array;
}

export interface ProviderUtilityWebSocketClosedMessage {
  readonly type: "provider-host-websocket-closed";
  readonly contractVersion: typeof ipcContractVersion;
  readonly socketId: string;
  readonly code: number;
  readonly reason: string;
}

export interface ProviderUtilityWebSocketErrorMessage {
  readonly type: "provider-host-websocket-error";
  readonly contractVersion: typeof ipcContractVersion;
  readonly socketId: string;
  readonly code: string;
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
    | "provider-host-network-response"
    | "provider-host-credential-response"
    | "provider-host-websocket-open-response";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly ok: false;
  readonly code: string;
}

export type ProviderUtilityHostResponseMessage =
  | ProviderUtilityNetworkSuccessMessage
  | ProviderUtilityCredentialSuccessMessage
  | ProviderUtilityWebSocketOpenSuccessMessage
  | ProviderUtilityHostFailureMessage;

export type ProviderUtilityParentMessage =
  | UtilityControlMessage
  | ProviderUtilityInitializeMessage
  | ProviderUtilityConfigurationValidationRequestMessage
  | ProviderUtilityDataRequestMessage
  | ProviderUtilityHostResponseMessage
  | ProviderUtilityWebSocketMessage
  | ProviderUtilityWebSocketClosedMessage
  | ProviderUtilityWebSocketErrorMessage;

export type ProviderUtilityChildMessage =
  | UtilityStatusMessage
  | ProviderUtilityConfigurationValidationResponseMessage
  | ProviderUtilityDataResponseMessage
  | ProviderUtilitySubscriptionCandlesMessage
  | ProviderUtilitySubscriptionTicksMessage
  | ProviderUtilitySubscriptionErrorMessage
  | ProviderUtilityNetworkRequestMessage
  | ProviderUtilityWebSocketOpenRequestMessage
  | ProviderUtilityWebSocketSendMessage
  | ProviderUtilityWebSocketCloseMessage
  | ProviderUtilityCredentialRequestMessage
  | ProviderUtilityLogMessage
  | ProviderUtilityProviderStatusMessage;

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u;
const versionPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const credentialKeyPattern = /^[a-z][a-z0-9_-]{0,63}$/u;
const requestIdPattern = /^[A-Za-z0-9._-]{1,96}$/u;
const codePattern = /^[A-Z][A-Z0-9_.-]{0,127}$/u;
const settingKeyPattern = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;
const dataIdPattern = /^[A-Za-z0-9._:/-]{1,256}$/u;
const subscriptionIdPattern = /^[A-Za-z0-9._-]{1,96}$/u;
const socketIdPattern = /^[A-Za-z0-9._-]{1,96}$/u;
const configurationImpacts = new Set(["none", "restart", "reconnect"]);
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
        settingKeyPattern.test(key) &&
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

function isWebSocketRequest(value: unknown): value is ProviderWebSocketRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["url"], ["headers", "protocols"]) ||
    typeof value.url !== "string" ||
    value.url.length === 0 ||
    value.url.length > 32_768
  ) {
    return false;
  }
  try {
    if (new URL(value.url).protocol !== "wss:") return false;
  } catch {
    return false;
  }
  if (value.headers !== undefined && !isHeaders(value.headers)) return false;
  return (
    value.protocols === undefined ||
    isStringArray(value.protocols, 16, (item) =>
      /^[!#$%&'*+\-.0-9A-Z^_`a-z|~]{1,128}$/u.test(item),
    )
  );
}

function isWebSocketData(value: unknown): value is string | Uint8Array {
  return (
    (typeof value === "string" && value.length <= 2_000_000) ||
    (value instanceof Uint8Array && value.byteLength <= 2_000_000)
  );
}

function isWebSocketCloseCode(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1000 &&
    value <= 4999
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isProviderHistoryRequest(
  value: unknown,
): value is ProviderHistoryRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      ["instrumentId", "timeframeId"],
      ["fromMs", "toMs", "limit"],
    ) ||
    typeof value.instrumentId !== "string" ||
    !dataIdPattern.test(value.instrumentId) ||
    typeof value.timeframeId !== "string" ||
    !dataIdPattern.test(value.timeframeId)
  ) {
    return false;
  }
  if (value.fromMs !== undefined && !isSafeInteger(value.fromMs)) return false;
  if (value.toMs !== undefined && !isSafeInteger(value.toMs)) return false;
  return (
    value.limit === undefined ||
    (isSafeInteger(value.limit) && value.limit >= 1 && value.limit <= 100_000)
  );
}

function isProviderSubscriptionRequest(
  value: unknown,
): value is ProviderSubscriptionRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["instrumentId", "timeframeId"]) &&
    typeof value.instrumentId === "string" &&
    dataIdPattern.test(value.instrumentId) &&
    typeof value.timeframeId === "string" &&
    dataIdPattern.test(value.timeframeId)
  );
}

function isCandle(value: unknown): value is Candle {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      [
        "instrumentId",
        "timeframeId",
        "openTimeMs",
        "open",
        "high",
        "low",
        "close",
      ],
      ["volume"],
    ) ||
    typeof value.instrumentId !== "string" ||
    !dataIdPattern.test(value.instrumentId) ||
    typeof value.timeframeId !== "string" ||
    !dataIdPattern.test(value.timeframeId) ||
    !isSafeInteger(value.openTimeMs) ||
    !isFiniteNumber(value.open) ||
    !isFiniteNumber(value.high) ||
    !isFiniteNumber(value.low) ||
    !isFiniteNumber(value.close) ||
    (value.volume !== undefined && !isFiniteNumber(value.volume))
  ) {
    return false;
  }
  return (
    value.high >= Math.max(value.open, value.low, value.close) &&
    value.low <= Math.min(value.open, value.high, value.close)
  );
}

function isTick(value: unknown): value is Tick {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["instrumentId", "timestampMs", "price"], ["volume"]) &&
    typeof value.instrumentId === "string" &&
    dataIdPattern.test(value.instrumentId) &&
    isSafeInteger(value.timestampMs) &&
    isFiniteNumber(value.price) &&
    (value.volume === undefined || isFiniteNumber(value.volume))
  );
}

function isCandleArray(value: unknown): value is readonly Candle[] {
  return (
    Array.isArray(value) && value.length <= 100_000 && value.every(isCandle)
  );
}

function isTickArray(value: unknown): value is readonly Tick[] {
  return Array.isArray(value) && value.length <= 100_000 && value.every(isTick);
}

function isCapabilities(value: unknown): value is ProviderCapabilities {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "instruments",
      "nativeTimeframes",
      "liveData",
      "derivedTimeframes",
      ...(value.derivedTimeframeIds === undefined
        ? []
        : ["derivedTimeframeIds"]),
    ]) &&
    typeof value.instruments === "boolean" &&
    isStringArray(value.nativeTimeframes, 1_024, (item) =>
      dataIdPattern.test(item),
    ) &&
    typeof value.liveData === "boolean" &&
    typeof value.derivedTimeframes === "boolean" &&
    (value.derivedTimeframeIds === undefined ||
      isStringArray(value.derivedTimeframeIds, 1_024, (item) =>
        dataIdPattern.test(item),
      ))
  );
}

function isInstrument(value: unknown): value is ProviderInstrument {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["id", "symbol", "name"]) &&
    typeof value.id === "string" &&
    dataIdPattern.test(value.id) &&
    typeof value.symbol === "string" &&
    value.symbol.length > 0 &&
    value.symbol.length <= 256 &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 512
  );
}

function isInstrumentArray(
  value: unknown,
): value is readonly ProviderInstrument[] {
  return (
    Array.isArray(value) && value.length <= 100_000 && value.every(isInstrument)
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
  if (value.type === "provider-config-validation-request") {
    return (
      hasExactKeys(value, [
        "type",
        "contractVersion",
        "requestId",
        "settings",
      ]) &&
      typeof value.requestId === "string" &&
      requestIdPattern.test(value.requestId) &&
      isSettings(value.settings)
    );
  }
  if (
    value.type === "provider-capabilities-request" ||
    value.type === "provider-instruments-request"
  ) {
    return (
      hasExactKeys(value, ["type", "contractVersion", "requestId"]) &&
      typeof value.requestId === "string" &&
      requestIdPattern.test(value.requestId)
    );
  }
  if (value.type === "provider-history-request") {
    return (
      hasExactKeys(value, [
        "type",
        "contractVersion",
        "requestId",
        "request",
      ]) &&
      typeof value.requestId === "string" &&
      requestIdPattern.test(value.requestId) &&
      isProviderHistoryRequest(value.request)
    );
  }
  if (value.type === "provider-subscribe-request") {
    return (
      hasExactKeys(value, [
        "type",
        "contractVersion",
        "requestId",
        "subscriptionId",
        "request",
      ]) &&
      typeof value.requestId === "string" &&
      requestIdPattern.test(value.requestId) &&
      typeof value.subscriptionId === "string" &&
      subscriptionIdPattern.test(value.subscriptionId) &&
      isProviderSubscriptionRequest(value.request)
    );
  }
  if (value.type === "provider-unsubscribe-request") {
    return (
      hasExactKeys(value, [
        "type",
        "contractVersion",
        "requestId",
        "subscriptionId",
      ]) &&
      typeof value.requestId === "string" &&
      requestIdPattern.test(value.requestId) &&
      typeof value.subscriptionId === "string" &&
      subscriptionIdPattern.test(value.subscriptionId)
    );
  }
  if (value.type === "provider-host-websocket-message") {
    return (
      hasExactKeys(value, ["type", "contractVersion", "socketId", "data"]) &&
      typeof value.socketId === "string" &&
      socketIdPattern.test(value.socketId) &&
      isWebSocketData(value.data)
    );
  }
  if (value.type === "provider-host-websocket-closed") {
    return (
      hasExactKeys(value, [
        "type",
        "contractVersion",
        "socketId",
        "code",
        "reason",
      ]) &&
      typeof value.socketId === "string" &&
      socketIdPattern.test(value.socketId) &&
      isWebSocketCloseCode(value.code) &&
      typeof value.reason === "string" &&
      value.reason.length <= 512
    );
  }
  if (value.type === "provider-host-websocket-error") {
    return (
      hasExactKeys(value, ["type", "contractVersion", "socketId", "code"]) &&
      typeof value.socketId === "string" &&
      socketIdPattern.test(value.socketId) &&
      typeof value.code === "string" &&
      codePattern.test(value.code)
    );
  }
  if (
    value.type !== "provider-host-network-response" &&
    value.type !== "provider-host-credential-response" &&
    value.type !== "provider-host-websocket-open-response"
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
  if (value.type === "provider-host-websocket-open-response") {
    return (
      hasExactKeys(value, [
        "type",
        "contractVersion",
        "requestId",
        "ok",
        "socketId",
      ]) &&
      typeof value.socketId === "string" &&
      socketIdPattern.test(value.socketId)
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
  if (value.type === "provider-config-validation-response") {
    if (
      typeof value.requestId !== "string" ||
      !requestIdPattern.test(value.requestId) ||
      typeof value.ok !== "boolean"
    ) {
      return false;
    }
    if (value.ok === false) {
      return (
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
    return (
      hasExactKeys(value, [
        "type",
        "contractVersion",
        "requestId",
        "ok",
        "impact",
        "settings",
        "changedKeys",
      ]) &&
      typeof value.impact === "string" &&
      configurationImpacts.has(value.impact) &&
      isSettings(value.settings) &&
      isStringArray(value.changedKeys, 128, (item) =>
        settingKeyPattern.test(item),
      )
    );
  }
  if (
    value.type === "provider-capabilities-response" ||
    value.type === "provider-instruments-response" ||
    value.type === "provider-history-response" ||
    value.type === "provider-subscribe-response" ||
    value.type === "provider-unsubscribe-response"
  ) {
    if (
      typeof value.requestId !== "string" ||
      !requestIdPattern.test(value.requestId) ||
      typeof value.ok !== "boolean"
    ) {
      return false;
    }
    if (value.ok === false) {
      return (
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
    if (value.type === "provider-capabilities-response") {
      return (
        hasExactKeys(value, [
          "type",
          "contractVersion",
          "requestId",
          "ok",
          "capabilities",
        ]) && isCapabilities(value.capabilities)
      );
    }
    if (value.type === "provider-instruments-response") {
      return (
        hasExactKeys(value, [
          "type",
          "contractVersion",
          "requestId",
          "ok",
          "instruments",
        ]) && isInstrumentArray(value.instruments)
      );
    }
    if (value.type === "provider-history-response") {
      return (
        hasExactKeys(value, [
          "type",
          "contractVersion",
          "requestId",
          "ok",
          "candles",
        ]) && isCandleArray(value.candles)
      );
    }
    return hasExactKeys(value, ["type", "contractVersion", "requestId", "ok"]);
  }
  if (value.type === "provider-subscription-candles") {
    return (
      hasExactKeys(value, [
        "type",
        "contractVersion",
        "subscriptionId",
        "candles",
      ]) &&
      typeof value.subscriptionId === "string" &&
      subscriptionIdPattern.test(value.subscriptionId) &&
      isCandleArray(value.candles)
    );
  }
  if (value.type === "provider-subscription-ticks") {
    return (
      hasExactKeys(value, [
        "type",
        "contractVersion",
        "subscriptionId",
        "ticks",
      ]) &&
      typeof value.subscriptionId === "string" &&
      subscriptionIdPattern.test(value.subscriptionId) &&
      isTickArray(value.ticks)
    );
  }
  if (value.type === "provider-subscription-error") {
    return (
      hasExactKeys(value, [
        "type",
        "contractVersion",
        "subscriptionId",
        "code",
      ]) &&
      typeof value.subscriptionId === "string" &&
      subscriptionIdPattern.test(value.subscriptionId) &&
      typeof value.code === "string" &&
      codePattern.test(value.code)
    );
  }
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
  if (value.type === "provider-host-websocket-open-request") {
    return (
      hasExactKeys(value, [
        "type",
        "contractVersion",
        "requestId",
        "socketId",
        "request",
      ]) &&
      typeof value.requestId === "string" &&
      requestIdPattern.test(value.requestId) &&
      typeof value.socketId === "string" &&
      socketIdPattern.test(value.socketId) &&
      isWebSocketRequest(value.request)
    );
  }
  if (value.type === "provider-host-websocket-send") {
    return (
      hasExactKeys(value, ["type", "contractVersion", "socketId", "data"]) &&
      typeof value.socketId === "string" &&
      socketIdPattern.test(value.socketId) &&
      isWebSocketData(value.data)
    );
  }
  if (value.type === "provider-host-websocket-close") {
    return (
      hasExactKeys(
        value,
        ["type", "contractVersion", "socketId"],
        ["code", "reason"],
      ) &&
      typeof value.socketId === "string" &&
      socketIdPattern.test(value.socketId) &&
      (value.code === undefined || isWebSocketCloseCode(value.code)) &&
      (value.reason === undefined ||
        (typeof value.reason === "string" && value.reason.length <= 512))
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
