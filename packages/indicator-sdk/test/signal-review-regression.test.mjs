import assert from "node:assert/strict";
import test from "node:test";
import { defineIndicator, signal } from "../dist/index.js";

const context = { instrumentId: "TEST", timeframeId: "1m" };

const candle = (index) => ({
  ...context,
  openTimeMs: index * 60_000,
  open: 10,
  high: 12,
  low: 8,
  close: 11,
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
