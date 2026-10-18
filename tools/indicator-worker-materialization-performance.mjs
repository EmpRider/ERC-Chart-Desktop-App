import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { materializeIndicatorWorkerCandleSnapshot } from "@erc-chart/contracts";

// Run after npm run build. Materialization is part of the worker history path,
// so it must fit inside the same 60-second history budget as a full calculation.
const historyBudgetMs = 60_000;
const primaryRows = 100_000;
const sourceCases = [
  { timeframeId: "5m", rows: 20_000 },
  { timeframeId: "20m", rows: 5_000 },
  { timeframeId: "1h", rows: 1_667 },
  { timeframeId: "4h", rows: 417 },
];
const measurementRuns = 5;

function createSnapshot(rows, stepMs) {
  const openTimeMs = new Float64Array(rows);
  const open = new Float64Array(rows);
  const high = new Float64Array(rows);
  const low = new Float64Array(rows);
  const close = new Float64Array(rows);
  const volume = new Float64Array(rows);
  for (let index = 0; index < rows; index += 1) {
    const value = 100 + (index % 100) / 10;
    openTimeMs[index] = index * stepMs;
    open[index] = value - 0.5;
    high[index] = value + 1;
    low[index] = value - 1;
    close[index] = value;
    volume[index] = index + 1;
  }
  return Object.freeze({ openTimeMs, open, high, low, close, volume });
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * fraction) - 1),
  );
  return ordered[index] ?? 0;
}

const primarySnapshot = createSnapshot(primaryRows, 60_000);
const sourceSnapshots = sourceCases.map(({ timeframeId, rows }) => ({
  timeframeId,
  rows,
  snapshot: createSnapshot(rows, 60_000),
}));

const primaryElapsedMs = [];
const sourceAggregateElapsedMs = [];
const totalElapsedMs = [];
let checksum = 0;

for (let run = 0; run < measurementRuns; run += 1) {
  const totalStarted = performance.now();

  const primaryStarted = performance.now();
  const primaryCandles = materializeIndicatorWorkerCandleSnapshot(
    primarySnapshot,
    "PERF",
    "1m",
  );
  primaryElapsedMs.push(performance.now() - primaryStarted);
  checksum += primaryCandles.length + (primaryCandles.at(-1)?.close ?? 0);

  const sourcesStarted = performance.now();
  for (const source of sourceSnapshots) {
    const candles = materializeIndicatorWorkerCandleSnapshot(
      source.snapshot,
      "PERF",
      source.timeframeId,
    );
    checksum += candles.length + (candles.at(-1)?.close ?? 0);
  }
  sourceAggregateElapsedMs.push(performance.now() - sourcesStarted);
  totalElapsedMs.push(performance.now() - totalStarted);
}

const maximumPrimaryMs = Math.max(...primaryElapsedMs);
const maximumSourceAggregateMs = Math.max(...sourceAggregateElapsedMs);
const maximumTotalMs = Math.max(...totalElapsedMs);

assert.ok(Number.isFinite(checksum) && checksum > 0);
assert.ok(
  maximumTotalMs < historyBudgetMs,
  `Worker snapshot materialization exceeded the ${historyBudgetMs} ms history budget: ${maximumTotalMs}`,
);

console.log(
  JSON.stringify({
    component: "indicator-worker-snapshot-materialization",
    measurementRuns,
    primaryRows,
    sourceRows: sourceCases.map(({ timeframeId, rows }) => ({
      timeframeId,
      rows,
    })),
    aggregateRowsPerRun:
      primaryRows +
      sourceCases.reduce((total, source) => total + source.rows, 0),
    primaryMedianMs: percentile(primaryElapsedMs, 0.5),
    primaryP95Ms: percentile(primaryElapsedMs, 0.95),
    maximumPrimaryMs,
    sourceAggregateMedianMs: percentile(sourceAggregateElapsedMs, 0.5),
    sourceAggregateP95Ms: percentile(sourceAggregateElapsedMs, 0.95),
    maximumSourceAggregateMs,
    totalMedianMs: percentile(totalElapsedMs, 0.5),
    totalP95Ms: percentile(totalElapsedMs, 0.95),
    maximumTotalMs,
    historyBudgetMs,
    maximumBudgetUtilizationPercent: (maximumTotalMs / historyBudgetMs) * 100,
  }),
);
