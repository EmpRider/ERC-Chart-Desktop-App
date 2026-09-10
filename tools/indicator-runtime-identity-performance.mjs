import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

// Run after npm run build. This exercises the packaged SDK v2 identity path end to end.
const historyBudgetMs = 60_000;
const updateBudgetMs = 100;
const historyBars = 100_000;
const buildingUpdates = 1_000;
const context = { instrumentId: "PERF", timeframeId: "1m" };
const candle = (index, close = 100 + (index % 20) / 10) => ({
  ...context,
  openTimeMs: index * 60_000,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: index + 1,
});

const sourceDirectory = await mkdtemp(
  path.join(import.meta.dirname, ".runtime-identity-performance-source-"),
);
const outputDirectory = await mkdtemp(
  path.join(os.tmpdir(), "erc-runtime-identity-performance-"),
);

try {
  const source = path.join(sourceDirectory, "indicator.ts");
  await writeFile(
    source,
    `import { defineIndicator, input, plot, series, signal, ta } from "@erc-chart/indicator-sdk";

function fastState(value) {
  const length = input.int(5, { title: "Fast Length", min: 1, max: 50 });
  const count = series(0, (previous) => previous + 1);
  const average = ta.ema(value, length);
  plot.line(average, { key: "fast", title: "Fast" });
  return { average, count };
}

function slowState(value, openTimeMs) {
  const length = input.int(14, { title: "Slow Length", min: 1, max: 50 });
  const count = series(100, (previous) => previous + 1);
  const average = ta.sma(value, length);
  plot.line(average, { key: "slow", title: "Slow" });
  plot.drawings("zones", () => {
    plot.box({
      id: "slow-zone",
      startTimeMs: openTimeMs,
      endTimeMs: openTimeMs + 60_000,
      top: value + 1,
      bottom: value - 1,
      color: "#555555",
    });
  });
  return { average, count };
}

export default defineIndicator(
  { id: "erc.indicator.runtime-identity-performance.main", name: "Runtime identity performance" },
  ({ close, openTimeMs }) => {
    let fast;
    let slow;
    if (Math.floor(close * 10) % 2 === 0) {
      fast = fastState(close);
      slow = slowState(close, openTimeMs);
    } else {
      slow = slowState(close, openTimeMs);
      fast = fastState(close);
    }
    signal(Number.isFinite(fast.average) && fast.average > slow.average, "long");
    plot.histogram(fast.count - slow.count, { key: "state-delta" });
  },
);
`,
    "utf8",
  );

  const { manifest, packageRoot } = await buildIndicatorPackage({
    source,
    outputRoot: path.join(outputDirectory, "package"),
    id: "erc.indicator.runtime-identity-performance",
    version: "0.1.0",
  });
  const entry = await readFile(path.join(packageRoot, manifest.entry));
  const { default: plugin } = await import(
    `data:text/javascript;base64,${entry.toString("base64")}`
  );

  const instance = plugin.createInstance({}, context);
  try {
    const candles = Array.from({ length: historyBars }, (_, index) =>
      candle(index),
    );
    const historyStarted = performance.now();
    instance.onHistory(candles);
    const historyElapsedMs = performance.now() - historyStarted;
    assert.equal(instance.snapshot().points.length, historyBars);

    let maximumBuildingMs = 0;
    const buildingStarted = performance.now();
    for (let index = 0; index < buildingUpdates; index += 1) {
      const updateStarted = performance.now();
      instance.onBuildingBar(candle(historyBars - 1, 200 + (index % 20) / 10));
      maximumBuildingMs = Math.max(
        maximumBuildingMs,
        performance.now() - updateStarted,
      );
    }
    const buildingElapsedMs = performance.now() - buildingStarted;

    const finalizedStarted = performance.now();
    instance.onFinalizedBar(candle(historyBars - 1, 205));
    const finalizedElapsedMs = performance.now() - finalizedStarted;

    console.log(
      JSON.stringify({
        component: "indicator-runtime-identity",
        historyBars,
        historyElapsedMs,
        historyBudgetMs,
        buildingUpdates,
        buildingElapsedMs,
        maximumBuildingMs,
        finalizedElapsedMs,
        updateBudgetMs,
      }),
    );

    assert.ok(
      historyElapsedMs < historyBudgetMs,
      `SDK v2 identity history replay exceeded the ${historyBudgetMs} ms worker budget: ${historyElapsedMs}`,
    );
    assert.ok(
      maximumBuildingMs < updateBudgetMs,
      `SDK v2 identity building update exceeded the ${updateBudgetMs} ms worker budget: ${maximumBuildingMs}`,
    );
    assert.ok(
      finalizedElapsedMs < updateBudgetMs,
      `SDK v2 identity finalization exceeded the ${updateBudgetMs} ms worker budget: ${finalizedElapsedMs}`,
    );
  } finally {
    instance.dispose();
  }
} finally {
  await rm(sourceDirectory, { recursive: true, force: true });
  await rm(outputDirectory, { recursive: true, force: true });
}
