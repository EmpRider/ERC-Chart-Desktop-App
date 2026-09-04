import type { Candle } from "./market-data.js";
import type { PluginManifestPermissions } from "./plugins.js";

export const providerImportPreviewChannel =
  "erc-chart:provider-import-preview" as const;
export const providerImportApproveChannel =
  "erc-chart:provider-import-approve" as const;
export const providerImportCancelChannel =
  "erc-chart:provider-import-cancel" as const;
export const providerLiveSubscribeChannel =
  "erc-chart:provider-live-subscribe" as const;
export const providerLiveUnsubscribeChannel =
  "erc-chart:provider-live-unsubscribe" as const;
export const providerLiveEventChannel =
  "erc-chart:provider-live-event" as const;
export const providerProfilesListChannel =
  "erc-chart:provider-profiles-list" as const;
export const providerProfileCreateChannel =
  "erc-chart:provider-profile-create" as const;
export const providerProfileUpdateChannel =
  "erc-chart:provider-profile-update" as const;
export const providerProfileStartChannel =
  "erc-chart:provider-profile-start" as const;
export const providerSessionLoadChannel =
  "erc-chart:provider-session-load" as const;
export const providerProfileStopChannel =
  "erc-chart:provider-profile-stop" as const;
export const providerProfileDeleteChannel =
  "erc-chart:provider-profile-delete" as const;

export interface ProviderImportPreview {
  readonly requestId: string;
  readonly pluginId: string;
  readonly pluginName: string;
  readonly pluginVersion: string;
  readonly mode: "developer";
  readonly trust: "unsigned";
  readonly permissions: PluginManifestPermissions;
}

export type ProviderImportCredentialValues = Readonly<Record<string, string>>;

export interface ImportedProviderInstrument {
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
}

export interface ImportedProviderSession {
  readonly profileId: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly instrument: ImportedProviderInstrument;
  readonly timeframeId: string;
  readonly availableTimeframeIds?: readonly string[];
  readonly candles: readonly Candle[];
}

export type ProviderProfileRuntimeStatus =
  "idle" | "starting" | "ready" | "stopping" | "stopped" | "failed";

export type ProviderProfileSettingValue = boolean | number | string;
export type ProviderProfileSettings = Readonly<
  Record<string, ProviderProfileSettingValue>
>;

export interface InstalledProviderSummary {
  readonly providerId: string;
  readonly providerName: string;
  readonly version: string;
  readonly credentialKeys: readonly string[];
}

export interface ProviderProfileSummary {
  readonly profileId: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly version: string;
  readonly displayName: string;
  readonly status: ProviderProfileRuntimeStatus;
  readonly settings: ProviderProfileSettings;
  readonly credentialKeys: readonly string[];
}

export interface ProviderManagementSnapshot {
  readonly installedProviders: readonly InstalledProviderSummary[];
  readonly profiles: readonly ProviderProfileSummary[];
}

export interface ProviderProfileCreateRequest {
  readonly providerId: string;
  readonly displayName: string;
  readonly settings: ProviderProfileSettings;
  readonly credentials: ProviderImportCredentialValues;
}

export interface ProviderProfileUpdateRequest {
  readonly profileId: string;
  readonly displayName: string;
  readonly settings: ProviderProfileSettings;
  readonly credentials?: ProviderImportCredentialValues;
}

export interface ProviderLiveRequest {
  readonly profileId: string;
  readonly instrumentId: string;
  readonly timeframeId: string;
}

export interface ProviderSessionRequest {
  readonly profileId: string;
  readonly instrumentId: string;
  readonly timeframeId: string;
}

export interface ProviderLiveSubscriptionRequest extends ProviderLiveRequest {
  readonly subscriptionId: string;
}

export interface ProviderLiveCandlesEvent {
  readonly subscriptionId: string;
  readonly type: "candles";
  readonly candles: readonly Candle[];
}

export interface ProviderLiveErrorEvent {
  readonly subscriptionId: string;
  readonly type: "error";
  readonly code: string;
}

export type ProviderLiveEvent =
  ProviderLiveCandlesEvent | ProviderLiveErrorEvent;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function isProviderImportCredentialValues(
  value: unknown,
): value is ProviderImportCredentialValues {
  return (
    isRecord(value) &&
    Object.keys(value).length <= 32 &&
    Object.entries(value).every(
      ([key, item]) =>
        /^[a-z][a-z0-9_-]{0,63}$/u.test(key) &&
        typeof item === "string" &&
        item.length > 0 &&
        item.length <= 16_384,
    )
  );
}

function isPermissions(value: unknown): value is PluginManifestPermissions {
  if (!isRecord(value)) return false;
  return (
    isStringArray(value.network) &&
    isStringArray(value.credentials) &&
    Array.isArray(value.storage) &&
    value.storage.every(
      (item) => item === "plugin-settings" || item === "provider-cache",
    )
  );
}

function isCandle(value: unknown): value is Candle {
  if (!isRecord(value)) return false;
  return (
    typeof value.instrumentId === "string" &&
    typeof value.timeframeId === "string" &&
    typeof value.openTimeMs === "number" &&
    Number.isFinite(value.openTimeMs) &&
    typeof value.open === "number" &&
    Number.isFinite(value.open) &&
    typeof value.high === "number" &&
    Number.isFinite(value.high) &&
    typeof value.low === "number" &&
    Number.isFinite(value.low) &&
    typeof value.close === "number" &&
    Number.isFinite(value.close) &&
    (value.volume === undefined ||
      (typeof value.volume === "number" && Number.isFinite(value.volume)))
  );
}

function isBoundedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 256
  );
}

function isProfileSettings(value: unknown): value is ProviderProfileSettings {
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

function isRuntimeStatus(
  value: unknown,
): value is ProviderProfileRuntimeStatus {
  return (
    value === "idle" ||
    value === "starting" ||
    value === "ready" ||
    value === "stopping" ||
    value === "stopped" ||
    value === "failed"
  );
}

function isInstalledProviderSummary(
  value: unknown,
): value is InstalledProviderSummary {
  return (
    isRecord(value) &&
    isBoundedIdentifier(value.providerId) &&
    isBoundedIdentifier(value.providerName) &&
    isBoundedIdentifier(value.version) &&
    isStringArray(value.credentialKeys)
  );
}

export function isProviderProfileSummary(
  value: unknown,
): value is ProviderProfileSummary {
  return (
    isRecord(value) &&
    isBoundedIdentifier(value.profileId) &&
    isBoundedIdentifier(value.providerId) &&
    isBoundedIdentifier(value.providerName) &&
    isBoundedIdentifier(value.version) &&
    isBoundedIdentifier(value.displayName) &&
    isRuntimeStatus(value.status) &&
    isProfileSettings(value.settings) &&
    isStringArray(value.credentialKeys)
  );
}

export function isProviderManagementSnapshot(
  value: unknown,
): value is ProviderManagementSnapshot {
  return (
    isRecord(value) &&
    Array.isArray(value.installedProviders) &&
    value.installedProviders.every(isInstalledProviderSummary) &&
    Array.isArray(value.profiles) &&
    value.profiles.every(isProviderProfileSummary)
  );
}

export function isProviderProfileCreateRequest(
  value: unknown,
): value is ProviderProfileCreateRequest {
  return (
    isRecord(value) &&
    isBoundedIdentifier(value.providerId) &&
    isBoundedIdentifier(value.displayName) &&
    isProfileSettings(value.settings) &&
    isProviderImportCredentialValues(value.credentials)
  );
}

export function isProviderProfileUpdateRequest(
  value: unknown,
): value is ProviderProfileUpdateRequest {
  return (
    isRecord(value) &&
    isBoundedIdentifier(value.profileId) &&
    isBoundedIdentifier(value.displayName) &&
    isProfileSettings(value.settings) &&
    (value.credentials === undefined ||
      isProviderImportCredentialValues(value.credentials))
  );
}

export function isProviderLiveRequest(
  value: unknown,
): value is ProviderLiveRequest {
  if (!isRecord(value)) return false;
  return (
    isBoundedIdentifier(value.profileId) &&
    isBoundedIdentifier(value.instrumentId) &&
    isBoundedIdentifier(value.timeframeId)
  );
}

export function isProviderSessionRequest(
  value: unknown,
): value is ProviderSessionRequest {
  return isProviderLiveRequest(value);
}

export function isProviderLiveSubscriptionId(value: unknown): value is string {
  return isBoundedIdentifier(value) && /^[A-Za-z0-9._:-]+$/u.test(value);
}

export function isProviderLiveSubscriptionRequest(
  value: unknown,
): value is ProviderLiveSubscriptionRequest {
  return (
    isProviderLiveRequest(value) &&
    isRecord(value) &&
    isProviderLiveSubscriptionId(value.subscriptionId)
  );
}

export function isProviderLiveEvent(
  value: unknown,
): value is ProviderLiveEvent {
  if (
    !isRecord(value) ||
    !isProviderLiveSubscriptionId(value.subscriptionId) ||
    (value.type !== "candles" && value.type !== "error")
  ) {
    return false;
  }
  if (value.type === "candles") {
    return Array.isArray(value.candles) && value.candles.every(isCandle);
  }
  return isBoundedIdentifier(value.code);
}

export function isProviderImportPreview(
  value: unknown,
): value is ProviderImportPreview {
  if (!isRecord(value)) return false;
  return (
    typeof value.requestId === "string" &&
    value.requestId.length > 0 &&
    typeof value.pluginId === "string" &&
    value.pluginId.length > 0 &&
    typeof value.pluginName === "string" &&
    value.pluginName.length > 0 &&
    typeof value.pluginVersion === "string" &&
    value.pluginVersion.length > 0 &&
    value.mode === "developer" &&
    value.trust === "unsigned" &&
    isPermissions(value.permissions)
  );
}

export function isProviderImportPreviewResult(
  value: unknown,
): value is ProviderImportPreview | null {
  return value === null || isProviderImportPreview(value);
}

export function isImportedProviderSession(
  value: unknown,
): value is ImportedProviderSession {
  if (!isRecord(value) || !isRecord(value.instrument)) return false;
  return (
    typeof value.profileId === "string" &&
    value.profileId.length > 0 &&
    typeof value.providerId === "string" &&
    value.providerId.length > 0 &&
    typeof value.providerName === "string" &&
    value.providerName.length > 0 &&
    typeof value.instrument.id === "string" &&
    value.instrument.id.length > 0 &&
    typeof value.instrument.symbol === "string" &&
    value.instrument.symbol.length > 0 &&
    typeof value.instrument.name === "string" &&
    value.instrument.name.length > 0 &&
    typeof value.timeframeId === "string" &&
    value.timeframeId.length > 0 &&
    (value.availableTimeframeIds === undefined ||
      (Array.isArray(value.availableTimeframeIds) &&
        value.availableTimeframeIds.every(isBoundedIdentifier))) &&
    Array.isArray(value.candles) &&
    value.candles.every(isCandle)
  );
}
