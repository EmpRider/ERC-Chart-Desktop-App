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

test("packaged indicators preserve relative imports while lowering built-in history", async (t) => {
  const sourceDirectory = await mkdtemp(
    path.join(import.meta.dirname, ".history-authoring-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-history-package-"),
  );
  t.after(() => rm(sourceDirectory, { recursive: true, force: true }));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  await writeFile(
    path.join(sourceDirectory, "history-offset.ts"),
    "export const historyOffset = 1;\n",
    "utf8",
  );
  const source = path.join(sourceDirectory, "indicator.ts");
  await writeFile(
    source,
    `import { defineIndicator, history, plot } from "@erc-chart/indicator-sdk";
import { historyOffset } from "./history-offset.js";

export default defineIndicator({
  id: "erc.indicator.history-syntax.main",
  name: "History syntax",
});

plot.line(close[historyOffset], { title: "Indexed" });
plot.line(close.at(historyOffset), { title: "At" });
plot.line(history(close, historyOffset), { title: "Function" });
plot.line(history(close * 2, historyOffset), { title: "Derived" });
plot.line(open[historyOffset], { title: "Open indexed" });
plot.line(high.at(historyOffset), { title: "High at" });
plot.line(low[historyOffset], { title: "Low indexed" });
plot.line(volume[historyOffset], { title: "Volume indexed" });
plot.line(volume.at(historyOffset), { title: "Volume at" });
plot.line(history(volume, historyOffset), { title: "Volume function" });
`,
    "utf8",
  );

  const { manifest, packageRoot } = await buildIndicatorPackage({
    source,
    outputRoot: path.join(outputDirectory, "package"),
    id: "erc.indicator.history-syntax",
    version: "0.1.0",
  });
  const entry = await readFile(path.join(packageRoot, manifest.entry));
  const { default: plugin } = await import(
    `data:text/javascript;base64,${entry.toString("base64")}`
  );
  const keyFor = (label) => {
    const definition = plugin.definition.plots.find(
      (candidate) => candidate.label === label,
    );
    assert.ok(definition, `Missing plot definition for ${label}`);
    return definition.outputKey ?? definition.key;
  };
  const keys = {
    indexed: keyFor("Indexed"),
    at: keyFor("At"),
    functionHistory: keyFor("Function"),
    derived: keyFor("Derived"),
    openIndexed: keyFor("Open indexed"),
    highAt: keyFor("High at"),
    lowIndexed: keyFor("Low indexed"),
    volumeIndexed: keyFor("Volume indexed"),
    volumeAt: keyFor("Volume at"),
    volumeFunction: keyFor("Volume function"),
  };
  const instance = plugin.createInstance({}, context);
  instance.onHistory([candle(0, 10), candle(1, 11), candle(2, 12)]);

  for (const key of [keys.indexed, keys.at, keys.functionHistory]) {
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[key]),
      [null, 10, 11],
    );
  }
  assert.deepEqual(
    instance.snapshot().points.map((point) => point.values[keys.openIndexed]),
    [null, 9, 10],
  );
  assert.deepEqual(
    instance.snapshot().points.map((point) => point.values[keys.highAt]),
    [null, 11, 12],
  );
  assert.deepEqual(
    instance.snapshot().points.map((point) => point.values[keys.lowIndexed]),
    [null, 8, 9],
  );
  for (const key of [keys.volumeIndexed, keys.volumeAt, keys.volumeFunction]) {
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[key]),
      [null, 1, 2],
    );
  }
  assert.deepEqual(
    instance.snapshot().points.map((point) => point.values[keys.derived]),
    [null, 20, 22],
  );

  instance.onBuildingBar(candle(2, 40));
  for (const key of [keys.indexed, keys.at, keys.functionHistory])
    assert.equal(instance.snapshot().points.at(-1).values[key], 11);
  assert.equal(instance.snapshot().points.at(-1).values[keys.openIndexed], 10);
  assert.equal(instance.snapshot().points.at(-1).values[keys.highAt], 12);
  assert.equal(instance.snapshot().points.at(-1).values[keys.lowIndexed], 9);
  for (const key of [keys.volumeIndexed, keys.volumeAt, keys.volumeFunction])
    assert.equal(instance.snapshot().points.at(-1).values[key], 2);
  assert.equal(instance.snapshot().points.at(-1).values[keys.derived], 22);

  instance.onFinalizedBar(candle(2, 40));
  instance.onBuildingBar(candle(3, 50));
  for (const key of [keys.indexed, keys.at, keys.functionHistory])
    assert.equal(instance.snapshot().points.at(-1).values[key], 40);
  assert.equal(instance.snapshot().points.at(-1).values[keys.openIndexed], 39);
  assert.equal(instance.snapshot().points.at(-1).values[keys.highAt], 41);
  assert.equal(instance.snapshot().points.at(-1).values[keys.lowIndexed], 38);
  for (const key of [keys.volumeIndexed, keys.volumeAt, keys.volumeFunction])
    assert.equal(instance.snapshot().points.at(-1).values[key], 3);
  assert.equal(instance.snapshot().points.at(-1).values[keys.derived], 80);
  instance.dispose();
});
