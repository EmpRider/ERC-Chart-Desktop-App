import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateTimeframeCandles,
  alignedOpenTime,
  resolveTimeframePlan,
} from "../dist/index.js";

const oneMinute = {
  id: "1m",
  seconds: 60,
  historical: true,
  live: true,
  native: true,
  alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
};
const threeMinute = {
  id: "3m",
  seconds: 180,
  historical: true,
  live: true,
  native: false,
  derivedFromTimeframeId: "1m",
  alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
};

test("resolves provider-declared native and derived timeframe plans", () => {
  const capabilities = {
    instruments: true,
    nativeTimeframes: ["1m"],
    liveData: true,
    derivedTimeframes: true,
    derivedTimeframeIds: ["3m"],
    timeframes: [oneMinute, threeMinute],
  };
  assert.equal(resolveTimeframePlan(capabilities, "1m").source.id, "1m");
  assert.deepEqual(
    resolveTimeframePlan(capabilities, "3m").target,
    threeMinute,
  );
});

test("aggregates derived candles using the provider alignment origin", () => {
  const shifted = {
    ...threeMinute,
    alignment: { mode: "session", originMs: 60_000, timeZone: "UTC" },
  };
  assert.equal(alignedOpenTime(250_000, 180, shifted.alignment), 240_000);
  const candles = aggregateTimeframeCandles(
    [
      {
        instrumentId: "BTC",
        timeframeId: "1m",
        openTimeMs: 60_000,
        open: 10,
        high: 11,
        low: 9,
        close: 10.5,
      },
      {
        instrumentId: "BTC",
        timeframeId: "1m",
        openTimeMs: 120_000,
        open: 10.5,
        high: 12,
        low: 10,
        close: 11.5,
      },
      {
        instrumentId: "BTC",
        timeframeId: "1m",
        openTimeMs: 180_000,
        open: 11.5,
        high: 13,
        low: 11,
        close: 12.5,
      },
    ],
    shifted,
  );
  assert.equal(candles.length, 1);
  assert.deepEqual(
    {
      openTimeMs: candles[0].openTimeMs,
      open: candles[0].open,
      high: candles[0].high,
      low: candles[0].low,
      close: candles[0].close,
    },
    { openTimeMs: 60_000, open: 10, high: 13, low: 9, close: 12.5 },
  );
});

test("rejects invalid derived declarations instead of guessing a base timeframe", () => {
  assert.throws(
    () =>
      resolveTimeframePlan(
        {
          instruments: true,
          nativeTimeframes: ["1m"],
          liveData: true,
          derivedTimeframes: true,
          derivedTimeframeIds: ["2m"],
          timeframes: [oneMinute, { ...threeMinute, id: "2m", seconds: 100 }],
        },
        "2m",
      ),
    /declaration is invalid/,
  );
});

test("aligns fixed-origin boundaries exactly", () => {
  const alignment = { mode: "epoch", originMs: 30_000, timeZone: "UTC" };
  assert.deepEqual(
    [89_999, 90_000, 100_000, 149_999, 150_000].map((timestampMs) =>
      alignedOpenTime(timestampMs, 60, alignment),
    ),
    [30_000, 90_000, 90_000, 90_000, 150_000],
  );
});

test("rejects unsafe alignment metadata and negative aligned opens", () => {
  assert.throws(
    () =>
      alignedOpenTime(10_000, 60, {
        mode: "epoch",
        originMs: 30_000,
        timeZone: "UTC",
      }),
    /aligned open|non-negative/i,
  );
  assert.throws(
    () =>
      alignedOpenTime(100_000, Number.MAX_SAFE_INTEGER, {
        mode: "epoch",
        originMs: 0,
        timeZone: "UTC",
      }),
    /duration|safe/i,
  );
  assert.throws(
    () =>
      alignedOpenTime(100_000, 60, {
        mode: "calendar",
        originMs: 0,
        timeZone: "UTC",
      }),
    /alignment|mode/i,
  );
});
