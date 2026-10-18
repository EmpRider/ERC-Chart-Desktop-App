import assert from "node:assert/strict";
import test from "node:test";
import {
  MarketDataValidationError,
  normalizeCandle,
  normalizeCandles,
  normalizeTick,
} from "../dist/index.js";

const candle = {
  instrumentId: "BTCUSD",
  timeframeId: "1m",
  openTimeMs: 60_000,
  open: 10,
  high: 12,
  low: 9,
  close: 11,
  volume: 5,
};

test("normalizes valid candles into immutable downstream values", () => {
  const normalized = normalizeCandle(candle, {
    instrumentId: "BTCUSD",
    timeframeId: "1m",
  });

  assert.deepEqual(normalized, candle);
  assert.notEqual(normalized, candle);
  assert.equal(Object.isFrozen(normalized), true);
});

test("rejects malformed candle numbers and series mismatches", () => {
  assert.throws(
    () => normalizeCandle({ ...candle, high: Number.NaN }),
    (error) =>
      error instanceof MarketDataValidationError &&
      error.code === "MARKET_DATA_INVALID_CANDLE",
  );
  assert.throws(
    () => normalizeCandle({ ...candle, low: 11.5 }),
    /high and low must contain open and close/,
  );
  assert.throws(
    () =>
      normalizeCandle(candle, {
        instrumentId: "ETHUSD",
        timeframeId: "1m",
      }),
    /identity does not match/,
  );
});

test("validates candle batches atomically", () => {
  assert.throws(
    () => normalizeCandles([candle, { ...candle, close: Infinity }]),
    /close must be a finite number/,
  );
});

test("normalizes ticks and rejects wrong instruments", () => {
  const normalized = normalizeTick(
    {
      instrumentId: "BTCUSD",
      timestampMs: 61_000,
      price: 11.5,
    },
    { instrumentId: "BTCUSD" },
  );
  assert.equal(normalized.price, 11.5);
  assert.equal(Object.isFrozen(normalized), true);

  assert.throws(
    () =>
      normalizeTick(
        {
          instrumentId: "ETHUSD",
          timestampMs: 61_000,
          price: 11.5,
        },
        { instrumentId: "BTCUSD" },
      ),
    /identity does not match/,
  );
});
