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

test("packaged indicators give bracket, at, and history source access identical semantics", async (t) => {
  const sourceDirectory = await mkdtemp(
    path.join(import.meta.dirname, ".history-authoring-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-history-package-"),
  );
  t.after(() => rm(sourceDirectory, { recursive: true, force: true }));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const source = path.join(sourceDirectory, "indicator.ts");
  await writeFile(
    source,
    `import { defineIndicator, history, plot } from "@erc-chart/indicator-sdk";

export default defineIndicator(
  { id: "erc.indicator.history-syntax.main", name: "History syntax" },
  ({ close, volume }) => {
    plot.line(close[1], { key: "indexed" });
    plot.line(close.at(1), { key: "at" });
    plot.line(history(close, 1), { key: "function" });
    plot.line(history(close * 2, 1), { key: "derived" });
    plot.line(volume[1], { key: "volumeIndexed" });
    plot.line(volume.at(1), { key: "volumeAt" });
    plot.line(history(volume, 1), { key: "volumeFunction" });
  },
);
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
  const instance = plugin.createInstance({}, context);
  instance.onHistory([candle(0, 10), candle(1, 11), candle(2, 12)]);

  for (const key of ["indexed", "at", "function"]) {
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[key]),
      [null, 10, 11],
    );
  }
  for (const key of ["volumeIndexed", "volumeAt", "volumeFunction"]) {
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[key]),
      [null, 1, 2],
    );
  }
  assert.deepEqual(
    instance.snapshot().points.map((point) => point.values.derived),
    [null, 20, 22],
  );

  instance.onBuildingBar(candle(2, 40));
  for (const key of ["indexed", "at", "function"])
    assert.equal(instance.snapshot().points.at(-1).values[key], 11);
  for (const key of ["volumeIndexed", "volumeAt", "volumeFunction"])
    assert.equal(instance.snapshot().points.at(-1).values[key], 2);
  assert.equal(instance.snapshot().points.at(-1).values.derived, 22);

  instance.onFinalizedBar(candle(2, 40));
  instance.onBuildingBar(candle(3, 50));
  for (const key of ["indexed", "at", "function"])
    assert.equal(instance.snapshot().points.at(-1).values[key], 40);
  for (const key of ["volumeIndexed", "volumeAt", "volumeFunction"])
    assert.equal(instance.snapshot().points.at(-1).values[key], 3);
  assert.equal(instance.snapshot().points.at(-1).values.derived, 80);
  instance.dispose();
});
