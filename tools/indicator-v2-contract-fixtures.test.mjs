import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

const context = { instrumentId: "TEST", timeframeId: "1m" };
const candle = (index, close) => ({
  ...context,
  openTimeMs: index * 60_000,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: index + 1,
});

async function packagedPlugin(sourceText, id) {
  const sourceDirectory = await mkdtemp(
    path.join(import.meta.dirname, ".v2-contract-source-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-v2-contract-package-"),
  );
  try {
    const source = path.join(sourceDirectory, "indicator.ts");
    await writeFile(source, sourceText, "utf8");
    const { manifest, packageRoot } = await buildIndicatorPackage({
      source,
      outputRoot: path.join(outputDirectory, "package"),
      id,
      version: "0.1.0",
    });
    const entry = await readFile(path.join(packageRoot, manifest.entry));
    return await import(
      `data:text/javascript;base64,${entry.toString("base64")}`
    );
  } finally {
    await rm(sourceDirectory, { recursive: true, force: true });
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

const callsiteFromSignalId = (id) => id.slice(0, id.lastIndexOf(":"));

test("composed v2 contract survives replay, provisional rollback, and finalization", async () => {
  const { default: plugin } = await packagedPlugin(
    `import {
  defineIndicator,
  history,
  plot,
  series,
  signal,
  ta,
} from "@erc-chart/indicator-sdk";

function optionalBranch(value, openTimeMs) {
  const executions = series(0, (previous) => previous + 1);
  const average = ta.ema(value, 2);
  plot.line(executions, { title: "Optional state" });
  plot.line(average, { title: "Optional average" });
  plot.box({
    left: openTimeMs,
    right: openTimeMs + 60_000,
    top: value,
    bottom: value - 1,
    color: "#008800",
  });
  signal(true, "long");
}

function alwaysBranch() {
  const executions = series(100, (previous) => previous + 10);
  plot.line(executions, { title: "Always state" });
}

export default defineIndicator(
  { id: "erc.indicator.v2-contract.main", name: "SDK v2 contract fixture" },
  ({ close, openTimeMs }) => {
    if (close > 15) optionalBranch(close, openTimeMs);
    alwaysBranch();
    plot.line(close[1], { title: "Indexed history" });
    plot.line(close.at(1), { title: "At history" });
    plot.line(history(close, 1), { title: "Function history" });
  },
);
`,
    "erc.indicator.v2-contract",
  );

  const definitionFor = (label) => {
    const definition = plugin.definition.plots.find(
      (candidate) => candidate.label === label,
    );
    assert.ok(definition, `Missing plot definition for ${label}`);
    assert.match(definition.key, /^erc-v2-plot-[0-9a-f]{24}$/u);
    return definition;
  };
  const outputKeyFor = (label) => {
    const definition = definitionFor(label);
    return definition.outputKey ?? definition.key;
  };

  const optionalState = definitionFor("Optional state");
  const alwaysState = definitionFor("Always state");
  assert.notEqual(optionalState.key, alwaysState.key);

  const keys = {
    optionalState: outputKeyFor("Optional state"),
    alwaysState: outputKeyFor("Always state"),
    indexed: outputKeyFor("Indexed history"),
    at: outputKeyFor("At history"),
    functionHistory: outputKeyFor("Function history"),
  };

  const instance = plugin.createInstance({}, context);
  const values = (key) =>
    instance.snapshot().points.map((point) => point.values[key]);
  const optionalOverlay = () =>
    instance.snapshot().overlays.find((overlay) => overlay.color === "#008800");

  try {
    instance.onHistory([
      candle(0, 10),
      candle(1, 20),
      candle(2, 10),
      candle(3, 30),
    ]);

    assert.deepEqual(values(keys.alwaysState), [110, 120, 130, 140]);
    assert.deepEqual(values(keys.optionalState), [undefined, 1, undefined, 2]);
    for (const key of [keys.indexed, keys.at, keys.functionHistory])
      assert.deepEqual(values(key), [null, 10, 20, 10]);

    const committedOverlayId = optionalOverlay()?.id;
    assert.ok(committedOverlayId);
    assert.equal(optionalOverlay()?.top, 30);
    const initialSignals = instance.snapshot().signals ?? [];
    assert.equal(initialSignals.length, 1);
    assert.equal(initialSignals[0].direction, "long");
    const signalCallsite = callsiteFromSignalId(initialSignals[0].id);
    assert.match(signalCallsite, /^erc-v2-signal-[0-9a-f]{24}$/u);

    instance.onBuildingBar(candle(3, 12));
    assert.deepEqual(values(keys.alwaysState), [110, 120, 130, 140]);
    assert.deepEqual(values(keys.optionalState), [
      undefined,
      1,
      undefined,
      undefined,
    ]);
    for (const key of [keys.indexed, keys.at, keys.functionHistory])
      assert.equal(instance.snapshot().points.at(-1).values[key], 10);
    assert.equal(optionalOverlay()?.id, committedOverlayId);
    assert.equal(optionalOverlay()?.top, 20);
    assert.equal((instance.snapshot().signals ?? []).length, 1);

    instance.onFinalizedBar(candle(3, 30));
    assert.equal(instance.snapshot().points.at(-1).values[keys.alwaysState], 140);
    assert.equal(instance.snapshot().points.at(-1).values[keys.optionalState], 2);
    assert.equal(optionalOverlay()?.id, committedOverlayId);
    assert.equal(optionalOverlay()?.top, 30);
    const finalizedSignals = instance.snapshot().signals ?? [];
    assert.equal(finalizedSignals.length, 2);
    assert.equal(finalizedSignals[1].direction, "long");
    assert.equal(callsiteFromSignalId(finalizedSignals[1].id), signalCallsite);

    instance.onBuildingBar(candle(4, 8));
    assert.equal(instance.snapshot().points.at(-1).values[keys.alwaysState], 150);
    assert.equal(
      instance.snapshot().points.at(-1).values[keys.optionalState],
      undefined,
    );
    for (const key of [keys.indexed, keys.at, keys.functionHistory])
      assert.equal(instance.snapshot().points.at(-1).values[key], 30);
    assert.equal(optionalOverlay()?.id, committedOverlayId);
    assert.equal(optionalOverlay()?.top, 30);
  } finally {
    instance.dispose();
  }
});
