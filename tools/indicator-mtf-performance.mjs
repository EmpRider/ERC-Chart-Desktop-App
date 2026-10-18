import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { plot, ta } from "../packages/indicator-sdk/dist/index.js";
import { defineIndicator } from "../packages/indicator-sdk/dist/indicator.js";

// Run after npm run build. Synthetic provider-specific timeframe IDs exercise
// the fallback alignment path that cannot derive a duration from the ID.
const historyBars = 100_000;
const timeframeRatio = 4;
const sourceBars = Math.ceil(historyBars / timeframeRatio) + 1;
const historyBudgetMs = 60_000;
const comparisonBars = 10_000;
const baseTimeframeId = "provider-quarter-hour";
const sourceTimeframeId = "provider-hour";

const baseCandles = Array.from({ length: historyBars }, (_, index) => ({
  instrumentId: "PERF",
  timeframeId: baseTimeframeId,
  openTimeMs: index * 15 * 60_000,
  open: 100,
  high: 102,
  low: 99,
  close: 101,
  volume: index + 1,
}));
const higherCandles = Array.from({ length: sourceBars }, (_, index) => ({
  instrumentId: "PERF",
  timeframeId: sourceTimeframeId,
  openTimeMs: index * 60 * 60_000,
  open: 200 + index / 100,
  high: 202 + index / 100,
  low: 199 + index / 100,
  close: 201 + index / 100,
  volume: index + 1,
}));

const comparisonSource = baseCandles.slice(0, comparisonBars);
let checksum = 0;
let started = performance.now();
for (const candle of comparisonSource) {
  const index = comparisonSource.findIndex(
    ({ openTimeMs }) => openTimeMs === candle.openTimeMs,
  );
  checksum += comparisonSource[index + 1]?.openTimeMs ?? candle.openTimeMs;
}
const linearLookupElapsedMs = performance.now() - started;

started = performance.now();
const boundaryAfter = new Map();
for (let index = 1; index < comparisonSource.length; index += 1) {
  const previous = comparisonSource[index - 1];
  const current = comparisonSource[index];
  if (previous !== undefined && current !== undefined)
    boundaryAfter.set(previous.openTimeMs, current.openTimeMs);
}
let indexedChecksum = 0;
for (const candle of comparisonSource)
  indexedChecksum += boundaryAfter.get(candle.openTimeMs) ?? candle.openTimeMs;
const indexedLookupElapsedMs = performance.now() - started;
assert.equal(indexedChecksum, checksum);

const plugin = defineIndicator(
  { id: "erc.indicator.mtf-performance.main", name: "MTF performance" },
  () => {
    plot.line(ta.ema(1, sourceTimeframeId));
  },
);
const instance = plugin.createInstance(
  {},
  {
    instrumentId: "PERF",
    timeframeId: baseTimeframeId,
    sourceCandles: {
      [baseTimeframeId]: baseCandles,
      [sourceTimeframeId]: higherCandles,
    },
  },
);
try {
  started = performance.now();
  instance.onHistory(baseCandles);
  const historyElapsedMs = performance.now() - started;
  assert.ok(
    historyElapsedMs < historyBudgetMs,
    `Provider-specific MTF history exceeded the ${historyBudgetMs} ms budget: ${historyElapsedMs}`,
  );
  assert.equal(instance.snapshot().points.length, historyBars);
  console.log(
    JSON.stringify({
      component: "indicator-provider-mtf-alignment",
      historyBars,
      sourceBars,
      timeframeRatio,
      historyElapsedMs,
      historyBudgetMs,
      comparisonBars,
      linearLookupElapsedMs,
      indexedLookupElapsedMs,
    }),
  );
} finally {
  instance.dispose();
}
