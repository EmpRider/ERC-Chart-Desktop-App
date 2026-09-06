import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createIndicatorRuntimeHost } from "@erc-chart/indicator-runtime";
import { getPlugin, openStorageDatabase } from "@erc-chart/storage";
import { createIndicatorImportService } from "../dist/indicator-import-service.js";
import { buildAtrRopeUtBotIndicatorPackage } from "../../../tools/build-atr-rope-utbot-indicator.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function candles(count = 120) {
  return Array.from({ length: count }, (_, index) => {
    const base = 100 + Math.sin(index / 5) * 2 + index * 0.01;
    return {
      instrumentId: "fixture.instrument",
      timeframeId: "1m",
      openTimeMs: 1_810_000_000_000 + index * 60_000,
      open: base - 0.2,
      high: base + 0.5,
      low: base - 0.5,
      close: base + 0.2,
      volume: 1_000 + index,
    };
  });
}

test("previews, installs, lists and executes an indicator package", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-indicator-import-"));
  const database = await openStorageDatabase(path.join(root, "storage.sqlite"));
  const runtimeHost = createIndicatorRuntimeHost();
  const service = createIndicatorImportService({
    database,
    runtimeHost,
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
    assert.equal(
      getPlugin(database, installed.pluginId, installed.version)?.status,
      "active",
    );
    assert.deepEqual(await service.list(), [installed]);

    const snapshot = runtimeHost.sync({
      instanceId: "imported-indicator",
      pluginId: installed.pluginId,
      definitionId: installed.definition.id,
      instrumentId: "fixture.instrument",
      timeframeId: "1m",
      parameters: {},
      candles: candles(),
    });
    assert.equal(snapshot.points.length, 120);
    assert.ok(
      snapshot.points.some((point) =>
        Object.values(point.values).some((value) => typeof value === "number"),
      ),
    );
  } finally {
    await service.shutdown();
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
