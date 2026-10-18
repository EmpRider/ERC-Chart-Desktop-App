import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalSeriesStore } from "../dist/index.js";

const key = {
  providerProfileId: "profile-a",
  instrumentId: "BTCUSD",
  timeframeId: "1m",
  timeframeSeconds: 60,
};

function candle(openTimeMs, close, overrides = {}) {
  return {
    instrumentId: "BTCUSD",
    timeframeId: "1m",
    openTimeMs,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    ...overrides,
  };
}

test("stores finalized bars in typed arrays with derived price sources", () => {
  const store = createCanonicalSeriesStore();
  store.replaceHistory(key, [candle(120_000, 12), candle(60_000, 11)]);
  const snapshot = store.snapshot(key);

  assert.deepEqual([...snapshot.timeMs], [60_000, 120_000]);
  assert.deepEqual([...snapshot.close], [11, 12]);
  assert.deepEqual([...snapshot.hl2], [10.5, 11.5]);
  assert.deepEqual([...snapshot.hlc3], [32 / 3, 35 / 3]);
  assert.deepEqual([...snapshot.ohlc4], [10.5, 11.5]);
  assert.equal(snapshot.generation, 1);
  assert.equal(snapshot.revision, 1);
});

test("inserts out-of-order finalized bars and revises duplicates deterministically", () => {
  const store = createCanonicalSeriesStore();
  store.replaceHistory(key, [candle(120_000, 12)]);
  const inserted = store.upsertFinalized(key, candle(60_000, 11));
  const duplicate = store.upsertFinalized(key, candle(60_000, 11));
  const revised = store.upsertFinalized(key, candle(60_000, 11.5));

  assert.equal(inserted?.kind, "bar-finalized");
  assert.equal(duplicate, undefined);
  assert.equal(revised?.kind, "bar-revised");
  assert.deepEqual(
    store.finalizedCandles(key).map((item) => [item.openTimeMs, item.close]),
    [
      [60_000, 11.5],
      [120_000, 12],
    ],
  );
  assert.equal(store.snapshot(key).revision, 3);
});

test("tracks one building candle and finalizes it with a single canonical revision", () => {
  const store = createCanonicalSeriesStore();
  store.replaceHistory(key, [candle(60_000, 11)]);
  const building = store.updateBuilding(key, candle(120_000, 12));
  const updated = store.updateBuilding(key, candle(120_000, 12.5));
  const finalized = store.finalizeBuilding(key);

  assert.equal(building?.kind, "building-updated");
  assert.equal(updated?.revision, 3);
  assert.equal(finalized?.kind, "bar-finalized");
  assert.equal(finalized?.revision, 4);
  assert.equal(store.buildingCandle(key), undefined);
  assert.equal(store.latestFinalized(key)?.close, 12.5);
  assert.equal(store.latestFinalized(key)?.isFinal, true);
});

test("rejects advancing a building bar before the previous bar is finalized", () => {
  const store = createCanonicalSeriesStore();
  store.updateBuilding(key, candle(60_000, 11));
  assert.throws(
    () => store.updateBuilding(key, candle(120_000, 12)),
    /must be finalized before advancing/,
  );
});

test("returns detached typed-array snapshots and retains a stable base index", () => {
  const store = createCanonicalSeriesStore();
  store.replaceHistory(key, [
    candle(0, 10),
    candle(60_000, 11),
    candle(120_000, 12),
  ]);
  const first = store.snapshot(key);
  first.close[0] = 999;
  const trimmed = store.trimFinalized(key, 2);
  const second = store.snapshot(key);

  assert.equal(trimmed?.kind, "retention-trimmed");
  assert.equal(second.baseIndex, 1);
  assert.deepEqual([...second.close], [11, 12]);
  assert.notEqual(second.close[0], 999);
});

test("keeps independent revision streams per provider profile", () => {
  const store = createCanonicalSeriesStore();
  store.replaceHistory(key, [candle(0, 10)]);
  const otherKey = { ...key, providerProfileId: "profile-b" };
  store.replaceHistory(otherKey, [candle(0, 20)]);
  store.upsertFinalized(key, candle(60_000, 11));

  assert.equal(store.snapshot(key).revision, 2);
  assert.equal(store.snapshot(otherKey).revision, 1);
  store.clearProfile("profile-a");
  assert.equal(store.snapshot(key).revision, 0);
  assert.equal(store.snapshot(otherKey).revision, 1);
});
