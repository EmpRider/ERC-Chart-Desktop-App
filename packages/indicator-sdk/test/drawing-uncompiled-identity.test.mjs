import assert from "node:assert/strict";
import test from "node:test";
import { defineIndicator, plot } from "../dist/index.js";

const context = { instrumentId: "TEST", timeframeId: "1m" };
const candle = (index, close = 20 + index) => ({
  ...context,
  openTimeMs: index * 60_000,
  open: close - 1,
  high: close + 2,
  low: close - 2,
  close,
  volume: 1,
});

test("uncompiled conditional same-kind drawings fail closed instead of aliasing", () => {
  const plugin = defineIndicator(
    {
      id: "erc.indicator.uncompiled-drawing-order.main",
      name: "Uncompiled drawing order",
    },
    (bar) => {
      if (bar.index === 0) {
        plot.box({
          left: bar.openTimeMs,
          right: bar.openTimeMs + 60_000,
          top: bar.close + 10,
          bottom: bar.close + 9,
          color: "#008800",
        });
      }
      plot.box({
        left: bar.openTimeMs,
        right: bar.openTimeMs + 60_000,
        top: bar.close,
        bottom: bar.close - 1,
        color: "#880000",
      });
    },
  );

  const instance = plugin.createInstance({}, context);
  instance.onFinalizedBar(candle(0, 20));
  const firstSnapshot = instance.snapshot();
  assert.equal(firstSnapshot.overlays.length, 2);
  assert.notEqual(firstSnapshot.overlays[0].id, firstSnapshot.overlays[1].id);
  const overlaysBeforeRejectedBar = instance.snapshot().overlays;

  assert.throws(
    () => instance.onFinalizedBar(candle(1, 21)),
    /Uncompiled drawing calls must run in the same order on every bar/u,
  );
  assert.deepEqual(instance.snapshot().overlays, overlaysBeforeRejectedBar);
  instance.dispose();
});

test("uncompiled same-kind drawing usage rejects one-to-two occurrence growth", () => {
  const plugin = defineIndicator(
    {
      id: "erc.indicator.uncompiled-drawing-growth.main",
      name: "Uncompiled drawing growth",
    },
    (bar) => {
      if (bar.index > 0) {
        plot.box({
          left: bar.openTimeMs,
          right: bar.openTimeMs + 60_000,
          top: bar.close + 10,
          bottom: bar.close + 9,
          color: "#008800",
        });
      }
      plot.box({
        left: bar.openTimeMs,
        right: bar.openTimeMs + 60_000,
        top: bar.close,
        bottom: bar.close - 1,
        color: "#880000",
      });
    },
  );

  const instance = plugin.createInstance({}, context);
  instance.onFinalizedBar(candle(0, 20));
  assert.equal(instance.snapshot().overlays.length, 1);
  const overlaysBeforeRejectedBar = instance.snapshot().overlays;

  assert.throws(
    () => instance.onFinalizedBar(candle(1, 21)),
    /Uncompiled drawing calls must run in the same order on every bar/u,
  );
  assert.deepEqual(instance.snapshot().overlays, overlaysBeforeRejectedBar);
  instance.dispose();
});
