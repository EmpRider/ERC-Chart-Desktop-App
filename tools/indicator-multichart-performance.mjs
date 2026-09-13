import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import {
  atrRopeUtBotPackageIdentity,
  buildAtrRopeUtBotIndicatorPackage,
} from "./build-atr-rope-utbot-indicator.mjs";
import {
  disposePluginIndicatorContexts,
  reconcilePluginIndicators,
} from "../packages/renderer/dist/plugin-indicators.js";
import { createBrowserIndicatorRuntime } from "../packages/renderer/dist/indicator-worker-runtime.js";

// Run after npm run build. This exercises the production renderer chart scope,
// browser-runtime supervisor, worker-entry transport and compiled SDK v2 package
// across four independent chart objects. It is not a renderer FPS/provider gate.
const chartCount = 4;
const historyBarsPerChart = 25_000;
const buildingRounds = 250;
const historyBudgetMs = 60_000;
const buildingSweepBudgetMs = 5_000;
const maximumIncrementalBudgetMs = 100;
const finalizedSweepBudgetMs = 1_000;

const repoRoot = path.resolve(import.meta.dirname, "..");
const timeframeId = "1m";
const instrumentId = (chartIndex) => `PERF-${chartIndex + 1}`;
const kline = (chartIndex, index, close = 11 + (index % 10) / 10) => ({
  timestamp: index * 60_000,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: index + 1,
});

function makeChart() {
  const ids = new Set();
  return {
    ids,
    chart: {
      getIndicators({ id }) {
        return ids.has(id) ? [{ id, name: undefined }] : [];
      },
      createIndicator(value) {
        ids.add(value.id);
        return "candle_pane";
      },
      overrideIndicator() {
        return true;
      },
      removeIndicator({ id }) {
        ids.delete(id);
        return true;
      },
    },
  };
}

function nodeWorkerFactory(bootstrapUrl, workerEntryUrl, createdWorkers) {
  return () => {
    const worker = new NodeWorker(bootstrapUrl, {
      workerData: { workerEntryUrl },
    });
    createdWorkers.push(worker);
    const adapter = {
      onmessage: null,
      onerror: null,
      postMessage(message) {
        worker.postMessage(message);
      },
      terminate() {
        void worker.terminate();
      },
    };
    worker.on("message", (data) => adapter.onmessage?.({ data }));
    worker.on("error", (error) =>
      adapter.onerror?.({ message: error.message }),
    );
    return adapter;
  };
}

const outputRoot = await mkdtemp(
  path.join(os.tmpdir(), "erc-authored-multichart-performance-"),
);
const createdWorkers = [];
const runtimeIds = [];
let browserRuntime;

try {
  const built = await buildAtrRopeUtBotIndicatorPackage({
    root: repoRoot,
    outputRoot: path.join(outputRoot, "package"),
  });
  const entry = path.join(built.packageRoot, "dist", "index.js");
  const runtimeEntryUrl = pathToFileURL(entry).href;
  const indicatorModule = await import(`${runtimeEntryUrl}?metadata=${Date.now()}`);
  const indicator = indicatorModule.default;
  assert.ok(indicator?.definition && indicator.createInstance);

  const workerEntryUrl = pathToFileURL(
    path.join(
      repoRoot,
      "packages",
      "indicator-runtime",
      "dist",
      "worker-entry.js",
    ),
  ).href;
  const bootstrapPath = path.join(outputRoot, "worker-bootstrap.mjs");
  await writeFile(
    bootstrapPath,
    `import { parentPort, workerData } from "node:worker_threads";\n` +
      `if (parentPort === null) throw new Error("Indicator performance worker has no parent port");\n` +
      `const queued = [];\n` +
      `globalThis.postMessage = (message) => parentPort.postMessage(message);\n` +
      `parentPort.on("message", (data) => {\n` +
      `  if (typeof globalThis.onmessage === "function") globalThis.onmessage({ data });\n` +
      `  else queued.push(data);\n` +
      `});\n` +
      `await import(workerData.workerEntryUrl);\n` +
      `for (const data of queued.splice(0)) globalThis.onmessage?.({ data });\n`,
    "utf8",
  );
  const bootstrapUrl = pathToFileURL(bootstrapPath);
  browserRuntime = createBrowserIndicatorRuntime({
    workerFactory: nodeWorkerFactory(
      bootstrapUrl,
      workerEntryUrl,
      createdWorkers,
    ),
  });

  let template;
  const klineModule = {
    registerIndicator(value) {
      template ??= value;
    },
  };
  const parameters = Object.fromEntries(
    indicator.definition.inputs.map((input) => [input.key, input.defaultValue]),
  );
  const summary = {
    pluginId: atrRopeUtBotPackageIdentity.id,
    pluginName: atrRopeUtBotPackageIdentity.name,
    version: atrRopeUtBotPackageIdentity.version,
    runtimeEntryUrl,
    definition: indicator.definition,
  };
  const workspaceIndicator = {
    instanceId: "multichart-performance",
    pluginId: summary.pluginId,
    definitionId: summary.definition.id,
    enabled: true,
    parameters,
    inputs: { source: { kind: "candles" } },
  };
  const charts = Array.from({ length: chartCount }, (_, chartIndex) => {
    const owned = makeChart();
    const reconciliation = reconcilePluginIndicators(
      klineModule,
      owned.chart,
      [workspaceIndicator],
      [summary],
      browserRuntime.sync,
      instrumentId(chartIndex),
      timeframeId,
    );
    const [runtimeId] = reconciliation.managedRuntimeIds;
    assert.ok(runtimeId, "multi-chart reconciliation must create a runtime id");
    runtimeIds.push(runtimeId);
    return {
      chartIndex,
      ...owned,
      runtimeId,
      data: Array.from({ length: historyBarsPerChart }, (_, index) =>
        kline(chartIndex, index),
      ),
      rows: undefined,
    };
  });
  assert.ok(
    template,
    "multi-chart reconciliation must register a KLineCharts template",
  );
  assert.equal(new Set(runtimeIds).size, chartCount);

  const historyStarted = performance.now();
  let maximumHistoryMs = 0;
  for (const chart of charts) {
    const chartHistoryStarted = performance.now();
    chart.rows = await template.calc(chart.data, {
      id: chart.runtimeId,
      result: chart.rows,
    });
    maximumHistoryMs = Math.max(
      maximumHistoryMs,
      performance.now() - chartHistoryStarted,
    );
    assert.equal(chart.rows.length, historyBarsPerChart);
  }
  const historyElapsedMs = performance.now() - historyStarted;
  assert.equal(createdWorkers.length, chartCount);
  assert.ok(
    historyElapsedMs < historyBudgetMs,
    `Four-chart authored history exceeded the ${historyBudgetMs} ms budget: ${historyElapsedMs}`,
  );
  assert.ok(
    maximumHistoryMs < historyBudgetMs,
    `One authored chart exceeded the ${historyBudgetMs} ms history budget: ${maximumHistoryMs}`,
  );

  const stableRows = charts.map(({ rows }) => rows);
  for (let warmup = 0; warmup < 20; warmup += 1) {
    for (const chart of charts) {
      chart.data[historyBarsPerChart - 1] = kline(
        chart.chartIndex,
        historyBarsPerChart - 1,
        20 + warmup / 100 + chart.chartIndex / 1_000,
      );
      chart.rows = await template.calc(chart.data, {
        id: chart.runtimeId,
        result: chart.rows,
      });
    }
  }

  let maximumBuildingMs = 0;
  let maximumSweepMs = 0;
  const buildingStarted = performance.now();
  for (let round = 0; round < buildingRounds; round += 1) {
    const sweepStarted = performance.now();
    for (const chart of charts) {
      chart.data[historyBarsPerChart - 1] = kline(
        chart.chartIndex,
        historyBarsPerChart - 1,
        30 + (round % 100) / 100 + chart.chartIndex / 1_000,
      );
      const updateStarted = performance.now();
      chart.rows = await template.calc(chart.data, {
        id: chart.runtimeId,
        result: chart.rows,
      });
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
  for (const [index, chart] of charts.entries()) {
    assert.strictEqual(
      chart.rows,
      stableRows[index],
      "multi-chart provisional updates must retain renderer row history",
    );
  }

  let maximumFinalizedMs = 0;
  const finalizedStarted = performance.now();
  for (const chart of charts) {
    chart.data[historyBarsPerChart - 1] = kline(
      chart.chartIndex,
      historyBarsPerChart - 1,
      40 + chart.chartIndex / 1_000,
    );
    chart.data.push(
      kline(
        chart.chartIndex,
        historyBarsPerChart,
        41 + chart.chartIndex / 1_000,
      ),
    );
    const updateStarted = performance.now();
    chart.rows = await template.calc(chart.data, {
      id: chart.runtimeId,
      result: chart.rows,
    });
    maximumFinalizedMs = Math.max(
      maximumFinalizedMs,
      performance.now() - updateStarted,
    );
    assert.equal(chart.rows.length, historyBarsPerChart + 1);
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
      component: "authored-indicator-real-multichart",
      chartCount,
      workerCount: createdWorkers.length,
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
  browserRuntime?.dispose();
  disposePluginIndicatorContexts(runtimeIds);
  await Promise.allSettled(createdWorkers.map((worker) => worker.terminate()));
  await rm(outputRoot, { recursive: true, force: true });
}
