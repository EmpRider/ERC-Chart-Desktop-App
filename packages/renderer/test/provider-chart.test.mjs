import assert from "node:assert/strict";
import test from "node:test";
import { updateChartData } from "../dist/index.js";

test("forwards live candles through the KLineCharts incremental bar callback", () => {
  const updates = [];
  updateChartData(
    (data) => updates.push(data),
    [
      {
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        openTimeMs: 1_800_000_000_000,
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
      },
      {
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        openTimeMs: 1_800_000_000_000,
        open: 100,
        high: 102,
        low: 99,
        close: 101.5,
        volume: 12,
      },
      {
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        openTimeMs: 1_800_000_060_000,
        open: 101.5,
        high: 103,
        low: 101,
        close: 102.5,
      },
    ],
  );

  assert.deepEqual(updates, [
    {
      timestamp: 1_800_000_000_000,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
    },
    {
      timestamp: 1_800_000_000_000,
      open: 100,
      high: 102,
      low: 99,
      close: 101.5,
      volume: 12,
    },
    {
      timestamp: 1_800_000_060_000,
      open: 101.5,
      high: 103,
      low: 101,
      close: 102.5,
    },
  ]);
});
