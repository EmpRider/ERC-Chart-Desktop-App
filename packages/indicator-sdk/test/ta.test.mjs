import assert from "node:assert/strict";
import test from "node:test";

import {
  candlesWithPriceSource,
  createAtrKernel,
  createCrossoverKernel,
  createHighestKernel,
  createLowestKernel,
  createRsiKernel,
  movingAverage,
  movingAverageTypes,
  priceSeries,
  ta,
} from "../dist/index.js";

function candle(index, close, overrides = {}) {
  const open = overrides.open ?? close - 0.25;
  return {
    instrumentId: "fixture.instrument",
    timeframeId: "1m",
    openTimeMs: 1_800_000_000_000 + index * 60_000,
    open,
    high: overrides.high ?? Math.max(open, close) + 0.5,
    low: overrides.low ?? Math.min(open, close) - 0.5,
    close,
    volume: overrides.volume ?? 100 + index,
  };
}

test("exports the shared moving-average catalogue and produces finite mature values", () => {
  const values = Array.from(
    { length: 240 },
    (_, index) => 100 + index * 0.05 + Math.sin(index / 5),
  );

  assert.equal(ta.movingAverage, movingAverage);
  assert.equal(new Set(movingAverageTypes).size, movingAverageTypes.length);
  for (const type of movingAverageTypes) {
    const result = movingAverage(values, type, 7);
    assert.equal(result.length, values.length, type);
    assert.ok(Number.isFinite(result.at(-1)), type);
  }
});

test("ATR building updates derive from committed state without compounding", () => {
  const history = [candle(0, 100), candle(1, 101), candle(2, 102)];
  const firstBuilding = candle(3, 104, { high: 105, low: 101.5 });
  const replacement = candle(3, 103, { high: 104, low: 101.75 });

  const kernel = createAtrKernel(3);
  for (const item of history) kernel.update(item, "finalized");
  kernel.update(firstBuilding, "building");
  const replacementValue = kernel.update(replacement, "building");

  const reference = createAtrKernel(3);
  for (const item of history) reference.update(item, "finalized");
  const expected = reference.update(replacement, "building");
  assert.equal(replacementValue, expected);
  assert.equal(kernel.update(replacement, "finalized"), expected);
});

test("RSI building replacement is provisional and finalization commits once", () => {
  const history = [100, 101, 100.5, 102, 101.5, 103];
  const kernel = createRsiKernel(3);
  for (const value of history) kernel.update(value, "finalized");
  kernel.update(104, "building");
  const replacement = kernel.update(102.25, "building");

  const reference = createRsiKernel(3);
  for (const value of history) reference.update(value, "finalized");
  const expected = reference.update(102.25, "building");
  assert.equal(replacement, expected);
  assert.equal(kernel.update(102.25, "finalized"), expected);
});

test("highest, lowest, and crossover kernels keep bounded committed state", () => {
  const highest = createHighestKernel(3);
  const lowest = createLowestKernel(3);
  for (const value of [3, 1, 2]) {
    highest.update(value, "finalized");
    lowest.update(value, "finalized");
  }
  assert.equal(highest.update(0, "building"), 2);
  assert.equal(highest.update(4, "building"), 4);
  assert.equal(lowest.update(4, "building"), 1);
  assert.equal(lowest.update(0.5, "building"), 0.5);

  const cross = createCrossoverKernel();
  assert.equal(cross.update(1, 2, "finalized"), false);
  assert.equal(cross.update(3, 2, "building"), true);
  assert.equal(cross.update(1.5, 2, "building"), false);
  assert.equal(cross.update(3, 2, "finalized"), true);
  assert.equal(cross.update(4, 2, "building"), false);
});

test("price-source helpers preserve OHLC while exposing a synthetic close", () => {
  const candles = [candle(0, 100, { open: 99, high: 104, low: 98 })];
  const synthetic = candlesWithPriceSource(candles, "hl2");

  assert.notEqual(synthetic, candles);
  assert.equal(synthetic[0].open, candles[0].open);
  assert.equal(synthetic[0].high, candles[0].high);
  assert.equal(synthetic[0].low, candles[0].low);
  assert.equal(synthetic[0].close, 101);
  assert.deepEqual(priceSeries(candles, "ohlc4"), [(99 + 104 + 98 + 100) / 4]);
  assert.equal(candles[0].close, 100);
});
