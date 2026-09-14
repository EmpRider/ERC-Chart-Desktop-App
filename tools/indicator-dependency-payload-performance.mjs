import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { createIndicatorWorkerCandleSnapshot } from "@erc-chart/contracts";
import {
  INDICATOR_WORKER_MAX_DEPENDENCY_POINTS,
  createIndicatorWorkerSupervisor,
} from "../packages/indicator-runtime/dist/index.js";

// Run after npm run build. One chart supports five active indicators, so a
// consumer can depend on at most four other 100k-history indicators. Exercise
// that full 400k dependency payload through host validation and structured
// cloning, matching the Worker.postMessage cost that the runtime must absorb.
const activeIndicatorsPerChart = 5;
const pointsPerIndicator = 100_000;
const dependencyCount = activeIndicatorsPerChart - 1;
const aggregatePoints = dependencyCount * pointsPerIndicator;
const measurementRuns = 3;
const payloadBudgetMs = 5_000;

assert.equal(aggregatePoints, INDICATOR_WORKER_MAX_DEPENDENCY_POINTS);

const dependencies = Array.from(
  { length: dependencyCount },
  (_, dependency) => ({
    inputKey: `source-${dependency}`,
    instanceId: `upstream-${dependency}`,
    outputKey: "line",
    sourceGeneration: 1,
    sourceRevision: 1,
    configGeneration: 1,
    outputRevision: 1,
    points: Array.from({ length: pointsPerIndicator }, (_, index) => ({
      openTimeMs: index * 60_000,
      values: { line: dependency * pointsPerIndicator + index },
    })),
  }),
);

const elapsedMs = [];
let checksum = 0;
let onmessage = null;
const supervisor = createIndicatorWorkerSupervisor({
  workerFactory() {
    return {
      get onmessage() {
        return onmessage;
      },
      set onmessage(value) {
        onmessage = value;
      },
      onerror: null,
      postMessage(message) {
        const cloned = structuredClone(message);
        checksum +=
          cloned.dependencies?.reduce(
            (total, dependency) => total + dependency.points.length,
            0,
          ) ?? 0;
        queueMicrotask(() =>
          onmessage?.({
            data: {
              type: "result",
              instanceId: cloned.instanceId,
              sequence: cloned.sequence,
              dataRevision: cloned.dataRevision,
              configGeneration: cloned.configGeneration,
              result: {
                kind: "snapshot",
                snapshot: { points: [], overlays: [], signals: [] },
              },
            },
          }),
        );
      },
      terminate() {
        void 0;
      },
    };
  },
  startupTimeoutMs: payloadBudgetMs,
  updateTimeoutMs: payloadBudgetMs,
});

try {
  for (let run = 0; run < measurementRuns; run += 1) {
    const started = performance.now();
    await supervisor.sync({
      instanceId: "dependency-payload-performance",
      runtimeEntryUrl:
        "erc-plugin://plugin/erc.indicator.performance/1.0.0/dist/index.js",
      pluginId: "erc.indicator.performance",
      definitionId: "erc.indicator.performance.main",
      instrumentId: "PERF",
      timeframeId: "1m",
      parameters: {},
      dependencies,
      data: {
        kind: "snapshot",
        snapshot: createIndicatorWorkerCandleSnapshot([]),
      },
      dataRevision: run + 1,
      configGeneration: 1,
    });
    elapsedMs.push(performance.now() - started);
  }
} finally {
  supervisor.dispose();
}

const maximumElapsedMs = Math.max(...elapsedMs);
assert.equal(checksum, aggregatePoints * measurementRuns);
assert.ok(
  maximumElapsedMs < payloadBudgetMs,
  `Indicator dependency payload processing exceeded the ${payloadBudgetMs} ms budget: ${maximumElapsedMs}`,
);

console.log(
  JSON.stringify({
    component: "indicator-dependency-payload",
    measurementRuns,
    activeIndicatorsPerChart,
    dependencyCount,
    pointsPerIndicator,
    aggregatePoints,
    configuredPointBudget: INDICATOR_WORKER_MAX_DEPENDENCY_POINTS,
    elapsedMs,
    maximumElapsedMs,
    payloadBudgetMs,
    maximumBudgetUtilizationPercent: (maximumElapsedMs / payloadBudgetMs) * 100,
  }),
);
