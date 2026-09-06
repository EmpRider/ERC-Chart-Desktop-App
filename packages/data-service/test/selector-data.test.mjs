import assert from "node:assert/strict";
import test from "node:test";
import { createProviderSelectorData } from "../dist/index.js";

test("builds selector data from explicit provider timeframe capabilities", () => {
  const selector = createProviderSelectorData(
    {
      instruments: true,
      nativeTimeframes: ["1m", "5m"],
      liveData: true,
      derivedTimeframes: true,
      derivedTimeframeIds: ["2m"],
      timeframes: [
        {
          id: "5m",
          seconds: 300,
          historical: true,
          live: true,
          native: true,
          alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
        },
        {
          id: "2m",
          seconds: 120,
          historical: true,
          live: true,
          native: false,
          derivedFromTimeframeId: "1m",
          alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
        },
        {
          id: "1m",
          seconds: 60,
          historical: true,
          live: true,
          native: true,
          alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
        },
        {
          id: "ticks-only",
          seconds: 1,
          historical: false,
          live: true,
          native: true,
          alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
        },
      ],
    },
    [
      { id: "BTCUSD", symbol: "BTCUSD", name: "Bitcoin / USD" },
      { id: "BTCUSD", symbol: "BTCUSD", name: "Duplicate" },
      { id: "ETHUSD", symbol: "ETHUSD", name: "Ethereum / USD" },
    ],
  );

  assert.deepEqual(
    selector.instruments.map(({ id }) => id),
    ["BTCUSD", "ETHUSD"],
  );
  assert.deepEqual(
    selector.timeframes.map(({ id, seconds, native }) => ({
      id,
      seconds,
      native,
    })),
    [
      { id: "1m", seconds: 60, native: true },
      { id: "2m", seconds: 120, native: false },
      { id: "5m", seconds: 300, native: true },
    ],
  );
});
