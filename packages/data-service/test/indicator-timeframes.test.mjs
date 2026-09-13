import assert from "node:assert/strict";
import test from "node:test";

const dataService = await import("../dist/index.js");

const epoch = Object.freeze({ mode: "epoch", originMs: 0, timeZone: "UTC" });

const native = (id, seconds, options = {}) => ({
  id,
  seconds,
  historical: options.historical ?? true,
  live: options.live ?? true,
  native: true,
  alignment: epoch,
});

const derived = (id, seconds, sourceTimeframeId, options = {}) => ({
  id,
  seconds,
  historical: options.historical ?? true,
  live: options.live ?? true,
  native: false,
  derivedFromTimeframeId: sourceTimeframeId,
  alignment: options.alignment ?? epoch,
});

function capabilities({
  nativeTimeframes,
  derivedTimeframeIds = [],
  timeframes,
}) {
  return {
    instruments: true,
    nativeTimeframes,
    liveData: true,
    derivedTimeframes: derivedTimeframeIds.length > 0,
    derivedTimeframeIds,
    timeframes,
  };
}

test("effective indicator timeframes come only from the active provider capability set", () => {
  assert.equal(
    typeof dataService.effectiveIndicatorTimeframes,
    "function",
    "data-service must expose the provider-driven indicator timeframe resolver",
  );

  const binomoLike = capabilities({
    nativeTimeframes: ["1m", "5m"],
    derivedTimeframeIds: ["3m"],
    timeframes: [
      native("1m", 60),
      native("5m", 300, { live: false }),
      derived("3m", 180, "1m"),
    ],
  });

  assert.deepEqual(dataService.effectiveIndicatorTimeframes(binomoLike), [
    {
      id: "1m",
      seconds: 60,
      native: true,
      historical: true,
      live: true,
      sourceTimeframeId: "1m",
    },
    {
      id: "5m",
      seconds: 300,
      native: true,
      historical: true,
      live: false,
      sourceTimeframeId: "5m",
    },
    {
      id: "3m",
      seconds: 180,
      native: false,
      historical: true,
      live: true,
      sourceTimeframeId: "1m",
    },
  ]);

  const otherProvider = capabilities({
    nativeTimeframes: ["15m"],
    timeframes: [native("15m", 900)],
  });
  assert.deepEqual(dataService.effectiveIndicatorTimeframes(otherProvider), [
    {
      id: "15m",
      seconds: 900,
      native: true,
      historical: true,
      live: true,
      sourceTimeframeId: "15m",
    },
  ]);
});

test("effective derived availability is constrained by its native source", () => {
  const provider = capabilities({
    nativeTimeframes: ["1m"],
    derivedTimeframeIds: ["3m"],
    timeframes: [native("1m", 60, { live: false }), derived("3m", 180, "1m")],
  });

  assert.deepEqual(dataService.effectiveIndicatorTimeframes(provider), [
    {
      id: "1m",
      seconds: 60,
      native: true,
      historical: true,
      live: false,
      sourceTimeframeId: "1m",
    },
    {
      id: "3m",
      seconds: 180,
      native: false,
      historical: true,
      live: false,
      sourceTimeframeId: "1m",
    },
  ]);
});

test("invalid or undeclared derived capabilities are not offered to indicator authors", () => {
  const provider = capabilities({
    nativeTimeframes: ["1m", "5m"],
    derivedTimeframeIds: ["3m", "10m"],
    timeframes: [
      native("1m", 60),
      native("5m", 300),
      derived("3m", 180, "1m"),
      derived("10m", 600, "5m", {
        alignment: { mode: "session", originMs: 0, timeZone: "Asia/Colombo" },
      }),
      derived("15m", 900, "5m"),
    ],
  });

  assert.deepEqual(
    dataService.effectiveIndicatorTimeframes(provider).map(({ id }) => id),
    ["1m", "5m", "3m"],
  );
});

test("unavailable requested timeframe falls back without erasing the saved preference", () => {
  assert.equal(
    typeof dataService.resolveEffectiveIndicatorTimeframe,
    "function",
    "data-service must expose requested-vs-active timeframe resolution",
  );
  const provider = capabilities({
    nativeTimeframes: ["1m", "5m"],
    timeframes: [native("1m", 60), native("5m", 300)],
  });

  assert.deepEqual(
    dataService.resolveEffectiveIndicatorTimeframe(provider, "1h", "5m"),
    {
      requestedTimeframeId: "1h",
      active: {
        id: "5m",
        seconds: 300,
        native: true,
        historical: true,
        live: true,
        sourceTimeframeId: "5m",
      },
      usedFallback: true,
    },
  );

  assert.deepEqual(
    dataService.resolveEffectiveIndicatorTimeframe(provider, "1m", "5m"),
    {
      requestedTimeframeId: "1m",
      active: {
        id: "1m",
        seconds: 60,
        native: true,
        historical: true,
        live: true,
        sourceTimeframeId: "1m",
      },
      usedFallback: false,
    },
  );

  assert.throws(
    () => dataService.resolveEffectiveIndicatorTimeframe(provider, "1h", "30m"),
    /fallback.*unavailable/i,
  );
});
