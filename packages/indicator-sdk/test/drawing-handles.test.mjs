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

const boxCallsite = Object.freeze({
  __ercCallsite: "v2",
  id: "erc-v2-drawing-000000000000000000000001",
  kind: "drawing",
  callee: "plot.box",
  source: Object.freeze({ file: "drawing-handles.test.mjs", line: 1, column: 1 }),
});

const rollbackBoxCallsite = Object.freeze({
  __ercCallsite: "v2",
  id: "erc-v2-drawing-000000000000000000000002",
  kind: "drawing",
  callee: "plot.box",
  source: Object.freeze({ file: "drawing-handles.test.mjs", line: 2, column: 1 }),
});

test("finalized drawing handles persist until updated or deleted", () => {
  let box;
  const plugin = defineIndicator(
    { id: "erc.indicator.handle-lifecycle.main", name: "Handle lifecycle" },
    (bar) => {
      if (bar.isConfirmed && bar.index === 0) {
        box = plot.box(
          {
            left: bar.openTimeMs,
            right: bar.openTimeMs + 60_000,
            top: bar.close,
            bottom: bar.close - 1,
            color: "#008800",
          },
          boxCallsite,
        );
      }
      if (bar.isConfirmed && bar.index === 1) {
        box.set({
          right: bar.openTimeMs + 60_000,
          top: bar.close,
        });
      }
      if (bar.isConfirmed && bar.index === 2) box.delete();
    },
  );

  const instance = plugin.createInstance({}, context);
  instance.onHistory([candle(0, 20), candle(1, 21)]);
  assert.equal(instance.snapshot().overlays.length, 1);
  assert.equal(instance.snapshot().overlays[0].top, 20);
  const id = instance.snapshot().overlays[0].id;
  assert.equal(typeof id, "string");
  assert.ok(id.length > 0);

  instance.onFinalizedBar(candle(1, 21));
  assert.equal(instance.snapshot().overlays.length, 1);
  assert.equal(instance.snapshot().overlays[0].id, id);
  assert.equal(instance.snapshot().overlays[0].top, 21);
  assert.equal(instance.snapshot().overlays[0].endTimeMs, 120_000);

  instance.onBuildingBar(candle(2, 22));
  assert.equal(instance.snapshot().overlays.length, 1);
  assert.equal(instance.snapshot().overlays[0].id, id);
  assert.equal(instance.snapshot().overlays[0].top, 21);

  instance.onFinalizedBar(candle(2, 22));
  assert.equal(instance.snapshot().overlays.length, 0);
  instance.dispose();
});

test("building drawing mutations roll back to the committed handle state", () => {
  let box;
  const plugin = defineIndicator(
    { id: "erc.indicator.handle-rollback.main", name: "Handle rollback" },
    (bar) => {
      if (bar.isConfirmed && bar.index === 0) {
        box = plot.box(
          {
            left: bar.openTimeMs,
            right: bar.openTimeMs + 60_000,
            top: bar.close,
            bottom: bar.close - 1,
            color: "#008800",
          },
          rollbackBoxCallsite,
        );
      }
      if (!bar.isConfirmed && bar.index === 1 && bar.close > 25)
        box.set({ top: bar.close });
    },
  );

  const instance = plugin.createInstance({}, context);
  instance.onHistory([candle(0, 20), candle(1, 10)]);
  assert.equal(instance.snapshot().overlays[0].top, 20);
  const id = instance.snapshot().overlays[0].id;

  instance.onBuildingBar(candle(1, 30));
  assert.equal(instance.snapshot().overlays[0].id, id);
  assert.equal(instance.snapshot().overlays[0].top, 30);

  instance.onBuildingBar(candle(1, 10));
  assert.equal(instance.snapshot().overlays[0].id, id);
  assert.equal(instance.snapshot().overlays[0].top, 20);
  instance.dispose();
});
