import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getPlugin,
  getProviderProfile,
  openStorageDatabase,
} from "../../../packages/storage/dist/index.js";
import { createProviderImportService } from "../dist/provider-import-service.js";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeProviderPackage(root, credentials = []) {
  const source = path.join(root, "source");
  await mkdir(path.join(source, "dist"), { recursive: true });
  const entry = "export default {};\n";
  await writeFile(path.join(source, "dist", "index.js"), entry);
  await writeFile(
    path.join(source, "plugin.json"),
    JSON.stringify({
      manifestVersion: 1,
      id: "erc.provider.fixture",
      kind: "provider",
      name: "Fixture Provider",
      version: "1.0.0",
      apiVersion: "^1.0.0",
      entry: "dist/index.js",
      authoringLanguage: "typescript",
      permissions: {
        network: ["https://api.example.com/*"],
        credentials,
        storage: [],
      },
      integrity: {
        algorithm: "sha256",
        files: { "dist/index.js": sha256(entry) },
      },
    }),
  );
  return source;
}

function createController({ failHistory = false } = {}) {
  const calls = [];
  return {
    calls,
    controller: {
      async startProviderProfile(profileId, launch) {
        calls.push(["start", profileId, launch]);
      },
      async stopProviderProfile(profileId) {
        calls.push(["stop", profileId]);
      },
      async getProviderCapabilities(profileId) {
        calls.push(["capabilities", profileId]);
        return {
          instruments: true,
          nativeTimeframes: ["1m"],
          liveData: true,
          derivedTimeframes: false,
        };
      },
      async getProviderInstruments(profileId) {
        calls.push(["instruments", profileId]);
        return [{ id: "FIXTURE", symbol: "FIX", name: "Fixture Instrument" }];
      },
      async requestProviderHistory(profileId, request) {
        calls.push(["history", profileId, request]);
        if (failHistory) throw new Error("history failed");
        return [
          {
            instrumentId: "FIXTURE",
            timeframeId: "1m",
            openTimeMs: 1_800_000_000_000,
            open: 100,
            high: 102,
            low: 99,
            close: 101,
          },
        ];
      },
    },
  };
}

test("previews permissions without exposing the selected provider path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-import-service-"));
  const database = await openStorageDatabase(path.join(root, "storage.sqlite"));
  try {
    const source = await writeProviderPackage(root);
    const fixture = createController();
    const service = createProviderImportService({
      database,
      controller: fixture.controller,
      stagingRoot: path.join(root, "staging"),
      installationRoot: path.join(root, "installed"),
      createRequestId: () => "request-1",
    });
    const preview = await service.preview({ kind: "folder", path: source });

    assert.deepEqual(preview, {
      requestId: "request-1",
      pluginId: "erc.provider.fixture",
      pluginName: "Fixture Provider",
      pluginVersion: "1.0.0",
      mode: "developer",
      trust: "unsigned",
      permissions: {
        network: ["https://api.example.com/*"],
        credentials: [],
        storage: [],
      },
    });
    assert.equal(JSON.stringify(preview).includes(source), false);
    await service.cancel(preview.requestId);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("installs, starts, discovers and loads provider candles after approval", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-import-service-"));
  const database = await openStorageDatabase(path.join(root, "storage.sqlite"));
  try {
    const source = await writeProviderPackage(root, ["binomo_cookie"]);
    const fixture = createController();
    const credentialWrites = [];
    const service = createProviderImportService({
      database,
      controller: fixture.controller,
      credentialManager: {
        async read() {
          return undefined;
        },
        async write(target, value) {
          credentialWrites.push({ target, value });
        },
        async delete() {
          return true;
        },
      },
      stagingRoot: path.join(root, "staging"),
      installationRoot: path.join(root, "installed"),
      now: () => 1_800_030_000_000,
      createRequestId: () => "request-2",
    });
    const preview = await service.preview({ kind: "folder", path: source });
    const session = await service.approve(preview.requestId, {
      binomo_cookie: "fixture-cookie",
    });

    assert.equal(session.providerId, "erc.provider.fixture");
    assert.equal(session.instrument.symbol, "FIX");
    assert.equal(session.timeframeId, "1m");
    assert.equal(session.candles.length, 1);
    assert.equal(
      getPlugin(database, "erc.provider.fixture", "1.0.0")?.status,
      "active",
    );
    assert.equal(
      getProviderProfile(database, "erc.provider.fixture.default")?.providerId,
      "erc.provider.fixture",
    );
    assert.equal(fixture.calls[0][0], "start");
    assert.ok(fixture.calls.some(([kind]) => kind === "history"));
    assert.deepEqual(credentialWrites, [
      {
        target:
          "ERC-chart/provider/erc.provider.fixture/erc.provider.fixture.default",
        value: JSON.stringify({ binomo_cookie: "fixture-cookie" }),
      },
    ]);
    assert.equal(
      JSON.stringify(
        getProviderProfile(database, "erc.provider.fixture.default")?.settings,
      ).includes("fixture-cookie"),
      false,
    );
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("rolls back installation and profile when initial candle loading fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-import-service-"));
  const database = await openStorageDatabase(path.join(root, "storage.sqlite"));
  try {
    const source = await writeProviderPackage(root, ["binomo_cookie"]);
    const fixture = createController({ failHistory: true });
    const credentialCalls = [];
    const service = createProviderImportService({
      database,
      controller: fixture.controller,
      credentialManager: {
        async read() {
          return undefined;
        },
        async write(target, value) {
          credentialCalls.push(["write", target, value]);
        },
        async delete(target) {
          credentialCalls.push(["delete", target]);
          return true;
        },
      },
      stagingRoot: path.join(root, "staging"),
      installationRoot: path.join(root, "installed"),
      createRequestId: () => "request-3",
    });
    const preview = await service.preview({ kind: "folder", path: source });

    await assert.rejects(
      service.approve(preview.requestId, {
        binomo_cookie: "fixture-cookie",
      }),
      /history failed/u,
    );
    assert.equal(
      getPlugin(database, "erc.provider.fixture", "1.0.0"),
      undefined,
    );
    assert.equal(
      getProviderProfile(database, "erc.provider.fixture.default"),
      undefined,
    );
    assert.ok(fixture.calls.some(([kind]) => kind === "stop"));
    assert.equal(credentialCalls[0][0], "write");
    assert.deepEqual(credentialCalls.at(-1), [
      "delete",
      "ERC-chart/provider/erc.provider.fixture/erc.provider.fixture.default",
    ]);
    await assert.rejects(
      stat(path.join(root, "installed", "erc.provider.fixture", "1.0.0")),
      { code: "ENOENT" },
    );
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
