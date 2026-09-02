import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  parseWorkspaceV1,
  serializeWorkspaceV1,
  type WorkspaceV1,
} from "./workspace-v1.js";

export {
  parseWorkspaceV1,
  serializeWorkspaceV1,
  validateWorkspaceV1,
} from "./workspace-v1.js";
export type {
  WorkspaceChartSlot,
  WorkspaceIndicator,
  WorkspaceIndicatorInput,
  WorkspaceTab,
  WorkspaceV1,
  WorkspaceViewport,
} from "./workspace-v1.js";

const migrations = [
  `
  CREATE TABLE provider_profiles (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    credential_target TEXT NOT NULL UNIQUE,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE instruments (
    provider_profile_id TEXT NOT NULL,
    instrument_id TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (provider_profile_id, instrument_id),
    FOREIGN KEY (provider_profile_id) REFERENCES provider_profiles(id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE candles (
    feed_id TEXT NOT NULL,
    instrument_id TEXT NOT NULL,
    timeframe_sec INTEGER NOT NULL CHECK (timeframe_sec > 0),
    open_time_ms INTEGER NOT NULL CHECK (open_time_ms >= 0),
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY (feed_id, instrument_id, timeframe_sec, open_time_ms),
    CHECK (high >= open AND high >= close AND low <= open AND low <= close)
  ) STRICT;
  CREATE INDEX candles_newest
    ON candles (feed_id, instrument_id, timeframe_sec, open_time_ms DESC);

  CREATE TABLE series_cache_state (
    feed_id TEXT NOT NULL,
    instrument_id TEXT NOT NULL,
    timeframe_sec INTEGER NOT NULL,
    oldest_time_ms INTEGER,
    newest_time_ms INTEGER,
    revision INTEGER NOT NULL,
    synchronized_at_ms INTEGER NOT NULL,
    PRIMARY KEY (feed_id, instrument_id, timeframe_sec)
  ) STRICT;

  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    name TEXT NOT NULL,
    document_json TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE plugins (
    plugin_id TEXT NOT NULL,
    version TEXT NOT NULL,
    kind TEXT NOT NULL,
    trust TEXT NOT NULL,
    status TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    integrity_hash TEXT NOT NULL,
    PRIMARY KEY (plugin_id, version)
  ) STRICT;

  CREATE TABLE plugin_permissions (
    plugin_id TEXT NOT NULL,
    version TEXT NOT NULL,
    permission TEXT NOT NULL,
    granted_at_ms INTEGER NOT NULL,
    PRIMARY KEY (plugin_id, version, permission),
    FOREIGN KEY (plugin_id, version) REFERENCES plugins(plugin_id, version) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    value_json TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE diagnostic_events (
    id INTEGER PRIMARY KEY,
    occurred_at_ms INTEGER NOT NULL,
    level TEXT NOT NULL,
    code TEXT NOT NULL,
    metadata_json TEXT NOT NULL
  ) STRICT;
  CREATE INDEX diagnostic_events_oldest ON diagnostic_events (occurred_at_ms);
  `,
] as const;

export interface StoredCandle {
  readonly feedId: string;
  readonly instrumentId: string;
  readonly timeframeSec: number;
  readonly openTimeMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
  readonly revision: number;
}

export interface CandleSeriesKey {
  readonly feedId: string;
  readonly instrumentId: string;
  readonly timeframeSec: number;
}

interface CandleRow {
  readonly feed_id: string;
  readonly instrument_id: string;
  readonly timeframe_sec: number;
  readonly open_time_ms: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number | null;
  readonly revision: number;
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${field} must be a finite number.`);
  return value;
}

function requireNonnegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`${field} must be a non-negative integer.`);
  return value as number;
}

function validateSeriesKey(
  input: CandleSeriesKey,
  rejectExtraFields = true,
): CandleSeriesKey {
  if (input === null || typeof input !== "object")
    throw new Error("Candle series key must be an object.");
  if (rejectExtraFields)
    assertFields(
      input,
      ["feedId", "instrumentId", "timeframeSec"],
      "candle series key",
    );
  return {
    feedId: requireProfileText(input.feedId, "feedId", 128),
    instrumentId: requireProfileText(input.instrumentId, "instrumentId", 128),
    timeframeSec: requirePositiveInteger(input.timeframeSec, "timeframeSec"),
  };
}

function validateCandle(input: StoredCandle): StoredCandle {
  if (input === null || typeof input !== "object")
    throw new Error("Candle must be an object.");
  assertFields(
    input,
    [
      "feedId",
      "instrumentId",
      "timeframeSec",
      "openTimeMs",
      "open",
      "high",
      "low",
      "close",
      "volume",
      "revision",
    ],
    "candle",
  );
  const candle = {
    ...validateSeriesKey(input, false),
    openTimeMs: requireNonnegativeInteger(input.openTimeMs, "openTimeMs"),
    open: requireFiniteNumber(input.open, "open"),
    high: requireFiniteNumber(input.high, "high"),
    low: requireFiniteNumber(input.low, "low"),
    close: requireFiniteNumber(input.close, "close"),
    ...(input.volume === undefined
      ? {}
      : { volume: requireFiniteNumber(input.volume, "volume") }),
    revision: requireNonnegativeInteger(input.revision, "revision"),
  };
  if (
    candle.high < candle.open ||
    candle.high < candle.close ||
    candle.low > candle.open ||
    candle.low > candle.close
  )
    throw new Error("Candle high and low must contain open and close.");
  return candle;
}

function toStoredCandle(row: CandleRow): StoredCandle {
  return {
    feedId: row.feed_id,
    instrumentId: row.instrument_id,
    timeframeSec: row.timeframe_sec,
    openTimeMs: row.open_time_ms,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    ...(row.volume === null ? {} : { volume: row.volume }),
    revision: row.revision,
  };
}

export function upsertCandles(
  database: DatabaseSync,
  candles: readonly StoredCandle[],
): number {
  if (!Array.isArray(candles)) throw new Error("Candles must be an array.");
  const checked = candles.map(validateCandle);
  if (checked.length === 0) return 0;
  return withTransaction(database, () => {
    const statement = database.prepare(`
      INSERT INTO candles
        (feed_id, instrument_id, timeframe_sec, open_time_ms, open, high, low, close, volume, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(feed_id, instrument_id, timeframe_sec, open_time_ms) DO UPDATE SET
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        volume = excluded.volume,
        revision = excluded.revision
    `);
    let changes = 0;
    for (const candle of checked) {
      changes += Number(
        statement.run(
          candle.feedId,
          candle.instrumentId,
          candle.timeframeSec,
          candle.openTimeMs,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume ?? null,
          candle.revision,
        ).changes,
      );
    }
    return changes;
  });
}

export function getCandles(
  database: DatabaseSync,
  key: CandleSeriesKey,
): readonly StoredCandle[] {
  const checked = validateSeriesKey(key);
  return (
    database
      .prepare(
        `
        SELECT feed_id, instrument_id, timeframe_sec, open_time_ms,
          open, high, low, close, volume, revision
        FROM candles
        WHERE feed_id = ? AND instrument_id = ? AND timeframe_sec = ?
        ORDER BY open_time_ms
      `,
      )
      .all(
        checked.feedId,
        checked.instrumentId,
        checked.timeframeSec,
      ) as unknown as CandleRow[]
  ).map(toStoredCandle);
}

export interface ProviderProfile {
  readonly id: string;
  readonly providerId: string;
  readonly displayName: string;
  readonly credentialReference: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface CreateProviderProfileInput {
  readonly id: string;
  readonly providerId: string;
  readonly displayName: string;
  readonly credentialReference: string;
}

export interface UpdateProviderProfileInput {
  readonly displayName: string;
}

interface ProviderProfileRow {
  readonly id: string;
  readonly provider_id: string;
  readonly display_name: string;
  readonly credential_target: string;
  readonly created_at_ms: number;
  readonly updated_at_ms: number;
}

const profileSelect = `
  SELECT id, provider_id, display_name, credential_target, created_at_ms, updated_at_ms
  FROM provider_profiles
`;

function assertFields(
  value: object,
  allowedFields: readonly string[],
  label: string,
): void {
  const unsupported = Object.keys(value).find(
    (field) => !allowedFields.includes(field),
  );
  if (unsupported !== undefined)
    throw new Error(`Unsupported ${label} field: ${unsupported}.`);
}

function requireProfileText(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > maximumLength
  )
    throw new Error(
      `${field} must be a non-empty, trimmed string of at most ${maximumLength} characters.`,
    );
  return value;
}

function validateProfileIdentity(id: unknown, providerId: unknown) {
  const validSegment = /^[A-Za-z0-9._-]+$/;
  const checkedId = requireProfileText(id, "id", 128);
  const checkedProviderId = requireProfileText(providerId, "providerId", 128);
  if (!validSegment.test(checkedId))
    throw new Error("id contains unsupported characters.");
  if (!validSegment.test(checkedProviderId))
    throw new Error("providerId contains unsupported characters.");
  return { id: checkedId, providerId: checkedProviderId };
}

function validateCredentialReference(
  value: unknown,
  providerId: string,
  profileId: string,
): string {
  const reference = requireProfileText(value, "credentialReference", 320);
  if (reference !== `ERC-chart/provider/${providerId}/${profileId}`)
    throw new Error(
      "credentialReference must be the opaque target for this provider profile.",
    );
  return reference;
}

function toProviderProfile(row: ProviderProfileRow): ProviderProfile {
  return {
    id: row.id,
    providerId: row.provider_id,
    displayName: row.display_name,
    credentialReference: row.credential_target,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

export function createProviderProfile(
  database: DatabaseSync,
  input: CreateProviderProfileInput,
): ProviderProfile {
  if (input === null || typeof input !== "object")
    throw new Error("Provider profile input must be an object.");
  assertFields(
    input,
    ["id", "providerId", "displayName", "credentialReference"],
    "provider profile",
  );
  const { id, providerId } = validateProfileIdentity(
    input.id,
    input.providerId,
  );
  const displayName = requireProfileText(input.displayName, "displayName", 256);
  const credentialReference = validateCredentialReference(
    input.credentialReference,
    providerId,
    id,
  );
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO provider_profiles
        (id, provider_id, display_name, credential_target, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, providerId, displayName, credentialReference, now, now);
  return {
    id,
    providerId,
    displayName,
    credentialReference,
    createdAtMs: now,
    updatedAtMs: now,
  };
}

export function getProviderProfile(
  database: DatabaseSync,
  id: string,
): ProviderProfile | undefined {
  const checkedId = requireProfileText(id, "id", 128);
  const row = database
    .prepare(`${profileSelect} WHERE id = ?`)
    .get(checkedId) as ProviderProfileRow | undefined;
  return row === undefined ? undefined : toProviderProfile(row);
}

export function listProviderProfiles(
  database: DatabaseSync,
): readonly ProviderProfile[] {
  return (
    database
      .prepare(`${profileSelect} ORDER BY id`)
      .all() as unknown as ProviderProfileRow[]
  ).map(toProviderProfile);
}

export function updateProviderProfile(
  database: DatabaseSync,
  id: string,
  input: UpdateProviderProfileInput,
): ProviderProfile {
  if (input === null || typeof input !== "object")
    throw new Error("Provider profile update must be an object.");
  assertFields(input, ["displayName"], "provider profile update");
  const checkedId = requireProfileText(id, "id", 128);
  const displayName = requireProfileText(input.displayName, "displayName", 256);
  const result = database
    .prepare(
      "UPDATE provider_profiles SET display_name = ?, updated_at_ms = ? WHERE id = ?",
    )
    .run(displayName, Date.now(), checkedId);
  if (result.changes === 0)
    throw new Error(`Provider profile not found: ${checkedId}.`);
  const profile = getProviderProfile(database, checkedId);
  if (profile === undefined)
    throw new Error(`Provider profile disappeared after update: ${checkedId}.`);
  return profile;
}

export function deleteProviderProfile(
  database: DatabaseSync,
  id: string,
): boolean {
  const checkedId = requireProfileText(id, "id", 128);
  return (
    database
      .prepare("DELETE FROM provider_profiles WHERE id = ?")
      .run(checkedId).changes > 0
  );
}

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | JsonObject;

export interface AppSetting {
  readonly key: string;
  readonly schemaVersion: number;
  readonly value: JsonValue;
  readonly updatedAtMs: number;
}

export interface PutAppSettingInput {
  readonly key: string;
  readonly schemaVersion: number;
  readonly value: JsonValue;
}

export type PluginKind = "provider" | "indicator";
export type PluginTrust = "bundled" | "signed" | "unsigned";
export type PluginStatus = "active" | "disabled" | "incompatible";

export interface PluginRegistryEntry {
  readonly pluginId: string;
  readonly version: string;
  readonly kind: PluginKind;
  readonly trust: PluginTrust;
  readonly status: PluginStatus;
  readonly manifest: JsonObject;
  readonly integrityHash: string;
  readonly permissions: readonly string[];
}

export type PutPluginInput = PluginRegistryEntry;

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const pluginVersionPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

interface AppSettingRow {
  readonly key: string;
  readonly schema_version: number;
  readonly value_json: string;
  readonly updated_at_ms: number;
}

interface PluginRow {
  readonly plugin_id: string;
  readonly version: string;
  readonly kind: string;
  readonly trust: string;
  readonly status: string;
  readonly manifest_json: string;
  readonly integrity_hash: string;
}

const settingSelect =
  "SELECT key, schema_version, value_json, updated_at_ms FROM app_settings";
const pluginSelect = `
  SELECT plugin_id, version, kind, trust, status, manifest_json, integrity_hash
  FROM plugins
`;

function cloneJson(
  value: unknown,
  label: string,
  seen = new WeakSet(),
): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object")
    throw new Error(`${label} must be JSON-compatible.`);
  if (seen.has(value)) throw new Error(`${label} must be JSON-compatible.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        Object.keys(value).length !== value.length ||
        !value.every((_, index) => Object.hasOwn(value, index))
      )
        throw new Error(`${label} must be JSON-compatible.`);
      return value.map((item) => cloneJson(item, label, seen));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error(`${label} must be JSON-compatible.`);
    const copy: Record<string, JsonValue> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string")
        throw new Error(`${label} must be JSON-compatible.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      )
        throw new Error(`${label} must be JSON-compatible.`);
      copy[key] = cloneJson(descriptor.value, label, seen);
    }
    return copy;
  } finally {
    seen.delete(value);
  }
}

function serializeJson(value: unknown, label: string): string {
  return JSON.stringify(cloneJson(value, label));
}

function parseJson(json: string, label: string): JsonValue {
  try {
    return cloneJson(JSON.parse(json), label);
  } catch (error) {
    throw new Error(`Stored ${label} is not valid JSON.`, { cause: error });
  }
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new Error(`${field} must be a positive integer.`);
  return value as number;
}

function requireRegistryText(
  value: unknown,
  field: string,
  pattern: RegExp,
  maximumLength: number,
): string {
  const text = requireProfileText(value, field, maximumLength);
  if (!pattern.test(text)) throw new Error(`${field} has an invalid format.`);
  return text;
}

function requirePluginId(value: unknown): string {
  return requireRegistryText(value, "pluginId", pluginIdPattern, 128);
}

function requirePluginVersion(value: unknown): string {
  return requireRegistryText(value, "version", pluginVersionPattern, 128);
}

function toAppSetting(row: AppSettingRow): AppSetting {
  return {
    key: row.key,
    schemaVersion: row.schema_version,
    value: parseJson(row.value_json, "app setting value"),
    updatedAtMs: row.updated_at_ms,
  };
}

export function putAppSetting(
  database: DatabaseSync,
  input: PutAppSettingInput,
): AppSetting {
  if (input === null || typeof input !== "object")
    throw new Error("App setting input must be an object.");
  assertFields(input, ["key", "schemaVersion", "value"], "app setting");
  const key = requireRegistryText(
    input.key,
    "key",
    /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/,
    128,
  );
  const schemaVersion = requirePositiveInteger(
    input.schemaVersion,
    "schemaVersion",
  );
  const valueJson = serializeJson(input.value, "App setting value");
  const updatedAtMs = Date.now();
  database
    .prepare(
      `INSERT INTO app_settings (key, schema_version, value_json, updated_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         schema_version = excluded.schema_version,
         value_json = excluded.value_json,
         updated_at_ms = excluded.updated_at_ms`,
    )
    .run(key, schemaVersion, valueJson, updatedAtMs);
  return {
    key,
    schemaVersion,
    value: parseJson(valueJson, "app setting value"),
    updatedAtMs,
  };
}

export function getAppSetting(
  database: DatabaseSync,
  key: string,
): AppSetting | undefined {
  const checkedKey = requireProfileText(key, "key", 128);
  const row = database
    .prepare(`${settingSelect} WHERE key = ?`)
    .get(checkedKey) as AppSettingRow | undefined;
  return row === undefined ? undefined : toAppSetting(row);
}

export function listAppSettings(database: DatabaseSync): readonly AppSetting[] {
  return (
    database
      .prepare(`${settingSelect} ORDER BY key`)
      .all() as unknown as AppSettingRow[]
  ).map(toAppSetting);
}

export function deleteAppSetting(database: DatabaseSync, key: string): boolean {
  const checkedKey = requireProfileText(key, "key", 128);
  return (
    database.prepare("DELETE FROM app_settings WHERE key = ?").run(checkedKey)
      .changes > 0
  );
}

function validatePlugin(input: PutPluginInput): {
  readonly pluginId: string;
  readonly version: string;
  readonly kind: PluginKind;
  readonly trust: PluginTrust;
  readonly status: PluginStatus;
  readonly manifestJson: string;
  readonly integrityHash: string;
  readonly permissions: readonly string[];
} {
  assertFields(
    input,
    [
      "pluginId",
      "version",
      "kind",
      "trust",
      "status",
      "manifest",
      "integrityHash",
      "permissions",
    ],
    "plugin",
  );
  const pluginId = requirePluginId(input.pluginId);
  const version = requirePluginVersion(input.version);
  if (input.kind !== "provider" && input.kind !== "indicator")
    throw new Error("kind must be provider or indicator.");
  if (!["bundled", "signed", "unsigned"].includes(input.trust))
    throw new Error("trust has an invalid value.");
  if (!["active", "disabled", "incompatible"].includes(input.status))
    throw new Error("status has an invalid value.");
  const manifestJson = serializeJson(input.manifest, "Plugin manifest");
  const manifest = parseJson(manifestJson, "plugin manifest");
  if (
    manifest === null ||
    Array.isArray(manifest) ||
    typeof manifest !== "object"
  )
    throw new Error("Plugin manifest must be an object.");
  const integrityHash = requireRegistryText(
    input.integrityHash,
    "integrityHash",
    /^sha256:[a-f0-9]{64}$/,
    71,
  );
  if (!Array.isArray(input.permissions))
    throw new Error("permissions must be an array.");
  const permissionValues = input.permissions.map((permission) =>
    requireRegistryText(
      permission,
      "permission",
      /^[A-Za-z0-9*.-]+(?::[A-Za-z0-9*.-]+)*$/,
      256,
    ),
  );
  if (new Set(permissionValues).size !== permissionValues.length)
    throw new Error("permissions must be unique.");
  const permissions = permissionValues.toSorted();
  return {
    pluginId,
    version,
    kind: input.kind,
    trust: input.trust,
    status: input.status,
    manifestJson,
    integrityHash,
    permissions,
  };
}

function pluginPermissions(
  database: DatabaseSync,
  pluginId: string,
  version: string,
): readonly string[] {
  return (
    database
      .prepare(
        `SELECT permission FROM plugin_permissions
         WHERE plugin_id = ? AND version = ? ORDER BY permission`,
      )
      .all(pluginId, version) as unknown as { readonly permission: string }[]
  ).map(({ permission }) => permission);
}

function toPlugin(database: DatabaseSync, row: PluginRow): PluginRegistryEntry {
  const manifest = parseJson(row.manifest_json, "plugin manifest");
  if (
    manifest === null ||
    Array.isArray(manifest) ||
    typeof manifest !== "object"
  )
    throw new Error("Stored plugin manifest is not an object.");
  const plugin = validatePlugin({
    pluginId: row.plugin_id,
    version: row.version,
    kind: row.kind as PluginKind,
    trust: row.trust as PluginTrust,
    status: row.status as PluginStatus,
    manifest: manifest as JsonObject,
    integrityHash: row.integrity_hash,
    permissions: pluginPermissions(database, row.plugin_id, row.version),
  });
  return {
    pluginId: plugin.pluginId,
    version: plugin.version,
    kind: plugin.kind,
    trust: plugin.trust,
    status: plugin.status,
    manifest: manifest as JsonObject,
    integrityHash: plugin.integrityHash,
    permissions: plugin.permissions,
  };
}

export function putPlugin(
  database: DatabaseSync,
  input: PutPluginInput,
): PluginRegistryEntry {
  if (input === null || typeof input !== "object")
    throw new Error("Plugin input must be an object.");
  const plugin = validatePlugin(input);
  withTransaction(database, () => {
    if (plugin.status === "active") {
      database
        .prepare(
          `UPDATE plugins SET status = 'disabled'
           WHERE plugin_id = ? AND version <> ? AND status = 'active'`,
        )
        .run(plugin.pluginId, plugin.version);
    }
    database
      .prepare(
        `INSERT INTO plugins
          (plugin_id, version, kind, trust, status, manifest_json, integrity_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(plugin_id, version) DO UPDATE SET
           kind = excluded.kind,
           trust = excluded.trust,
           status = excluded.status,
           manifest_json = excluded.manifest_json,
           integrity_hash = excluded.integrity_hash`,
      )
      .run(
        plugin.pluginId,
        plugin.version,
        plugin.kind,
        plugin.trust,
        plugin.status,
        plugin.manifestJson,
        plugin.integrityHash,
      );
    database
      .prepare(
        "DELETE FROM plugin_permissions WHERE plugin_id = ? AND version = ?",
      )
      .run(plugin.pluginId, plugin.version);
    const insertPermission = database.prepare(
      `INSERT INTO plugin_permissions
        (plugin_id, version, permission, granted_at_ms) VALUES (?, ?, ?, ?)`,
    );
    const grantedAtMs = Date.now();
    for (const permission of plugin.permissions)
      insertPermission.run(
        plugin.pluginId,
        plugin.version,
        permission,
        grantedAtMs,
      );
  });
  const stored = getPlugin(database, plugin.pluginId, plugin.version);
  if (stored === undefined)
    throw new Error("Plugin disappeared after persistence.");
  return stored;
}

export function getPlugin(
  database: DatabaseSync,
  pluginId: string,
  version: string,
): PluginRegistryEntry | undefined {
  const checkedPluginId = requirePluginId(pluginId);
  const checkedVersion = requirePluginVersion(version);
  const row = database
    .prepare(`${pluginSelect} WHERE plugin_id = ? AND version = ?`)
    .get(checkedPluginId, checkedVersion) as PluginRow | undefined;
  return row === undefined ? undefined : toPlugin(database, row);
}

export function listPlugins(
  database: DatabaseSync,
): readonly PluginRegistryEntry[] {
  return (
    database
      .prepare(`${pluginSelect} ORDER BY plugin_id, version`)
      .all() as unknown as PluginRow[]
  ).map((row) => toPlugin(database, row));
}

export function activatePlugin(
  database: DatabaseSync,
  pluginId: string,
  version: string,
): PluginRegistryEntry {
  const checkedPluginId = requirePluginId(pluginId);
  const checkedVersion = requirePluginVersion(version);
  withTransaction(database, () => {
    const target = database
      .prepare("SELECT status FROM plugins WHERE plugin_id = ? AND version = ?")
      .get(checkedPluginId, checkedVersion) as
      { readonly status: string } | undefined;
    if (target === undefined)
      throw new Error("Plugin version is not installed.");
    if (target.status === "incompatible")
      throw new Error("Incompatible plugin versions cannot be activated.");
    database
      .prepare(
        `UPDATE plugins SET status = 'disabled'
         WHERE plugin_id = ? AND version <> ? AND status = 'active'`,
      )
      .run(checkedPluginId, checkedVersion);
    database
      .prepare(
        "UPDATE plugins SET status = 'active' WHERE plugin_id = ? AND version = ?",
      )
      .run(checkedPluginId, checkedVersion);
  });
  const stored = getPlugin(database, checkedPluginId, checkedVersion);
  if (stored === undefined)
    throw new Error("Plugin disappeared after activation.");
  return stored;
}

export function disablePlugin(
  database: DatabaseSync,
  pluginId: string,
  version: string,
): PluginRegistryEntry {
  const checkedPluginId = requirePluginId(pluginId);
  const checkedVersion = requirePluginVersion(version);
  withTransaction(database, () => {
    const target = database
      .prepare("SELECT status FROM plugins WHERE plugin_id = ? AND version = ?")
      .get(checkedPluginId, checkedVersion) as
      { readonly status: string } | undefined;
    if (target === undefined)
      throw new Error("Plugin version is not installed.");
    if (target.status === "incompatible")
      throw new Error("Incompatible plugin versions cannot be disabled.");
    database
      .prepare(
        "UPDATE plugins SET status = 'disabled' WHERE plugin_id = ? AND version = ?",
      )
      .run(checkedPluginId, checkedVersion);
  });
  const stored = getPlugin(database, checkedPluginId, checkedVersion);
  if (stored === undefined)
    throw new Error("Plugin disappeared after disable.");
  return stored;
}

export function rollbackPlugin(
  database: DatabaseSync,
  pluginId: string,
  version: string,
): PluginRegistryEntry {
  return activatePlugin(database, pluginId, version);
}

export function deletePlugin(
  database: DatabaseSync,
  pluginId: string,
  version: string,
): boolean {
  const checkedPluginId = requirePluginId(pluginId);
  const checkedVersion = requirePluginVersion(version);
  return withTransaction(database, () => {
    const target = database
      .prepare("SELECT status FROM plugins WHERE plugin_id = ? AND version = ?")
      .get(checkedPluginId, checkedVersion) as
      { readonly status: string } | undefined;
    if (target === undefined) return false;
    if (target.status === "active")
      throw new Error(
        "Active plugin versions must be disabled before deletion.",
      );
    return (
      database
        .prepare("DELETE FROM plugins WHERE plugin_id = ? AND version = ?")
        .run(checkedPluginId, checkedVersion).changes > 0
    );
  });
}

export function saveWorkspace(
  database: DatabaseSync,
  workspace: unknown,
  instanceId: string,
): WorkspaceV1 {
  const documentJson = serializeWorkspaceV1(workspace);
  const document = parseWorkspaceV1(documentJson);
  const checkedInstanceId = requireRegistryText(
    instanceId,
    "instanceId",
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
    128,
  );
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO workspaces
        (id, schema_version, name, document_json, instance_id, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         schema_version = excluded.schema_version,
         name = excluded.name,
         document_json = excluded.document_json,
         instance_id = excluded.instance_id,
         updated_at_ms = excluded.updated_at_ms`,
    )
    .run(
      document.id,
      document.schemaVersion,
      document.name,
      documentJson,
      checkedInstanceId,
      now,
      now,
    );
  return document;
}

export function loadWorkspace(
  database: DatabaseSync,
  id: string,
): WorkspaceV1 | undefined {
  const checkedId = requireRegistryText(
    id,
    "id",
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
    128,
  );
  const row = database
    .prepare("SELECT document_json FROM workspaces WHERE id = ?")
    .get(checkedId) as { readonly document_json: string } | undefined;
  return row === undefined ? undefined : parseWorkspaceV1(row.document_json);
}

export function withTransaction<T>(database: DatabaseSync, run: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    if (
      typeof result === "object" &&
      result !== null &&
      "then" in result &&
      typeof result.then === "function"
    )
      throw new Error("Storage transactions must be synchronous.");
    database.exec("COMMIT");
    return result;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

export class StorageDatabaseCorruptionError extends Error {
  constructor(
    readonly databasePath: string,
    options?: ErrorOptions,
  ) {
    super(`Storage database is corrupt: ${databasePath}.`, options);
    this.name = "StorageDatabaseCorruptionError";
  }
}

const diagnosedCorruptions = new WeakSet<StorageDatabaseCorruptionError>();

function isSqliteCorruption(error: unknown): boolean {
  return (
    error instanceof StorageDatabaseCorruptionError ||
    (error instanceof Error &&
      "errcode" in error &&
      (error.errcode === 11 || error.errcode === 26))
  );
}

function configureDatabase(database: DatabaseSync, databasePath: string): void {
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA foreign_keys = ON");
  const result = database.prepare("PRAGMA quick_check").all() as unknown as {
    readonly quick_check: string;
  }[];
  if (result.some(({ quick_check }) => quick_check !== "ok"))
    throw new StorageDatabaseCorruptionError(databasePath);
  database.exec("PRAGMA journal_mode = WAL");
}

export async function openStorageDatabase(
  databasePath: string,
): Promise<DatabaseSync> {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    try {
      configureDatabase(database, databasePath);
    } catch (error) {
      if (isSqliteCorruption(error)) {
        const corruption = new StorageDatabaseCorruptionError(databasePath, {
          cause: error,
        });
        diagnosedCorruptions.add(corruption);
        throw corruption;
      }
      throw error;
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at_ms INTEGER NOT NULL
      ) STRICT
    `);

    const row = database
      .prepare(
        "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
      )
      .get() as { version: number };
    if (row.version > migrations.length) {
      throw new Error(
        `Database schema version ${row.version} is newer than supported version ${migrations.length}.`,
      );
    }

    for (
      let version = row.version + 1;
      version <= migrations.length;
      version += 1
    ) {
      const migration = migrations[version - 1];
      if (migration === undefined)
        throw new Error(`Missing migration ${version}.`);
      withTransaction(database, () => {
        database.exec(migration);
        database
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (?, ?)",
          )
          .run(version, Date.now());
      });
    }

    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export async function recoverStorageDatabase(
  corruption: StorageDatabaseCorruptionError,
): Promise<{
  readonly database: DatabaseSync;
  readonly quarantinePath: string;
}> {
  if (!diagnosedCorruptions.delete(corruption))
    throw new Error(
      "Storage database recovery requires a diagnosed corruption.",
    );
  const databasePath = corruption.databasePath;
  if (!existsSync(databasePath))
    throw new Error(`Storage database does not exist: ${databasePath}.`);

  let quarantinePath = `${databasePath}.corrupt-${Date.now()}`;
  while (existsSync(quarantinePath)) quarantinePath += "-1";

  const movedFiles: { readonly from: string; readonly to: string }[] = [];
  try {
    for (const suffix of ["", "-wal", "-shm"] as const) {
      const from = `${databasePath}${suffix}`;
      if (!existsSync(from)) continue;
      const to = `${quarantinePath}${suffix}`;
      renameSync(from, to);
      movedFiles.push({ from, to });
    }
  } catch (error) {
    for (const { from, to } of movedFiles.reverse()) {
      if (existsSync(to)) renameSync(to, from);
    }
    throw error;
  }

  try {
    return {
      database: await openStorageDatabase(databasePath),
      quarantinePath,
    };
  } catch (error) {
    for (const suffix of ["", "-wal", "-shm"] as const)
      rmSync(`${databasePath}${suffix}`, { force: true });
    throw error;
  }
}
