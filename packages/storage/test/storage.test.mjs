import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { openStorageDatabase } from "../dist/index.js";

const expectedTables = [
  "app_settings",
  "candles",
  "diagnostic_events",
  "instruments",
  "plugin_permissions",
  "plugins",
  "provider_profiles",
  "schema_migrations",
  "series_cache_state",
  "workspaces",
];

async function withDatabase(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "erc-storage-"));
  try {
    await run(path.join(directory, "data", "erc-chart.sqlite3"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("creates the versioned SQLite schema and records its migration", async () => {
  await withDatabase(async (databasePath) => {
    const database = await openStorageDatabase(databasePath);
    try {
      const tables = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map(({ name }) => name);
      const migrations = database
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all()
        .map(({ version }) => version);

      assert.deepEqual(tables, expectedTables);
      assert.deepEqual(migrations, [1]);
    } finally {
      database.close();
    }
  });
});

test("runs migrations idempotently", async () => {
  await withDatabase(async (databasePath) => {
    const first = await openStorageDatabase(databasePath);
    first.close();
    const database = await openStorageDatabase(databasePath);
    try {
      assert.equal(
        database
          .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
          .get().count,
        1,
      );
    } finally {
      database.close();
    }
  });
});

test("rolls back and closes the database when a migration fails", async () => {
  await withDatabase(async (databasePath) => {
    await mkdir(path.dirname(databasePath), { recursive: true });
    const setup = new DatabaseSync(databasePath);
    setup.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at_ms INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE diagnostic_events (preexisting INTEGER) STRICT;
    `);
    setup.close();

    const originalClose = DatabaseSync.prototype.close;
    let closeCalls = 0;
    DatabaseSync.prototype.close = function () {
      closeCalls += 1;
      return originalClose.call(this);
    };
    try {
      await assert.rejects(
        openStorageDatabase(databasePath),
        /table diagnostic_events already exists/,
      );
      assert.equal(closeCalls, 1);
    } finally {
      DatabaseSync.prototype.close = originalClose;
    }

    const database = new DatabaseSync(databasePath);
    try {
      const tables = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map(({ name }) => name);
      const migrations = database
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all();

      assert.deepEqual(tables, ["diagnostic_events", "schema_migrations"]);
      assert.deepEqual(migrations, []);
    } finally {
      database.close();
    }
  });
});

test("rejects a database created by a newer application version", async () => {
  await withDatabase(async (databasePath) => {
    const database = await openStorageDatabase(databasePath);
    database.exec("UPDATE schema_migrations SET version = 999");
    database.close();

    await assert.rejects(
      openStorageDatabase(databasePath),
      new Error(
        "Database schema version 999 is newer than supported version 1.",
      ),
    );

    const reopened = new DatabaseSync(databasePath);
    reopened.close();
  });
});
