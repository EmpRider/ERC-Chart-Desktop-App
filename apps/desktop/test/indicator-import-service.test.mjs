import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
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
