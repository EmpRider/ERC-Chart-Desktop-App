import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { atrRopeUtBotIndicator } from "../packages/indicator-examples/dist/index.js";

// Run after npm run build. This exercises four independent maintained authored
// indicator instances, matching the application's supported multi-chart scale.
// It is a runtime acceptance gate, not a renderer FPS or provider/MTF benchmark.
const chartCount = 4;
const historyBarsPerChart = 25_000;
const buildingRounds = 250;
const historyBudgetMs = 60_000;
const buildingSweepBudgetMs = 5_000;
const maximumIncrementalBudgetMs = 100;
const finalizedSweepBudgetMs = 1_000;

const timeframeId = "1m";
const instrumentId = (chartIndex) => `PERF-${chartIndex + 1}`;
const candle = (chartIndex, index, close = 11 + (index % 10) / 10) => ({
  instrumentId: instrumentId(chartIndex),
  timeframeId,
  openTimeMs: index * 60_000,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: index + 1,
});

const parameters = Object.fromEntries(
  atrRopeUtBotIndicator.definition.inputs.map((input) => [
    input.key,
    input.defaultValue,
  ]),
);
const charts = Array.from({ length: chartCount }, (_, chartIndex) => ({
  chartIndex,
  instance: atrRopeUtBotIndicator.createInstance(parameters, {
    instrumentId: instrumentId(chartIndex),
    timeframeId,
  }),
}));

try {
  const historyStarted = performance.now();
  let maximumHistoryMs = 0;
  for (const { chartIndex, instance } of charts) {
    const chartHistoryStarted = performance.now();
    instance.onHistory(
      Array.from({ length: historyBarsPerChart }, (_, index) =>
        candle(chartIndex, index),
      ),
    );
    maximumHistoryMs = Math.max(
      maximumHistoryMs,
      performance.now() - chartHistoryStarted,
    );
    assert.equal(instance.snapshot().points.length, historyBarsPerChart);
  }
  const historyElapsedMs = performance.now() - historyStarted;
  assert.ok(
    historyElapsedMs < historyBudgetMs,
    `Four-chart authored history exceeded the ${historyBudgetMs} ms budget: ${historyElapsedMs}`,
  );
  assert.ok(
    maximumHistoryMs < historyBudgetMs,
    `One authored chart exceeded the ${historyBudgetMs} ms history budget: ${maximumHistoryMs}`,
  );

  const stablePointArrays = charts.map(
    ({ instance }) => instance.snapshot().points,
  );
  for (let warmup = 0; warmup < 20; warmup += 1) {
    for (const { chartIndex, instance } of charts) {
      instance.onBuildingBar(
        candle(
          chartIndex,
          historyBarsPerChart - 1,
          20 + warmup / 100 + chartIndex / 1_000,
        ),
      );
    }
  }

  let maximumBuildingMs = 0;
  let maximumSweepMs = 0;
  const buildingStarted = performance.now();
  for (let round = 0; round < buildingRounds; round += 1) {
    const sweepStarted = performance.now();
    for (const { chartIndex, instance } of charts) {
      const updateStarted = performance.now();
      instance.onBuildingBar(
        candle(
          chartIndex,
          historyBarsPerChart - 1,
          30 + (round % 100) / 100 + chartIndex / 1_000,
        ),
      );
      maximumBuildingMs = Math.max(
        maximumBuildingMs,
        performance.now() - updateStarted,
      );
    }
    maximumSweepMs = Math.max(maximumSweepMs, performance.now() - sweepStarted);
  }
  const buildingElapsedMs = performance.now() - buildingStarted;
  assert.ok(
    buildingElapsedMs < buildingSweepBudgetMs,
    `Four-chart authored provisional updates exceeded the ${buildingSweepBudgetMs} ms aggregate budget: ${buildingElapsedMs}`,
  );
  assert.ok(
    maximumBuildingMs < maximumIncrementalBudgetMs,
    `One authored provisional update exceeded the ${maximumIncrementalBudgetMs} ms worker budget: ${maximumBuildingMs}`,
  );
  for (const [index, { instance }] of charts.entries()) {
    assert.strictEqual(
      instance.snapshot().points,
      stablePointArrays[index],
      "multi-chart provisional updates must not clone retained point history",
    );
  }

  let maximumFinalizedMs = 0;
  const finalizedStarted = performance.now();
  for (const { chartIndex, instance } of charts) {
    const updateStarted = performance.now();
    instance.onFinalizedBar(
      candle(chartIndex, historyBarsPerChart - 1, 40 + chartIndex / 1_000),
    );
    maximumFinalizedMs = Math.max(
      maximumFinalizedMs,
      performance.now() - updateStarted,
    );
  }
  const finalizedElapsedMs = performance.now() - finalizedStarted;
  assert.ok(
    finalizedElapsedMs < finalizedSweepBudgetMs,
    `Four-chart authored finalization exceeded the ${finalizedSweepBudgetMs} ms aggregate budget: ${finalizedElapsedMs}`,
  );
  assert.ok(
    maximumFinalizedMs < maximumIncrementalBudgetMs,
    `One authored finalization exceeded the ${maximumIncrementalBudgetMs} ms worker budget: ${maximumFinalizedMs}`,
  );

  console.log(
    JSON.stringify({
      component: "authored-indicator-multichart",
      chartCount,
      historyBarsPerChart,
      aggregateHistoryBars: chartCount * historyBarsPerChart,
      historyElapsedMs,
      maximumHistoryMs,
      buildingRounds,
      buildingUpdates: chartCount * buildingRounds,
      buildingElapsedMs,
      maximumSweepMs,
      maximumBuildingMs,
      finalizedUpdates: chartCount,
      finalizedElapsedMs,
      maximumFinalizedMs,
      budgets: {
        historyBudgetMs,
        buildingSweepBudgetMs,
        maximumIncrementalBudgetMs,
        finalizedSweepBudgetMs,
      },
    }),
  );
} finally {
  for (const { instance } of charts) instance.dispose();
}
