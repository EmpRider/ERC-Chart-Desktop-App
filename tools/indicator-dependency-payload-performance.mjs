import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { createIndicatorWorkerCandleSnapshot } from "@erc-chart/contracts";
import {
  INDICATOR_WORKER_MAX_DEPENDENCY_POINTS,
  createIndicatorWorkerSupervisor,
} from "../packages/indicator-runtime/dist/index.js";

// Run after npm run build. One chart supports five active indicators, so a
// consumer can depend on at most four other 100k-history indicators. A single
// upstream may satisfy many source inputs, so exercise the full 64-binding
// protocol limit while sharing the four actual history payloads through host
// validation and structured cloning, matching Worker.postMessage semantics.
const activeIndicatorsPerChart = 5;
const pointsPerIndicator = 100_000;
const upstreamDependencyCount = activeIndicatorsPerChart - 1;
const dependencyBindingCount = 64;
const bindingsPerUpstream = dependencyBindingCount / upstreamDependencyCount;
const aggregatePoints = upstreamDependencyCount * pointsPerIndicator;
const measurementRuns = 3;
const payloadBudgetMs = 5_000;

assert.equal(aggregatePoints, INDICATOR_WORKER_MAX_DEPENDENCY_POINTS);
assert.equal(Number.isInteger(bindingsPerUpstream), true);

const upstreamPointBatches = Array.from(
  { length: upstreamDependencyCount },
  (_, upstream) =>
    Array.from({ length: pointsPerIndicator }, (_, index) => ({
      openTimeMs: index * 60_000,
      values: { line: upstream * pointsPerIndicator + index },
    })),
);
const dependencies = Array.from(
  { length: dependencyBindingCount },
  (_, binding) => {
    const upstream = Math.floor(binding / bindingsPerUpstream);
    return {
      inputKey: `source-${binding}`,
      instanceId: `upstream-${upstream}`,
      outputKey: "line",
      sourceGeneration: 1,
      sourceRevision: 1,
      configGeneration: 1,
      outputRevision: 1,
      points: upstreamPointBatches[upstream],
    };
  },
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
        const uniquePointBatches = new Set(
          cloned.dependencies?.map((dependency) => dependency.points) ?? [],
        );
        assert.equal(uniquePointBatches.size, upstreamDependencyCount);
        checksum += [...uniquePointBatches].reduce(
          (total, points) => total + points.length,
          0,
        );
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
    upstreamDependencyCount,
    dependencyBindingCount,
    bindingsPerUpstream,
    pointsPerIndicator,
    aggregatePoints,
    configuredPointBudget: INDICATOR_WORKER_MAX_DEPENDENCY_POINTS,
    elapsedMs,
    maximumElapsedMs,
    payloadBudgetMs,
    maximumBudgetUtilizationPercent: (maximumElapsedMs / payloadBudgetMs) * 100,
  }),
);
