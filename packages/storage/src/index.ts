import { mkdirSync } from "node:fs";
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

export async function openStorageDatabase(
  databasePath: string,
): Promise<DatabaseSync> {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = ON");
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
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(migration);
        database
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (?, ?)",
          )
          .run(version, Date.now());
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }

    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
