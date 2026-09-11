import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { defineIndicator, plot } from "../packages/indicator-sdk/dist/index.js";

// SDK-only fixture. The enforced budget matches the worker's maximum history timeout.
const historyBars = 100_000;
const drawingCount = 2_000;
const budgetMs = 60_000;
const drawings = Array.from({ length: drawingCount }, (_, index) => ({
  left: 0,
  right: 60_000,
  top: index + 1,
  bottom: index,
  color: "#008800",
}));
const plugin = defineIndicator(
  {
    id: "erc.indicator.drawings-performance.main",
    name: "Drawing performance",
  },
  () => {
    for (const drawing of drawings) plot.box(drawing);
  },
);
const candle = (index) => ({
  instrumentId: "PERF",
  timeframeId: "1m",
  openTimeMs: index * 60_000,
  open: 10,
  high: 12,
  low: 9,
  close: 11,
});
const instance = plugin.createInstance(
  {},
  { instrumentId: "PERF", timeframeId: "1m" },
);
try {
  const candles = Array.from({ length: historyBars }, (_, index) =>
    candle(index),
  );
  const started = performance.now();
  instance.onHistory(candles);
  const elapsedMs = performance.now() - started;
  const snapshot = instance.snapshot();
  assert.equal(snapshot.points.length, historyBars);
  assert.equal(snapshot.overlays.length, drawingCount);
  instance.onBuildingBar({ ...candle(historyBars - 1), close: 10.5 });
  assert.strictEqual(instance.snapshot().overlays, snapshot.overlays);
  assert.equal(instance.snapshot().visualRevision, snapshot.visualRevision);
  console.log(
    JSON.stringify({
      component: "indicator-drawings",
      historyBars,
      drawingCount,
      elapsedMs,
      budgetMs,
    }),
  );
  assert.ok(
    elapsedMs < budgetMs,
    `Drawing replay exceeded ${budgetMs} ms: ${elapsedMs}`,
  );
} finally {
  instance.dispose();
}
