import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  defineIndicator,
  plot,
  series,
} from "../packages/indicator-sdk/dist/index.js";
import { maxSeriesCollectionItems } from "../packages/indicator-sdk/dist/series.js";

// Run after npm run build. Synthetic, no renderer, storage or network.
const historyBars = 100_000;
const initial = Array.from(
  { length: maxSeriesCollectionItems },
  (_, index) => index,
);
const plugin = defineIndicator(
  { id: "erc.indicator.series-performance.main", name: "Series performance" },
  ({ close }) => {
    const state = series(initial, (previous) => {
      previous[0] = close;
      return previous;
    });
    plot.line(state[0] ?? null);
  },
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
    `Structured series replay exceeded the 60,000 ms worker budget: ${elapsedMs}`,
  );
  assert.equal(instance.snapshot().points.length, historyBars);
  assert.equal(initial[0], 0, "series must not mutate shared initial state");
  console.log(
    JSON.stringify({
      component: "indicator-series",
      historyBars,
      retainedCollectionItems: maxSeriesCollectionItems,
      elapsedMs,
      points: instance.snapshot().points.length,
    }),
  );
} finally {
  instance.dispose();
}
