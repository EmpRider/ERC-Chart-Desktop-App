import type { Candle } from "./market-data.js";
import type { PluginManifestPermissions } from "./plugins.js";

export const providerImportPreviewChannel =
  "erc-chart:provider-import-preview" as const;
export const providerImportApproveChannel =
  "erc-chart:provider-import-approve" as const;
export const providerImportCancelChannel =
  "erc-chart:provider-import-cancel" as const;

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
  readonly candles: readonly Candle[];
}

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
    Array.isArray(value.candles) &&
    value.candles.every(isCandle)
  );
}
