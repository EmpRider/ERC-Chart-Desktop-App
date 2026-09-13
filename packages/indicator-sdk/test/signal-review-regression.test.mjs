import assert from "node:assert/strict";
import test from "node:test";
import { defineIndicator, signal, ta } from "../dist/index.js";

const context = { instrumentId: "TEST", timeframeId: "1m" };

const candle = (index, close = 11) => ({
  ...context,
  openTimeMs: index * 60_000,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: 1,
});

test("rejected signals do not consume fallback persistence identity", () => {
  const plugin = defineIndicator(
    { id: "erc.indicator.signal-rejection.main", name: "Signal rejection" },
    () => {
      try {
        signal(true, "long", { confidence: 2 });
      } catch (error) {
        assert.match(error.message, /between 0 and 1/u);
      }
      signal(true, "short");
    },
  );
  const instance = plugin.createInstance({}, context);

  try {
    instance.onHistory([candle(0), candle(1)]);
    assert.equal(instance.snapshot().signals.length, 1);
    assert.equal(instance.snapshot().signals[0].id, "signal_0:0");
  } finally {
    instance.dispose();
  }
});

const taCallsite = Object.freeze({
  __ercCallsite: "v2",
  id: "erc-v2-ta-000000000000000000000101",
  kind: "ta",
  callee: "ta.ema",
  seriesSource: "close",
  source: Object.freeze({
    file: "signal-review-regression.test.mjs",
    line: 101,
    column: 1,
  }),
});
const dependentSignalCallsite = Object.freeze({
  __ercCallsite: "v2",
  id: "erc-v2-signal-000000000000000000000102",
  kind: "signal",
  callee: "signal",
  dependencies: Object.freeze([taCallsite.id]),
  chartSeries: Object.freeze([]),
  source: Object.freeze({
    file: "signal-review-regression.test.mjs",
    line: 102,
    column: 1,
  }),
});

test("signals suppress true conditions while a TA dependency is still warming up", () => {
  const plugin = defineIndicator(
    { id: "erc.indicator.signal-warmup.main", name: "Signal warmup" },
    () => {
      const average = ta.ema(3, undefined, taCallsite);
      signal(
        !Number.isFinite(average),
        "long",
        undefined,
        dependentSignalCallsite,
      );
    },
  );
  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0), candle(1), candle(2), candle(3)]);
    assert.deepEqual(instance.snapshot().signals, []);
  } finally {
    instance.dispose();
  }
});

test("higher-timeframe signals wait for source confirmation and emit once per confirmed source candle", () => {
  const higherCandles = [
    { ...candle(0), timeframeId: "1h", openTimeMs: 0, close: 100 },
  ];
  const plugin = defineIndicator(
    { id: "erc.indicator.signal-mtf.main", name: "Signal MTF" },
    () => {
      const higher = ta.ema(1, "1h", taCallsite);
      signal(
        Number.isFinite(higher),
        "long",
        undefined,
        dependentSignalCallsite,
      );
    },
  );
  const base = Array.from({ length: 14 }, (_, index) => ({
    ...candle(index),
    timeframeId: "5m",
    openTimeMs: index * 5 * 60_000,
  }));
  const create = () =>
    plugin.createInstance(
      {},
      {
        instrumentId: "TEST",
        timeframeId: "5m",
        sourceCandles: { "1h": higherCandles },
        sourceMetadata: {
          "1h": {
            activeTimeframeId: "1h",
            generation: 7,
            revision: 11,
            finalizedCount: Math.max(0, higherCandles.length - 1),
            provenance: { kind: "synthetic", candleType: "heikin-ashi" },
          },
        },
      },
    );

  const provisional = create();
  try {
    provisional.onHistory(base);
    assert.deepEqual(provisional.snapshot().signals, []);
  } finally {
    provisional.dispose();
  }

  higherCandles.push({
    ...candle(1),
    timeframeId: "1h",
    openTimeMs: 60 * 60_000,
    close: 200,
  });
  const confirmed = create();
  try {
    confirmed.onHistory(base);
    assert.equal(confirmed.snapshot().signals.length, 1);
    assert.deepEqual(confirmed.snapshot().signals[0].sources, [
      {
        timeframeId: "1h",
        activeTimeframeId: "1h",
        openTimeMs: 0,
        generation: 7,
        revision: 11,
        provenance: { kind: "synthetic", candleType: "heikin-ashi" },
      },
    ]);
  } finally {
    confirmed.dispose();
  }
});

const chartSignalCallsite = Object.freeze({
  __ercCallsite: "v2",
  id: "erc-v2-signal-000000000000000000000103",
  kind: "signal",
  callee: "signal",
  dependencies: Object.freeze([]),
  chartSeries: Object.freeze(["close"]),
  source: Object.freeze({
    file: "signal-review-regression.test.mjs",
    line: 103,
    column: 1,
  }),
});

function chartSignalPlugin() {
  return defineIndicator(
    { id: "erc.indicator.signal-lifecycle.main", name: "Signal lifecycle" },
    ({ close }) => {
      signal(close > 10, "long", undefined, chartSignalCallsite);
    },
  );
}

test("repeated building recalculation never duplicates finalized signals", () => {
  const instance = chartSignalPlugin().createInstance({}, context);
  try {
    instance.onHistory([candle(0, 11), candle(1, 11)]);
    const initial = structuredClone(instance.snapshot().signals);
    for (const close of [12, 13, 14, 11])
      instance.onBuildingBar(candle(1, close));
    assert.deepEqual(instance.snapshot().signals, initial);
    instance.onFinalizedBar(candle(1, 11));
    instance.onFinalizedBar(candle(1, 11));
    assert.equal(instance.snapshot().signals.length, 2);
    assert.deepEqual(
      instance.snapshot().signals.map(({ occurredAtMs }) => occurredAtMs),
      [0, 60_000],
    );
  } finally {
    instance.dispose();
  }
});

test("full replay and equivalent incremental updates produce identical finalized signals", () => {
  const plugin = chartSignalPlugin();
  const replay = plugin.createInstance({}, context);
  const incremental = plugin.createInstance({}, context);
  const candles = [candle(0, 11), candle(1, 12), candle(2, 13), candle(3, 14)];
  try {
    replay.onHistory(candles);
    incremental.onHistory(candles.slice(0, 2));
    incremental.onFinalizedBar(candles[1]);
    incremental.onBuildingBar(candles[2]);
    incremental.onFinalizedBar(candles[2]);
    incremental.onBuildingBar(candles[3]);
    assert.deepEqual(incremental.snapshot().signals, replay.snapshot().signals);
  } finally {
    replay.dispose();
    incremental.dispose();
  }
});

test("corrected history rebuild removes stale downstream signals", () => {
  const instance = chartSignalPlugin().createInstance({}, context);
  try {
    instance.onHistory([candle(0, 11), candle(1, 9)]);
    assert.equal(instance.snapshot().signals.length, 1);
    instance.onHistory([candle(0, 9), candle(1, 9)]);
    assert.deepEqual(instance.snapshot().signals, []);
  } finally {
    instance.dispose();
  }
});
