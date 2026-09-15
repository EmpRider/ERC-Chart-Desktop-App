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

async function packagedPlugin(sourceText) {
  const sourceDirectory = await mkdtemp(
    path.join(import.meta.dirname, ".top-level-authoring-source-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-top-level-authoring-package-"),
  );
  try {
    const source = path.join(sourceDirectory, "indicator.ts");
    await writeFile(source, sourceText, "utf8");
    const { manifest, packageRoot } = await buildIndicatorPackage({
      source,
      outputRoot: path.join(outputDirectory, "package"),
      id: "erc.indicator.top-level-authoring",
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

test("canonical top-level Pine-style package executes the ECDD-236 authoring contract", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, input, plot, ta } from "@erc-chart/indicator-sdk";

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.main",
  name: "Top-level authoring",
});

const length = input.int(2, "Length");
const source = input.source(close, "Source");
const fast = ta.ema(source, length);
const priorClose = close[1];
const priorFast = fast[1];

plot.line(source, { title: "Source" });
plot.line(open + high + low + close + volume, { title: "OHLCV sum" });
plot.line(fast, { title: "Fast" });
plot.line(priorClose, { title: "Prior close" });
plot.line(priorFast, { title: "Prior fast" });
plot.line(bar.index, { title: "Bar index" });
plot.line(bar.time, { title: "Bar time" });
plot.line(bar.confirmed ? 1 : 0, { title: "Bar confirmed" });
`);

  assert.deepEqual(
    plugin.definition.inputs.map(({ label, type, defaultValue }) => ({
      label,
      type,
      defaultValue,
    })),
    [
      { label: "Length", type: "number", defaultValue: 2 },
      { label: "Source", type: "source", defaultValue: "close" },
    ],
  );

  const outputKeyFor = (label) => {
    const definition = plugin.definition.plots.find(
      (candidate) => candidate.label === label,
    );
    assert.ok(definition, `Missing plot definition for ${label}`);
    return definition.outputKey ?? definition.key;
  };
  const keys = Object.fromEntries(
    [
      "Source",
      "OHLCV sum",
      "Fast",
      "Prior close",
      "Prior fast",
      "Bar index",
      "Bar time",
      "Bar confirmed",
    ].map((label) => [label, outputKeyFor(label)]),
  );

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([
      candle(0, 10),
      candle(1, 11),
      candle(2, 12),
      candle(3, 13),
    ]);
    const values = (label) =>
      instance.snapshot().points.map((point) => point.values[keys[label]]);

    assert.deepEqual(values("Source"), [10, 11, 12, 13]);
    assert.deepEqual(values("OHLCV sum"), [39, 44, 49, 54]);
    assert.deepEqual(values("Fast"), [null, 10.5, 11.5, 12.5]);
    assert.deepEqual(values("Prior close"), [null, 10, 11, 12]);
    assert.deepEqual(values("Prior fast"), [null, null, 10.5, 11.5]);
    assert.deepEqual(values("Bar index"), [0, 1, 2, 3]);
    assert.deepEqual(values("Bar time"), [0, 60_000, 120_000, 180_000]);
    assert.deepEqual(values("Bar confirmed"), [1, 1, 1, 0]);
  } finally {
    instance.dispose();
  }
});
