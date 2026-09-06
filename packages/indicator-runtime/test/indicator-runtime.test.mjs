import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createIndicatorRuntimeHost } from "../dist/index.js";
import { buildAtrRopeUtBotIndicatorPackage } from "../../../tools/build-atr-rope-utbot-indicator.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function candles(count = 180) {
  const result = [];
  let previous = 100;
  for (let index = 0; index < count; index += 1) {
    const wave = Math.sin(index / 6) * 1.8;
    const drift = index < count / 2 ? index * 0.025 : (count - index) * 0.025;
    const close = 100 + wave + drift;
    const open = previous;
    result.push({
      instrumentId: "fixture.instrument",
      timeframeId: "1m",
      openTimeMs: 1_800_000_000_000 + index * 60_000,
      open,
      high: Math.max(open, close) + 0.35,
      low: Math.min(open, close) - 0.35,
      close,
      volume: 100 + index,
    });
    previous = close;
  }
  return result;
}

async function buildFixture(root) {
  const outputRoot = path.join(root, "atr-rope-utbot");
  const built = await buildAtrRopeUtBotIndicatorPackage({
    root: repoRoot,
    outputRoot,
  });
  const manifest = JSON.parse(
    await readFile(path.join(built.packageRoot, "plugin.json"), "utf8"),
  );
  return { ...built, manifest };
}

test("loads the built ATR Rope + UT Bot package and produces finite snapshots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-indicator-runtime-"));
  const runtime = createIndicatorRuntimeHost();
  try {
    const built = await buildFixture(root);
    const loaded = await runtime.loadPlugin({
      installationPath: built.packageRoot,
      manifest: built.manifest,
    });

    assert.equal(loaded.pluginId, "erc.indicator.atr-rope-utbot");
    assert.equal(loaded.definition.id, "erc.indicator.atr-rope-utbot.unified");
    assert.equal(loaded.definition.name, "ATR Rope + UT Bot Unified");

    const history = candles();
    const snapshot = runtime.sync({
      instanceId: "runtime-fixture",
      pluginId: loaded.pluginId,
      definitionId: loaded.definition.id,
      instrumentId: "fixture.instrument",
      timeframeId: "1m",
      parameters: {
        ropeDirectionThreshold: 0,
        ropePeriod: 1,
        ropeSensitivityMode: "momentum",
        utbotAtrPeriod: 1,
        utbotMode: "0lag",
      },
      candles: history,
    });

    assert.equal(snapshot.points.length, history.length);
    assert.ok(
      snapshot.points.some((point) =>
        Object.values(point.values).some((value) => typeof value === "number"),
      ),
    );
    for (const point of snapshot.points) {
      for (const value of Object.values(point.values)) {
        assert.ok(value === null || Number.isFinite(value));
      }
    }
    const lastClosedTime = history.at(-2).openTimeMs;
    assert.ok(
      snapshot.signals.every(
        (signal) => signal.finalized && signal.occurredAtMs <= lastClosedTime,
      ),
    );

    const next = {
      ...history.at(-1),
      openTimeMs: history.at(-1).openTimeMs + 60_000,
      open: history.at(-1).close,
      high: history.at(-1).close + 1,
      low: history.at(-1).close - 0.5,
      close: history.at(-1).close + 0.75,
    };
    const updated = runtime.update({
      instanceId: "runtime-fixture",
      phase: "building",
      candle: next,
    });
    assert.equal(updated.points.at(-1).openTimeMs, next.openTimeMs);

    runtime.disposeInstance("runtime-fixture");
    assert.throws(
      () =>
        runtime.update({
          instanceId: "runtime-fixture",
          phase: "finalized",
          candle: next,
        }),
      /Indicator instance is not active/u,
    );
  } finally {
    runtime.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("indicator VM does not expose Node process globals", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-indicator-sandbox-"));
  const packageRoot = path.join(root, "plugin");
  const dist = path.join(packageRoot, "dist");
  await mkdir(dist, { recursive: true });
  const source = `
var __ERC_INDICATOR_PLUGIN__ = (() => {
  const leaked = process.version;
  return { default: { definition: {}, createInstance() {} } };
})();
`;
  await writeFile(path.join(dist, "index.js"), source, "utf8");
  const runtime = createIndicatorRuntimeHost();
  try {
    await assert.rejects(
      runtime.loadPlugin({
        installationPath: packageRoot,
        manifest: {
          manifestVersion: 1,
          id: "erc.indicator.sandbox-fixture",
          kind: "indicator",
          name: "Sandbox Fixture",
          version: "1.0.0",
          apiVersion: "^1.0.0",
          entry: "dist/index.js",
          permissions: { network: [], credentials: [], storage: [] },
        },
      }),
      /process is not defined/u,
    );
  } finally {
    runtime.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
