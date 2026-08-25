import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  createProviderProfile,
  deleteProviderProfile,
  getProviderProfile,
  listProviderProfiles,
  openStorageDatabase,
  recoverStorageDatabase,
  StorageDatabaseCorruptionError,
  updateProviderProfile,
  withTransaction,
} from "../dist/index.js";

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

test("configures WAL, foreign keys, and a five-second busy timeout", async () => {
  await withDatabase(async (databasePath) => {
    const database = await openStorageDatabase(databasePath);
    try {
      assert.equal(
        database.prepare("PRAGMA journal_mode").get().journal_mode,
        "wal",
      );
      assert.equal(
        database.prepare("PRAGMA foreign_keys").get().foreign_keys,
        1,
      );
      assert.equal(
        database.prepare("PRAGMA busy_timeout").get().timeout,
        5_000,
      );
    } finally {
      database.close();
    }
  });
});

test("commits successful transactions and rolls back failed transactions", async () => {
  await withDatabase(async (databasePath) => {
    const database = await openStorageDatabase(databasePath);
    try {
      const insert = database.prepare(
        "INSERT INTO app_settings (key, schema_version, value_json, updated_at_ms) VALUES (?, 1, '{}', 0)",
      );
      assert.equal(
        withTransaction(database, () => insert.run("committed").changes),
        1,
      );
      assert.throws(
        () =>
          withTransaction(database, () => {
            insert.run("rolled-back");
            throw new Error("stop");
          }),
        /stop/,
      );
      assert.throws(
        () => withTransaction(database, () => Promise.resolve()),
        /must be synchronous/,
      );
      assert.equal(database.isTransaction, false);
      assert.deepEqual(
        database
          .prepare("SELECT key FROM app_settings ORDER BY key")
          .all()
          .map(({ key }) => key),
        ["committed"],
      );
    } finally {
      database.close();
    }
  });
});

test("preserves a corrupt database before rebuilding it", async () => {
  await withDatabase(async (databasePath) => {
    await mkdir(path.dirname(databasePath), { recursive: true });
    const corruptContents = Buffer.from("not a sqlite database");
    const corruptWalContents = Buffer.from("corrupt wal");
    const corruptShmContents = Buffer.from("corrupt shm");
    await writeFile(databasePath, corruptContents);

    const corruption = await openStorageDatabase(databasePath).then(
      () => assert.fail("Expected corrupt database rejection."),
      (error) => {
        assert.ok(error instanceof StorageDatabaseCorruptionError);
        return error;
      },
    );
    assert.deepEqual(await readFile(databasePath), corruptContents);
    await writeFile(`${databasePath}-wal`, corruptWalContents);
    await writeFile(`${databasePath}-shm`, corruptShmContents);
    await assert.rejects(
      recoverStorageDatabase(new StorageDatabaseCorruptionError(databasePath)),
      /requires a diagnosed corruption/,
    );

    const { database, quarantinePath } =
      await recoverStorageDatabase(corruption);
    try {
      assert.match(quarantinePath, /\.corrupt-\d+$/);
      assert.deepEqual(await readFile(quarantinePath), corruptContents);
      assert.deepEqual(
        await readFile(`${quarantinePath}-wal`),
        corruptWalContents,
      );
      assert.deepEqual(
        await readFile(`${quarantinePath}-shm`),
        corruptShmContents,
      );
      assert.equal(
        database.prepare("PRAGMA quick_check").get().quick_check,
        "ok",
      );
      assert.equal(
        database.prepare("PRAGMA journal_mode").get().journal_mode,
        "wal",
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

test("creates, reads, lists, updates, and deletes provider metadata", async () => {
  await withDatabase(async (databasePath) => {
    const database = await openStorageDatabase(databasePath);
    try {
      const created = createProviderProfile(database, {
        id: "primary",
        providerId: "binomo",
        displayName: "Primary account",
        credentialReference: "ERC-chart/provider/binomo/primary",
      });
      assert.equal(created.createdAtMs, created.updatedAtMs);
      assert.deepEqual(getProviderProfile(database, "primary"), created);
      assert.deepEqual(listProviderProfiles(database), [created]);

      const updated = updateProviderProfile(database, "primary", {
        displayName: "Renamed account",
      });
      assert.equal(updated.displayName, "Renamed account");
      assert.equal(updated.createdAtMs, created.createdAtMs);
      assert.ok(updated.updatedAtMs >= created.updatedAtMs);

      assert.equal(deleteProviderProfile(database, "primary"), true);
      assert.equal(deleteProviderProfile(database, "primary"), false);
      assert.equal(getProviderProfile(database, "primary"), undefined);
    } finally {
      database.close();
    }
  });
});

test("rejects raw secret-like provider profile fields without persisting them", async () => {
  await withDatabase(async (databasePath) => {
    const database = await openStorageDatabase(databasePath);
    try {
      for (const secretField of ["authtoken", "device_id", "password"]) {
        assert.throws(
          () =>
            createProviderProfile(database, {
              id: "unsafe",
              providerId: "binomo",
              displayName: "Unsafe account",
              credentialReference: "ERC-chart/provider/binomo/unsafe",
              [secretField]: "raw-secret",
            }),
          new RegExp(`Unsupported provider profile field: ${secretField}`),
        );
      }
      assert.throws(
        () =>
          updateProviderProfile(database, "unsafe", {
            displayName: "Unsafe account",
            authtoken: "raw-secret",
          }),
        /Unsupported provider profile update field: authtoken/,
      );
      assert.equal(
        database
          .prepare("SELECT COUNT(*) AS count FROM provider_profiles")
          .get().count,
        0,
      );
    } finally {
      database.close();
    }
  });
});

test("requires an opaque credential reference matching provider and profile", async () => {
  await withDatabase(async (databasePath) => {
    const database = await openStorageDatabase(databasePath);
    try {
      assert.throws(
        () =>
          createProviderProfile(database, {
            id: "primary",
            providerId: "binomo",
            displayName: "Primary account",
            credentialReference: "raw-secret-value",
          }),
        /credentialReference/,
      );
      assert.throws(
        () =>
          createProviderProfile(database, {
            id: "primary",
            providerId: "binomo",
            displayName: "Primary account",
            credentialReference: "ERC-chart/provider/other/primary",
          }),
        /credentialReference/,
      );
    } finally {
      database.close();
    }
  });
});

test("rejects invalid metadata and missing updates", async () => {
  await withDatabase(async (databasePath) => {
    const database = await openStorageDatabase(databasePath);
    try {
      assert.throws(
        () =>
          createProviderProfile(database, {
            id: " ",
            providerId: "binomo",
            displayName: "Primary account",
            credentialReference: "ERC-chart/provider/binomo/primary",
          }),
        /id/,
      );
      assert.throws(
        () => updateProviderProfile(database, "missing", { displayName: "X" }),
        /Provider profile not found: missing/,
      );
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
