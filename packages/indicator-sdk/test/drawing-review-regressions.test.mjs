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

const boxCallsite = (index) =>
  Object.freeze({
    __ercCallsite: "v2",
    id: `erc-v2-drawing-${(index + 4_096).toString(16).padStart(24, "0")}`,
    kind: "drawing",
    callee: "plot.box",
    source: Object.freeze({
      file: "drawing-review-regressions.test.mjs",
      line: 10 + index,
      column: 1,
    }),
  });

const boxCallsites = Array.from({ length: 2_001 }, (_, index) =>
  boxCallsite(index),
);

const drawBox = (bar, index, color = "#008800") =>
  plot.box(
    {
      left: bar.openTimeMs,
      right: bar.openTimeMs + 60_000,
      top: bar.close + index,
      bottom: bar.close + index - 1,
      color,
    },
    boxCallsites[index],
  );

test(
  "caught drawing-change overflow leaves registry and change capacity intact",
  () => {
    let firstHandle;
    let lastHandle;
    const plugin = defineIndicator(
      {
        id: "erc.indicator.handle-capacity-atomic.main",
        name: "Handle capacity atomicity",
      },
      (bar) => {
        if (!bar.isConfirmed || bar.index !== 0) return;
        for (let index = 0; index < 2_000; index += 1) {
          const handle = drawBox(bar, index);
          if (index === 0) firstHandle = handle;
          if (index === 1_999) lastHandle = handle;
        }
        assert.throws(
          () => drawBox(bar, 2_000, "#880000"),
          /At most 2,000 drawing changes are allowed per bar/u,
        );
        assert.doesNotThrow(() => firstHandle.set({ bottom: -777 }));
        assert.doesNotThrow(() => lastHandle.set({ top: 777 }));
      },
    );

    const instance = plugin.createInstance({}, context);
    instance.onFinalizedBar(candle(0, 20));
    const overlays = instance.snapshot().overlays;
    assert.equal(overlays.length, 2_000);
    assert.equal(overlays.some((overlay) => overlay.bottom === -777), true);
    assert.equal(overlays.some((overlay) => overlay.top === 777), true);
    instance.dispose();
  },
);

test("invalid initial drawing does not evict a committed handle", () => {
  let oldestHandle;
  let oldestId;
  const plugin = defineIndicator(
    {
      id: "erc.indicator.handle-invalid-allocation.main",
      name: "Invalid drawing allocation",
    },
    (bar) => {
      if (!bar.isConfirmed) return;
      if (bar.index === 0) {
        for (let index = 0; index < 2_000; index += 1) {
          const handle = drawBox(bar, index);
          if (index === 0) oldestHandle = handle;
        }
        return;
      }
      if (bar.index === 1) {
        assert.throws(
          () =>
            plot.box(
              {
                left: bar.openTimeMs,
                right: bar.openTimeMs + 60_000,
                top: Number.NaN,
                bottom: bar.close - 1,
                color: "#880000",
              },
              boxCallsites[2_000],
            ),
          /Drawing top must be finite/u,
        );
        oldestHandle.set({ top: 777 });
      }
    },
  );

  const instance = plugin.createInstance({}, context);
  instance.onFinalizedBar(candle(0, 20));
  oldestId = instance.snapshot().overlays[0].id;

  instance.onFinalizedBar(candle(1, 21));
  const oldest = instance
    .snapshot()
    .overlays.find((overlay) => overlay.id === oldestId);
  assert.equal(oldest?.top, 777);
  assert.equal(instance.snapshot().overlays.length, 2_000);
  instance.dispose();
});

test(
  "uncompiled single drawing rejects switching conditional callsites",
  () => {
    const plugin = defineIndicator(
      {
        id: "erc.indicator.uncompiled-single-switch.main",
        name: "Uncompiled single-callsite switch",
      },
      (bar) => {
        if (bar.index === 0) {
          plot.box({
            left: bar.openTimeMs,
            right: bar.openTimeMs + 60_000,
            top: bar.close + 1,
            bottom: bar.close,
            color: "#008800",
          });
          return;
        }
        plot.box({
          left: bar.openTimeMs,
          right: bar.openTimeMs + 60_000,
          top: bar.close + 2,
          bottom: bar.close + 1,
          color: "#880000",
        });
      },
    );

    const instance = plugin.createInstance({}, context);
    instance.onFinalizedBar(candle(0, 20));
    assert.equal(instance.snapshot().overlays.length, 1);

    assert.throws(
      () => instance.onFinalizedBar(candle(1, 21)),
      /Uncompiled drawing calls must run in the same order on every bar/u,
    );
    instance.dispose();
  },
);
