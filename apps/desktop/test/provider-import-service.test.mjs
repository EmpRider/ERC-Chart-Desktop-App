import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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

function makeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(value);
    const flags = 0x0800;
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, eocd]);
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

test("previews a provider ZIP through the desktop import service", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-import-service-zip-"));
  const database = await openStorageDatabase(path.join(root, "storage.sqlite"));
  try {
    const source = await writeProviderPackage(root);
    const archivePath = path.join(root, "fixture-provider.zip");
    await writeFile(
      archivePath,
      makeStoredZip([
        ["plugin.json", await readFile(path.join(source, "plugin.json"))],
        [
          "dist/index.js",
          await readFile(path.join(source, "dist", "index.js")),
        ],
      ]),
    );
    const fixture = createController();
    const service = createProviderImportService({
      database,
      controller: fixture.controller,
      stagingRoot: path.join(root, "staging"),
      installationRoot: path.join(root, "installed"),
      createRequestId: () => "request-zip",
    });

    const preview = await service.preview({ kind: "zip", path: archivePath });

    assert.equal(preview.requestId, "request-zip");
    assert.equal(preview.pluginId, "erc.provider.fixture");
    assert.equal(preview.pluginName, "Fixture Provider");
    assert.equal(JSON.stringify(preview).includes(archivePath), false);
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
    assert.deepEqual(session.availableTimeframeIds, ["1m"]);
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
