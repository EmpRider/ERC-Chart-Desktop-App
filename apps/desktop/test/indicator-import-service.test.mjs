import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { isInstalledIndicatorSummary } from "@erc-chart/contracts";
import {
  activatePlugin,
  deletePlugin,
  disablePlugin,
  getPlugin,
  listPlugins,
  openStorageDatabase,
  putPlugin,
} from "@erc-chart/storage";
import { createIndicatorImportService } from "../dist/indicator-import-service.js";
import { buildAtrRopeUtBotIndicatorPackage } from "../../../tools/build-atr-rope-utbot-indicator.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function createStorage(database) {
  return {
    async listPlugins() {
      return listPlugins(database);
    },
    async putPlugin(input) {
      return putPlugin(database, input);
    },
    async activatePlugin(pluginId, version) {
      return activatePlugin(database, pluginId, version);
    },
    async disablePlugin(pluginId, version) {
      return disablePlugin(database, pluginId, version);
    },
    async deletePlugin(pluginId, version) {
      return deletePlugin(database, pluginId, version);
    },
  };
}

test("previews, installs and lists an indicator package without executing it in Electron main", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-indicator-import-"));
  const database = await openStorageDatabase(path.join(root, "storage.sqlite"));
  const service = createIndicatorImportService({
    storage: createStorage(database),
    stagingRoot: path.join(root, "staging"),
    installationRoot: path.join(root, "installed"),
    createRequestId: () => "indicator-request-1",
  });
  try {
    const built = await buildAtrRopeUtBotIndicatorPackage({
      root: repoRoot,
      outputRoot: path.join(root, "source"),
    });

    const preview = await service.preview({
      kind: "folder",
      path: built.packageRoot,
    });
    assert.equal(preview.requestId, "indicator-request-1");
    assert.equal(preview.pluginId, "erc.indicator.atr-rope-utbot");
    assert.equal(preview.definition.id, "erc.indicator.atr-rope-utbot.unified");
    assert.deepEqual(preview.permissions, {
      network: [],
      credentials: [],
      storage: [],
    });
    assert.equal(JSON.stringify(preview).includes(built.packageRoot), false);

    const installed = await service.approve(preview.requestId);
    assert.equal(installed.pluginId, preview.pluginId);
    assert.equal(isInstalledIndicatorSummary(installed), true);
    assert.match(installed.runtimeEntryUrl, /^erc-plugin:\/\/plugin\//u);
    assert.equal(
      getPlugin(database, installed.pluginId, installed.version)?.status,
      "active",
    );
    assert.deepEqual(await service.list(), [installed]);
    await access(
      path.join(
        root,
        "installed",
        installed.pluginId,
        installed.version,
        "dist",
        "index.js",
      ),
    );
  } finally {
    await service.shutdown();
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("quarantines an active legacy indicator that has no manifest definition", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-indicator-legacy-"));
  const database = await openStorageDatabase(path.join(root, "storage.sqlite"));
  const service = createIndicatorImportService({
    storage: createStorage(database),
    stagingRoot: path.join(root, "staging"),
    installationRoot: path.join(root, "installed"),
  });
  try {
    putPlugin(database, {
      pluginId: "erc.indicator.legacy",
      version: "0.1.0",
      kind: "indicator",
      trust: "unsigned",
      status: "active",
      manifest: {
        manifestVersion: 1,
        id: "erc.indicator.legacy",
        kind: "indicator",
        name: "Legacy Indicator",
        version: "0.1.0",
        apiVersion: "^1.0.0",
        entry: "dist/index.js",
        authoringLanguage: "typescript",
        permissions: { network: [], credentials: [], storage: [] },
      },
      integrityHash: `sha256:${"a".repeat(64)}`,
      permissions: [],
    });

    assert.deepEqual(await service.list(), []);
    assert.equal(
      getPlugin(database, "erc.indicator.legacy", "0.1.0")?.status,
      "incompatible",
    );
  } finally {
    await service.shutdown();
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("reinstalls the same indicator version with a new runtime revision and removes it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-indicator-update-"));
  const database = await openStorageDatabase(path.join(root, "storage.sqlite"));
  let request = 0;
  const service = createIndicatorImportService({
    storage: createStorage(database),
    stagingRoot: path.join(root, "staging"),
    installationRoot: path.join(root, "installed"),
    createRequestId: () => `indicator-update-${++request}`,
  });
  try {
    const firstBuilt = await buildAtrRopeUtBotIndicatorPackage({
      root: repoRoot,
      outputRoot: path.join(root, "source-first"),
    });
    const firstPreview = await service.preview({
      kind: "folder",
      path: firstBuilt.packageRoot,
    });
    const firstInstalled = await service.approve(firstPreview.requestId);

    const replacementBuilt = await buildAtrRopeUtBotIndicatorPackage({
      root: repoRoot,
      outputRoot: path.join(root, "source-replacement"),
    });
    const entryPath = path.join(
      replacementBuilt.packageRoot,
      "dist",
      "index.js",
    );
    const replacementEntry = `${await readFile(entryPath, "utf8")}\n// replacement build\n`;
    await writeFile(entryPath, replacementEntry, "utf8");
    const manifestPath = path.join(replacementBuilt.packageRoot, "plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.integrity.files[manifest.entry] = sha256(
      Buffer.from(replacementEntry),
    );
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    const replacementPreview = await service.preview({
      kind: "folder",
      path: replacementBuilt.packageRoot,
    });
    const replacementInstalled = await service.approve(
      replacementPreview.requestId,
    );
    assert.equal(replacementInstalled.version, firstInstalled.version);
    assert.notEqual(
      replacementInstalled.runtimeEntryUrl,
      firstInstalled.runtimeEntryUrl,
    );
    assert.match(
      replacementInstalled.runtimeEntryUrl,
      /\?revision=[a-f0-9]{64}$/u,
    );
    assert.match(
      await readFile(
        path.join(
          root,
          "installed",
          replacementInstalled.pluginId,
          replacementInstalled.version,
          "dist",
          "index.js",
        ),
        "utf8",
      ),
      /replacement build/u,
    );
    assert.deepEqual(await service.list(), [replacementInstalled]);

    assert.equal(await service.remove(replacementInstalled.pluginId), true);
    assert.deepEqual(await service.list(), []);
    assert.equal(
      getPlugin(
        database,
        replacementInstalled.pluginId,
        replacementInstalled.version,
      ),
      undefined,
    );
    await assert.rejects(
      access(
        path.join(
          root,
          "installed",
          replacementInstalled.pluginId,
          replacementInstalled.version,
        ),
      ),
      { code: "ENOENT" },
    );
  } finally {
    await service.shutdown();
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
