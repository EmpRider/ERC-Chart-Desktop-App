import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { alignPluginIndicatorSnapshotRows } from "../packages/renderer/dist/plugin-indicators.js";

// Run after npm run build. This isolates whole-indicator timeframe alignment.
const chartCandleCount = 100_000;
const timeframeRatio = 4;
const pointCount = Math.ceil(chartCandleCount / timeframeRatio);
const chartTimeframeId = "15m";
const sourceTimeframeId = "1h";
const alignmentBudgetMs = 1_000;
const chartDuration = 15 * 60_000;
const sourceDuration = 60 * 60_000;

const dataList = Array.from({ length: chartCandleCount }, (_, index) => ({
  timestamp: index * chartDuration,
  open: 10,
  high: 12,
  low: 9,
  close: 11,
}));
const snapshot = {
  points: Array.from({ length: pointCount }, (_, index) => ({
    openTimeMs: index * sourceDuration,
    values: { line: index },
  })),
  overlays: [],
  signals: [],
};

function legacyRowsForSnapshot() {
  const points = [...snapshot.points].sort(
    (left, right) => left.openTimeMs - right.openTimeMs,
  );
  let pointIndex = 0;
  let latest;
  return dataList.map((data) => {
    const chartCloseTimeMs = data.timestamp + chartDuration;
    while (pointIndex < points.length) {
      const point = points[pointIndex];
      if (
        point === undefined ||
        point.openTimeMs + sourceDuration > chartCloseTimeMs
      )
        break;
      latest = { ...point.values };
      pointIndex += 1;
    }
    return latest ?? {};
  });
}

let started = performance.now();
const legacyRows = legacyRowsForSnapshot();
const beforeElapsedMs = performance.now() - started;

started = performance.now();
const rows = alignPluginIndicatorSnapshotRows(
  dataList,
  snapshot,
  sourceTimeframeId,
  chartTimeframeId,
);
const afterElapsedMs = performance.now() - started;
assert.ok(
  afterElapsedMs < alignmentBudgetMs,
  `Renderer MTF alignment exceeded the ${alignmentBudgetMs} ms budget: ${afterElapsedMs}`,
);
assert.equal(rows.length, legacyRows.length);
for (const index of [0, 3, 4, 50_000, 99_999])
  assert.deepEqual(rows[index], legacyRows[index]);

console.log(
  JSON.stringify({
    component: "renderer-mtf-snapshot-alignment",
    pointCount,
    chartCandleCount,
    timeframeRatio,
    beforeElapsedMs,
    afterElapsedMs,
    alignmentBudgetMs,
  }),
);
