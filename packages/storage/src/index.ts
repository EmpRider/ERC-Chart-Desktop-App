import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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
