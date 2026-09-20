import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { maxSeriesCollectionItems } from "../packages/indicator-sdk/dist/series.js";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

// Run after npm run build. Synthetic, no renderer, storage or network.
const historyBars = 100_000;
const sourceDirectory = await mkdtemp(
  path.join(import.meta.dirname, ".persistent-state-performance-source-"),
);
const outputDirectory = await mkdtemp(
  path.join(os.tmpdir(), "erc-persistent-state-performance-"),
);

try {
  const source = path.join(sourceDirectory, "indicator.ts");
  await writeFile(
    source,
    `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

export default defineIndicator({
  id: "erc.indicator.persistent-state-performance.main",
  name: "Persistent state performance",
});

var state = Array.from({ length: ${maxSeriesCollectionItems} }, (_, index) => index);
state[0] = close;
plot.line(state[0] ?? null, { title: "State" });
`,
    "utf8",
  );

  const { manifest, packageRoot } = await buildIndicatorPackage({
    source,
    outputRoot: path.join(outputDirectory, "package"),
    id: "erc.indicator.persistent-state-performance",
    version: "0.1.0",
  });
  const entry = await readFile(path.join(packageRoot, manifest.entry));
  const { default: plugin } = await import(
    `data:text/javascript;base64,${entry.toString("base64")}`
  );
  const instance = plugin.createInstance(
    {},
    {
      instrumentId: "PERF",
      timeframeId: "1m",
    },
  );

  try {
    const candles = Array.from({ length: historyBars }, (_, index) => ({
      instrumentId: "PERF",
      timeframeId: "1m",
      openTimeMs: index * 60_000,
      open: 10,
      high: 12,
      low: 9,
      close: 11 + (index % 10) / 10,
    }));
    const started = performance.now();
    instance.onHistory(candles);
    const elapsedMs = performance.now() - started;
    assert.ok(
      elapsedMs < 60_000,
      `Structured persistent-state replay exceeded the 60,000 ms worker budget: ${elapsedMs}`,
    );
    assert.equal(instance.snapshot().points.length, historyBars);
    console.log(
      JSON.stringify({
        component: "indicator-persistent-state",
        historyBars,
        retainedCollectionItems: maxSeriesCollectionItems,
        elapsedMs,
        points: instance.snapshot().points.length,
      }),
    );
  } finally {
    instance.dispose();
  }
} finally {
  await rm(sourceDirectory, { recursive: true, force: true });
  await rm(outputDirectory, { recursive: true, force: true });
}
