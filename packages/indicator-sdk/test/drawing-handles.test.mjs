import assert from "node:assert/strict";
import test from "node:test";
import { plot } from "../dist/index.js";
import { defineIndicator } from "../dist/indicator.js";
import { cloneSeriesState } from "../dist/series.js";

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
  source: Object.freeze({
    file: "drawing-handles.test.mjs",
    line: 1,
    column: 1,
  }),
});

const rollbackBoxCallsite = Object.freeze({
  __ercCallsite: "v2",
  id: "erc-v2-drawing-000000000000000000000002",
  kind: "drawing",
  callee: "plot.box",
  source: Object.freeze({
    file: "drawing-handles.test.mjs",
    line: 2,
    column: 1,
  }),
});

const foreignBoxCallsite = Object.freeze({
  __ercCallsite: "v2",
  id: "erc-v2-drawing-000000000000000000000003",
  kind: "drawing",
  callee: "plot.box",
  source: Object.freeze({
    file: "drawing-handles.test.mjs",
    line: 3,
    column: 1,
  }),
});

const borderBoxCallsite = Object.freeze({
  __ercCallsite: "v2",
  id: "erc-v2-drawing-000000000000000000000004",
  kind: "drawing",
  callee: "plot.box",
  source: Object.freeze({
    file: "drawing-handles.test.mjs",
    line: 4,
    column: 1,
  }),
});

const evictionBoxCallsite = (index) =>
  Object.freeze({
    __ercCallsite: "v2",
    id: `erc-v2-drawing-${(index + 16).toString(16).padStart(24, "0")}`,
    kind: "drawing",
    callee: "plot.box",
    source: Object.freeze({
      file: "drawing-handles.test.mjs",
      line: 10 + index,
      column: 1,
    }),
  });

const evictionBoxCallsites = Array.from({ length: 2_001 }, (_, index) =>
  evictionBoxCallsite(index),
);

test("persistent state cloning preserves opaque drawing handle identity", () => {
  let handle;
  defineIndicator(
    { id: "erc.indicator.handle-state-clone.main", name: "Handle state clone" },
    (bar) => {
      handle = plot.box(
        {
          left: bar.openTimeMs,
          right: bar.openTimeMs + 60_000,
          top: bar.close,
          bottom: bar.close - 1,
          color: "#008800",
        },
        boxCallsite,
      );
    },
  );

  assert.ok(handle);
  const state = { handles: [handle] };
  const cloned = cloneSeriesState(state);
  assert.notStrictEqual(cloned, state);
  assert.notStrictEqual(cloned.handles, state.handles);
  assert.strictEqual(cloned.handles[0], handle);
});

test("compiled drawing creation allocates independent opaque handles at one callsite", () => {
  const handles = [];
  const plugin = defineIndicator(
    {
      id: "erc.indicator.handle-allocation.main",
      name: "Handle allocation",
    },
    (bar) => {
      if (!bar.isConfirmed) return;
      handles.push(
        plot.box(
          {
            left: bar.openTimeMs,
            right: bar.openTimeMs + 60_000,
            top: bar.close,
            bottom: bar.close - 1,
            color: "#008800",
          },
          boxCallsite,
        ),
      );
    },
  );
  handles.length = 0;

  const instance = plugin.createInstance({}, context);
  instance.onFinalizedBar(candle(0));
  instance.onFinalizedBar(candle(1));

  assert.equal(handles.length, 2);
  assert.notStrictEqual(handles[1], handles[0]);
  assert.equal(instance.snapshot().overlays.length, 2);
  assert.notEqual(
    instance.snapshot().overlays[1].id,
    instance.snapshot().overlays[0].id,
  );
  instance.dispose();
});

test("same-callsite insert, reorder, update and delete preserve unrelated handle identity", () => {
  const handles = [];
  const plugin = defineIndicator(
    {
      id: "erc.indicator.handle-reorder.main",
      name: "Handle reorder",
    },
    (bar) => {
      if (!bar.isConfirmed) return;
      if (bar.index === 0) {
        handles.push(
          plot.box(
            {
              left: bar.openTimeMs,
              right: bar.openTimeMs + 60_000,
              top: 30,
              bottom: 29,
              color: "#008800",
            },
            boxCallsite,
          ),
        );
        handles.push(
          plot.box(
            {
              left: bar.openTimeMs,
              right: bar.openTimeMs + 60_000,
              top: 40,
              bottom: 39,
              color: "#004488",
            },
            boxCallsite,
          ),
        );
        return;
      }
      if (bar.index === 1) {
        handles.unshift(
          plot.box(
            {
              left: bar.openTimeMs,
              right: bar.openTimeMs + 60_000,
              top: 20,
              bottom: 19,
              color: "#880000",
            },
            boxCallsite,
          ),
        );
        handles.push(handles.splice(1, 1)[0]);
        handles[1].set({ top: 41 });
        return;
      }
      if (bar.index === 2) handles[2].delete();
    },
  );
  handles.length = 0;

  const instance = plugin.createInstance({}, context);
  instance.onFinalizedBar(candle(0));
  const first = instance.snapshot().overlays;
  assert.equal(first.length, 2);
  const firstIds = new Map(first.map((overlay) => [overlay.top, overlay.id]));

  instance.onFinalizedBar(candle(1));
  const second = instance.snapshot().overlays;
  assert.equal(second.length, 3);
  assert.equal(
    second.find((overlay) => overlay.top === 30)?.id,
    firstIds.get(30),
  );
  assert.equal(
    second.find((overlay) => overlay.top === 41)?.id,
    firstIds.get(40),
  );
  const inserted = second.find((overlay) => overlay.top === 20);
  assert.ok(inserted);
  assert.equal([...firstIds.values()].includes(inserted.id), false);

  instance.onFinalizedBar(candle(2));
  const third = instance.snapshot().overlays;
  assert.equal(third.length, 2);
  assert.equal(
    third.find((overlay) => overlay.top === 41)?.id,
    firstIds.get(40),
  );
  assert.equal(third.find((overlay) => overlay.top === 20)?.id, inserted.id);
  instance.dispose();
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

test("box handles can explicitly clear a border color", () => {
  let box;
  const plugin = defineIndicator(
    { id: "erc.indicator.handle-border.main", name: "Handle border" },
    (bar) => {
      if (!bar.isConfirmed) return;
      if (bar.index === 0) {
        box = plot.box(
          {
            left: bar.openTimeMs,
            right: bar.openTimeMs + 60_000,
            top: bar.close,
            bottom: bar.close - 1,
            color: "#008800",
            borderColor: "#ffffff",
          },
          borderBoxCallsite,
        );
      }
      if (bar.index === 1) box.set({ borderColor: undefined });
    },
  );

  const instance = plugin.createInstance({}, context);
  instance.onFinalizedBar(candle(0, 20));
  assert.equal(instance.snapshot().overlays[0].borderColor, "#ffffff");

  instance.onFinalizedBar(candle(1, 21));
  const overlay = instance.snapshot().overlays[0];
  assert.equal(overlay.color, "#008800");
  assert.equal(overlay.borderColor, undefined);
  assert.equal(Object.hasOwn(overlay, "borderColor"), false);
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

test("building drawing creation reuses the finalized callsite sequence after rollback", () => {
  const plugin = defineIndicator(
    {
      id: "erc.indicator.handle-building-sequence.main",
      name: "Building sequence rollback",
    },
    (bar) => {
      if (bar.index > 1) return;
      plot.box(
        {
          left: bar.openTimeMs,
          right: bar.openTimeMs + 60_000,
          top: bar.close,
          bottom: bar.close - 1,
          color: "#008800",
        },
        rollbackBoxCallsite,
      );
    },
  );

  const instance = plugin.createInstance({}, context);
  instance.onFinalizedBar(candle(0, 20));
  const committedId = instance.snapshot().overlays[0]?.id;
  assert.equal(typeof committedId, "string");

  instance.onBuildingBar(candle(1, 21));
  const firstBuildingId = instance
    .snapshot()
    .overlays.find((overlay) => overlay.startTimeMs === 60_000)?.id;
  assert.equal(typeof firstBuildingId, "string");
  assert.notEqual(firstBuildingId, committedId);

  instance.onBuildingBar(candle(1, 22));
  assert.equal(
    instance
      .snapshot()
      .overlays.find((overlay) => overlay.startTimeMs === 60_000)?.id,
    firstBuildingId,
  );

  instance.onFinalizedBar(candle(1, 23));
  const finalized = instance
    .snapshot()
    .overlays.find((overlay) => overlay.startTimeMs === 60_000);
  assert.equal(finalized?.id, firstBuildingId);
  assert.equal(finalized?.top, 23);
  instance.dispose();
});

test("drawing handles cannot mutate another indicator instance", () => {
  let ownerHandle;
  const plugin = defineIndicator(
    { id: "erc.indicator.handle-owner.main", name: "Handle owner" },
    (bar) => {
      if (!bar.isConfirmed || bar.index !== 0) return;
      if (bar.instrumentId === "OWNER") {
        ownerHandle = plot.box(
          {
            left: bar.openTimeMs,
            right: bar.openTimeMs + 60_000,
            top: bar.close,
            bottom: bar.close - 1,
            color: "#008800",
          },
          foreignBoxCallsite,
        );
        return;
      }
      plot.box(
        {
          left: bar.openTimeMs,
          right: bar.openTimeMs + 60_000,
          top: bar.close,
          bottom: bar.close - 1,
          color: "#880000",
        },
        foreignBoxCallsite,
      );
      ownerHandle.set({ top: 999 });
    },
  );

  const ownerContext = { instrumentId: "OWNER", timeframeId: "1m" };
  const otherContext = { instrumentId: "OTHER", timeframeId: "1m" };
  const owner = plugin.createInstance({}, ownerContext);
  const other = plugin.createInstance({}, otherContext);
  owner.onFinalizedBar({ ...candle(0, 20), ...ownerContext });
  const ownerBefore = owner.snapshot().overlays[0];
  assert.throws(
    () => other.onFinalizedBar({ ...candle(0, 50), ...otherContext }),
    /Drawing handle is not active/u,
  );
  assert.deepEqual(owner.snapshot().overlays[0], ownerBefore);
  owner.dispose();
  other.dispose();
});

test("evicted drawing handles cannot delete a later same-callsite drawing", () => {
  let staleHandle;
  const plugin = defineIndicator(
    { id: "erc.indicator.handle-eviction.main", name: "Handle eviction" },
    (bar) => {
      if (!bar.isConfirmed) return;
      if (bar.index === 0) {
        for (let index = 0; index < 2_000; index += 1) {
          const handle = plot.box(
            {
              left: bar.openTimeMs,
              right: bar.openTimeMs + 60_000,
              top: bar.close + index,
              bottom: bar.close + index - 1,
              color: "#008800",
            },
            evictionBoxCallsites[index],
          );
          if (index === 0) staleHandle = handle;
        }
        return;
      }
      if (bar.index === 1) {
        plot.box(
          {
            left: bar.openTimeMs,
            right: bar.openTimeMs + 60_000,
            top: bar.close,
            bottom: bar.close - 1,
            color: "#008800",
          },
          evictionBoxCallsites[2_000],
        );
        return;
      }
      if (bar.index === 2) {
        plot.box(
          {
            left: bar.openTimeMs,
            right: bar.openTimeMs + 60_000,
            top: bar.close,
            bottom: bar.close - 1,
            color: "#008800",
          },
          evictionBoxCallsites[0],
        );
        return;
      }
      if (bar.index === 3) staleHandle.delete();
    },
  );

  const instance = plugin.createInstance({}, context);
  instance.onFinalizedBar(candle(0, 20));
  const staleId = instance
    .snapshot()
    .overlays.find((overlay) => overlay.top === 20)?.id;
  assert.equal(typeof staleId, "string");

  instance.onFinalizedBar(candle(1, 21));
  instance.onFinalizedBar(candle(2, 22));
  const replacementBefore = instance
    .snapshot()
    .overlays.find(
      (overlay) => overlay.startTimeMs === 120_000 && overlay.top === 22,
    );
  assert.ok(replacementBefore);
  assert.notEqual(replacementBefore.id, staleId);

  assert.doesNotThrow(() => instance.onFinalizedBar(candle(3, 23)));
  assert.deepEqual(
    instance
      .snapshot()
      .overlays.find((overlay) => overlay.id === replacementBefore.id),
    replacementBefore,
  );
  instance.dispose();
});

test("deleting an evicted live drawing removes its rendered overlay", () => {
  let oldestHandle;
  let newestHandle;
  const plugin = defineIndicator(
    {
      id: "erc.indicator.handle-evicted-delete.main",
      name: "Evicted handle deletion",
    },
    (bar) => {
      if (!bar.isConfirmed) return;
      if (bar.index === 0) {
        for (let index = 0; index < 2_000; index += 1) {
          const handle = plot.box(
            {
              left: bar.openTimeMs,
              right: bar.openTimeMs + 60_000,
              top: bar.close + index,
              bottom: bar.close + index - 1,
              color: "#008800",
            },
            evictionBoxCallsites[index],
          );
          if (index === 0) oldestHandle = handle;
          if (index === 1_999) newestHandle = handle;
        }
        newestHandle.delete();
        return;
      }
      if (bar.index === 1) {
        plot.box(
          {
            left: bar.openTimeMs,
            right: bar.openTimeMs + 60_000,
            top: 10_000,
            bottom: 9_999,
            color: "#008800",
          },
          evictionBoxCallsites[2_000],
        );
        return;
      }
      if (bar.index === 2) oldestHandle.delete();
    },
  );

  const instance = plugin.createInstance({}, context);
  instance.onFinalizedBar(candle(0, 20));
  const oldestId = instance
    .snapshot()
    .overlays.find((overlay) => overlay.top === 20)?.id;
  assert.equal(typeof oldestId, "string");
  assert.equal(instance.snapshot().overlays.length, 1_999);

  instance.onFinalizedBar(candle(1, 21));
  assert.equal(instance.snapshot().overlays.length, 2_000);
  assert.ok(
    instance.snapshot().overlays.some((overlay) => overlay.id === oldestId),
  );

  instance.onFinalizedBar(candle(2, 22));
  assert.equal(
    instance.snapshot().overlays.some((overlay) => overlay.id === oldestId),
    false,
  );
  assert.equal(instance.snapshot().overlays.length, 1_999);
  instance.dispose();
});

test("building-only drawing allocation does not evict committed handles", () => {
  let oldestHandle;
  let oldestId;
  const plugin = defineIndicator(
    {
      id: "erc.indicator.handle-building-eviction.main",
      name: "Building eviction rollback",
    },
    (bar) => {
      if (bar.isConfirmed && bar.index === 0) {
        for (let index = 0; index < 2_000; index += 1) {
          const handle = plot.box(
            {
              left: bar.openTimeMs,
              right: bar.openTimeMs + 60_000,
              top: bar.close + index,
              bottom: bar.close + index - 1,
              color: "#008800",
            },
            evictionBoxCallsites[index],
          );
          if (index === 0) oldestHandle = handle;
        }
        return;
      }
      if (!bar.isConfirmed && bar.index === 1) {
        plot.box(
          {
            left: bar.openTimeMs,
            right: bar.openTimeMs + 60_000,
            top: bar.close,
            bottom: bar.close - 1,
            color: "#880000",
          },
          evictionBoxCallsites[2_000],
        );
        return;
      }
      if (bar.isConfirmed && bar.index === 1) oldestHandle.set({ top: 777 });
    },
  );

  const instance = plugin.createInstance({}, context);
  instance.onFinalizedBar(candle(0, 20));
  assert.equal(instance.snapshot().overlays.length, 2_000);
  oldestId = instance.snapshot().overlays[0].id;

  instance.onBuildingBar(candle(1, 21));
  assert.equal(instance.snapshot().overlays.length, 2_000);

  instance.onFinalizedBar(candle(1, 21));
  const restored = instance
    .snapshot()
    .overlays.find((overlay) => overlay.id === oldestId);
  assert.equal(restored?.top, 777);
  instance.dispose();
});
