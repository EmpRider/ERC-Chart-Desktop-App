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

const callsite = (index) =>
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

const callsites = Array.from({ length: 2_001 }, (_, index) => callsite(index));

const drawBox = (bar, index, color = "#008800") =>
  plot.box(
    {
      left: bar.openTimeMs,
      right: bar.openTimeMs + 60_000,
      top: bar.close + index,
      bottom: bar.close + index - 1,
      color,
    },
    callsites[index],
  );

test("caught drawing overflow stays atomic", () => {
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
  assert.equal(
    overlays.some((overlay) => overlay.bottom === -777),
    true,
  );
  assert.equal(
    overlays.some((overlay) => overlay.top === 777),
    true,
  );
  instance.dispose();
});

test("invalid initial drawing keeps the oldest handle", () => {
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
              callsites[2_000],
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

test("invalid drawing values do not consume uncompiled identities", () => {
  const plugin = defineIndicator(
    {
      id: "erc.indicator.invalid-drawing-identity.main",
      name: "Invalid drawing identity",
    },
    (bar) => {
      if (!bar.isConfirmed) return;
      if (bar.index === 0) {
        assert.throws(
          () =>
            plot.box({
              left: bar.openTimeMs,
              right: bar.openTimeMs + 60_000,
              top: Number.NaN,
              bottom: bar.close,
              color: "#880000",
            }),
          /Drawing top must be finite/u,
        );
        assert.throws(
          () =>
            plot.segment({
              left: bar.openTimeMs,
              right: bar.openTimeMs + 60_000,
              startValue: bar.close,
              endValue: bar.close + 1,
              color: "#880000",
              width: 0,
              style: "solid",
            }),
          /Drawing width must be greater than 0 and at most 20/u,
        );
      }
      plot.box({
        left: bar.openTimeMs,
        right: bar.openTimeMs + 60_000,
        top: bar.close + 1,
        bottom: bar.close,
        color: "#008800",
      });
      plot.segment({
        left: bar.openTimeMs,
        right: bar.openTimeMs + 60_000,
        startValue: bar.close,
        endValue: bar.close + 1,
        color: "#008800",
        width: 1,
        style: "solid",
      });
    },
  );

  const instance = plugin.createInstance({}, context);
  instance.onFinalizedBar(candle(0, 20));
  const first = instance.snapshot().overlays;
  const boxId = first.find((overlay) => overlay.kind === "box")?.id;
  const segmentId = first.find((overlay) => overlay.kind === "line-segment")?.id;
  assert.equal(first.length, 2);

  assert.doesNotThrow(() => instance.onFinalizedBar(candle(1, 21)));
  const second = instance.snapshot().overlays;
  assert.equal(second.length, 2);
  assert.equal(second.find((overlay) => overlay.kind === "box")?.id, boxId);
  assert.equal(
    second.find((overlay) => overlay.kind === "line-segment")?.id,
    segmentId,
  );
  assert.equal(second.find((overlay) => overlay.kind === "box")?.top, 22);
  assert.equal(
    second.find((overlay) => overlay.kind === "line-segment")?.endValue,
    22,
  );
  instance.dispose();
});

test("uncompiled drawing callsite switches fail closed", () => {
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
});

test("recreated drawings refresh registry retention order", () => {
  let firstHandle;
  let recreatedHandle;
  const plugin = defineIndicator(
    {
      id: "erc.indicator.handle-recreate-retention.main",
      name: "Handle recreation retention",
    },
    (bar) => {
      if (!bar.isConfirmed) return;
      if (bar.index === 0) {
        for (let index = 0; index < 2_000; index += 1) {
          const handle = drawBox(bar, index);
          if (index === 0) firstHandle = handle;
        }
        return;
      }
      if (bar.index === 1) {
        firstHandle.delete();
        return;
      }
      if (bar.index === 2) {
        recreatedHandle = drawBox(bar, 0, "#004488");
        return;
      }
      if (bar.index === 3) {
        drawBox(bar, 2_000, "#880000");
        return;
      }
      if (bar.index === 4) recreatedHandle.set({ top: 777 });
    },
  );

  const instance = plugin.createInstance({}, context);
  instance.onFinalizedBar(candle(0, 20));
  const firstId = instance.snapshot().overlays[0].id;
  const secondId = instance.snapshot().overlays[1].id;

  instance.onFinalizedBar(candle(1, 21));
  assert.equal(
    instance.snapshot().overlays.some((overlay) => overlay.id === firstId),
    false,
  );

  instance.onFinalizedBar(candle(2, 22));
  assert.equal(
    instance.snapshot().overlays.some((overlay) => overlay.id === firstId),
    true,
  );

  instance.onFinalizedBar(candle(3, 23));
  assert.equal(instance.snapshot().overlays.length, 2_000);
  assert.equal(
    instance.snapshot().overlays.some((overlay) => overlay.id === firstId),
    true,
  );
  assert.equal(
    instance.snapshot().overlays.some((overlay) => overlay.id === secondId),
    false,
  );

  assert.doesNotThrow(() => instance.onFinalizedBar(candle(4, 24)));
  assert.equal(
    instance.snapshot().overlays.find((overlay) => overlay.id === firstId)?.top,
    777,
  );
  instance.dispose();
});
