import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalCandleState } from "../dist/index.js";

const key = {
  providerProfileId: "profile-a",
  instrumentId: "BTCUSD",
  timeframeId: "1m",
  timeframeSeconds: 60,
};

function candle(openTimeMs, close) {
  return {
    instrumentId: "BTCUSD",
    timeframeId: "1m",
    openTimeMs,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
  };
}

test("loads closed history and keeps only the current candle building", () => {
  const state = createCanonicalCandleState();
  state.loadHistory(
    key,
    [candle(0, 10), candle(60_000, 11), candle(120_000, 12)],
    150_000,
  );
  const snapshot = state.snapshot(key);

  assert.deepEqual([...snapshot.timeMs], [0, 60_000]);
  assert.equal(snapshot.building?.openTimeMs, 120_000);
  assert.equal(snapshot.building?.isFinal, false);
});

test("finalizes a building candle before advancing live candle state", () => {
  const state = createCanonicalCandleState();
  state.loadHistory(key, [candle(60_000, 11)], 90_000);
  const deltas = state.applyCandles(key, [candle(120_000, 12)], 150_000);

  assert.deepEqual(
    deltas.map(({ kind }) => kind),
    ["bar-finalized", "building-updated"],
  );
  assert.equal(state.snapshot(key).building?.openTimeMs, 120_000);
  assert.deepEqual([...state.snapshot(key).timeMs], [60_000]);
});

test("builds OHLC incrementally from ticks and ignores obsolete ticks", () => {
  const state = createCanonicalCandleState();
  state.applyTicks(key, [
    { instrumentId: "BTCUSD", timestampMs: 61_000, price: 10 },
    { instrumentId: "BTCUSD", timestampMs: 62_000, price: 12 },
    { instrumentId: "BTCUSD", timestampMs: 63_000, price: 9 },
    { instrumentId: "BTCUSD", timestampMs: 64_000, price: 11 },
  ]);
  const building = state.snapshot(key).building;
  assert.deepEqual(
    {
      open: building?.open,
      high: building?.high,
      low: building?.low,
      close: building?.close,
    },
    { open: 10, high: 12, low: 9, close: 11 },
  );

  state.applyTicks(key, [
    { instrumentId: "BTCUSD", timestampMs: 121_000, price: 13 },
  ]);
  assert.equal(state.finalizedCandles(key)[0].close, 11);
  assert.equal(state.snapshot(key).building?.openTimeMs, 120_000);

  assert.deepEqual(
    state.applyTicks(key, [
      { instrumentId: "BTCUSD", timestampMs: 65_000, price: 99 },
    ]),
    [],
  );
  assert.equal(state.finalizedCandles(key)[0].close, 11);
});

test("treats duplicate live candles as no-op revisions", () => {
  const state = createCanonicalCandleState();
  state.applyCandles(key, [candle(60_000, 11)], 90_000);
  const before = state.snapshot(key).revision;
  assert.deepEqual(state.applyCandles(key, [candle(60_000, 11)], 90_000), []);
  assert.equal(state.snapshot(key).revision, before);
});

test("persists only changed finalized candles and retains incremental history", () => {
  const upserts = [];
  const retains = [];
  const cache = {
    newest: () => [],
    range: () => [],
    upsert: (_key, candles) => {
      upserts.push(
        candles.map(({ openTimeMs, close, revision }) => ({
          openTimeMs,
          close,
          revision,
        })),
      );
      return candles.length;
    },
    retain: (_key, maximumBars) => {
      retains.push(maximumBars);
      return 0;
    },
  };
  const state = createCanonicalCandleState({
    cache,
    maximumFinalizedBars: 2,
  });

  state.loadHistory(
    key,
    [
      candle(0, 10),
      candle(60_000, 11),
      candle(120_000, 12),
      candle(180_000, 13),
    ],
    210_000,
  );
  assert.equal(upserts[0].length, 3);
  assert.deepEqual(retains, [2]);
  upserts.length = 0;
  retains.length = 0;

  const revisionDeltas = state.applyCandles(key, [candle(60_000, 99)], 210_000);
  assert.deepEqual(
    revisionDeltas.map(({ kind }) => kind),
    ["bar-revised"],
  );
  assert.deepEqual(
    upserts.map((batch) =>
      batch.map(({ openTimeMs, close }) => ({ openTimeMs, close })),
    ),
    [[{ openTimeMs: 60_000, close: 99 }]],
  );
  assert.deepEqual(retains, []);

  upserts.length = 0;
  const rolloverDeltas = state.applyCandles(
    key,
    [candle(240_000, 14)],
    250_000,
  );
  assert.deepEqual(
    rolloverDeltas.map(({ kind }) => kind),
    ["bar-finalized", "building-updated"],
  );
  assert.deepEqual(
    upserts.map((batch) => batch.map(({ openTimeMs }) => openTimeMs)),
    [[180_000]],
  );
  assert.deepEqual(retains, [2]);
  assert.deepEqual(
    state.finalizedCandles(key).map(({ openTimeMs }) => openTimeMs),
    [120_000, 180_000],
  );
});
