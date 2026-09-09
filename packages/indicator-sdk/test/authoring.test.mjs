import assert from "node:assert/strict";
import test from "node:test";
import {
  defineIndicator,
  input,
  plot,
  series,
  signal,
  ta,
} from "../dist/index.js";
import {
  isInstalledIndicatorDefinition,
  isIndicatorRuntimeSnapshot,
} from "@erc-chart/contracts";

const context = { instrumentId: "TEST", timeframeId: "1m" };
const candle = (index, close = 10 + index) => ({
  ...context,
  openTimeMs: index * 60_000,
  open: close - 1,
  high: close + 2,
  low: close - 2,
  close,
  volume: 1,
});
const history = Array.from({ length: 40 }, (_, index) =>
  candle(index, 20 + Math.sin(index) * 4),
);

function example() {
  return defineIndicator(
    { id: "erc.indicator.author-test.main", name: "Author test" },
    ({ close, low }) => {
      const length = input.int(3, { title: "Length", min: 1, max: 100 });
      const color = input.color("#00ff00", { title: "Color" });
      const average = ta.ema(close, length);
      const atr = ta.atr(length);
      const crossed = ta.crossover(close, average);
      plot.line(average, { title: "EMA", color, width: 2 });
      plot.line(atr, { title: "ATR" });
      plot.histogram(ta.rsi(length), { title: "RSI" });
      plot.shape(crossed ? low : null, { title: "Up", direction: "up" });
      plot.hline(50, { title: "Middle" });
      signal(crossed, "long");
    },
  );
}

test("scalar authoring generates valid definitions and dense results without output declarations", () => {
  const plugin = example();
  assert.equal(isInstalledIndicatorDefinition(plugin.definition), true);
  assert.equal(plugin.definition.indicatorContractVersion, 1);
  assert.equal(plugin.definition.hostCompatibility.minimumHostApiVersion, 1);
  assert.equal(plugin.definition.inputs.length, 2);
  assert.equal(plugin.definition.outputs.length, 5);
  assert.deepEqual(
    plugin.definition.plots.map((value) => value.kind),
    ["line", "line", "histogram", "shape", "hline"],
  );
  const instance = plugin.createInstance({}, context);
  instance.onHistory(history);
  assert.equal(isIndicatorRuntimeSnapshot(instance.snapshot()), true);
  const ema = ta.movingAverage(
    history.map((value) => value.close),
    "ema",
    3,
  );
  const atr = ta.atr(history, 3);
  const rsi = ta.rsi(
    history.map((value) => value.close),
    3,
  );
  assert.deepEqual(
    instance.snapshot().points.map((point) => point.values.plot_0),
    ema.map((value) => (Number.isFinite(value) ? value : null)),
  );
  assert.deepEqual(
    instance.snapshot().points.map((point) => point.values.plot_1),
    atr.map((value) => (Number.isFinite(value) ? value : null)),
  );
  assert.deepEqual(
    instance.snapshot().points.map((point) => point.values.plot_2),
    rsi.map((value) => (Number.isFinite(value) ? value : null)),
  );
  assert.equal(instance.snapshot().points.at(-1).colors.plot_0, "#00ff00");
  instance.dispose();
});

test("history replay marks the finalized tail before the building candle", () => {
  const seen = [];
  const plugin = defineIndicator(
    { id: "erc.indicator.history-flags.main", name: "History flags" },
    (bar) => {
      plot.line(bar.close);
      seen.push({
        index: bar.index,
        confirmed: bar.isConfirmed,
        history: bar.isHistory,
        finalizedTail: bar.isHistoryFinalizedTail,
      });
    },
  );
  seen.length = 0;
  const instance = plugin.createInstance({}, context);
  instance.onHistory([candle(0), candle(1), candle(2)]);
  assert.deepEqual(seen, [
    { index: 0, confirmed: true, history: true, finalizedTail: false },
    { index: 1, confirmed: true, history: true, finalizedTail: true },
    { index: 2, confirmed: false, history: true, finalizedTail: false },
  ]);
  instance.onBuildingBar(candle(2, 99));
  assert.deepEqual(seen.at(-1), {
    index: 2,
    confirmed: false,
    history: false,
    finalizedTail: false,
  });
  instance.onBuildingBar(candle(3, 100));
  assert.equal(
    seen.filter((value) => value.confirmed).length,
    3,
    "newer building candles auto-finalize the previous building candle",
  );
  assert.deepEqual(seen.slice(-2), [
    { index: 2, confirmed: true, history: false, finalizedTail: false },
    { index: 3, confirmed: false, history: false, finalizedTail: false },
  ]);
  assert.deepEqual(
    instance.snapshot().points.map((point) => point.openTimeMs),
    [0, 60_000, 120_000, 180_000],
  );
  instance.onFinalizedBar(candle(2, 99));
  assert.throws(
    () => instance.onFinalizedBar(candle(2, 98)),
    /history rebuild/u,
  );
  instance.dispose();
});

test("building replacements and finalization match a fresh history run and do not compound state", () => {
  const plugin = example();
  const instance = plugin.createInstance({}, context);
  const reference = plugin.createInstance({}, context);
  instance.onHistory(history);
  const originalPoints = instance.snapshot().points;
  for (const close of [27, 19, 28, 21]) {
    const replacement = candle(39, close);
    instance.onBuildingBar(replacement);
    reference.onHistory([...history.slice(0, -1), replacement]);
    assert.deepEqual(instance.snapshot().points, reference.snapshot().points);
    assert.deepEqual(instance.snapshot().signals, reference.snapshot().signals);
    assert.strictEqual(instance.snapshot().points, originalPoints);
  }
  const finalized = candle(39, 21);
  instance.onFinalizedBar(finalized);
  const afterFinalization = structuredClone(instance.snapshot());
  instance.onFinalizedBar(finalized);
  assert.deepEqual(
    instance.snapshot(),
    afterFinalization,
    "duplicate finalization commits exactly once",
  );
  instance.onBuildingBar(candle(40, 24));
  reference.onHistory([...history.slice(0, -1), finalized, candle(40, 24)]);
  assert.deepEqual(instance.snapshot().points, reference.snapshot().points);
  assert.deepEqual(instance.snapshot().signals, reference.snapshot().signals);
  instance.dispose();
  reference.dispose();
});

test("scalar recurrences roll back provisional state and remain isolated per instance", () => {
  const plugin = defineIndicator(
    { id: "erc.indicator.state.main", name: "State" },
    ({ close }) => {
      plot.line(series(0, (previous) => previous + close));
    },
  );
  const first = plugin.createInstance({}, context);
  const second = plugin.createInstance({}, context);
  first.onHistory([candle(0, 10), candle(1, 11)]);
  second.onHistory([candle(0, 20), candle(1, 21)]);
  first.onBuildingBar(candle(1, 12));
  first.onBuildingBar(candle(1, 13));
  assert.equal(first.snapshot().points.at(-1).values.plot_0, 23);
  assert.equal(second.snapshot().points.at(-1).values.plot_0, 41);
  first.onFinalizedBar(candle(1, 13));
  first.onBuildingBar(candle(2, 14));
  assert.equal(first.snapshot().points.at(-1).values.plot_0, 37);
  first.dispose();
  second.dispose();
});

test("structured series state is isolated from nested mutations and returned-value mutations", () => {
  const plugin = defineIndicator(
    { id: "erc.indicator.structured-state.main", name: "Structured state" },
    (bar) => {
      const state = series({ values: [] }, (previous) => {
        previous.values.push(bar.close);
        return previous;
      });
      plot.line(state.values.reduce((sum, value) => sum + value, 0));
      if (bar.isConfirmed) state.values.push(1_000);
    },
  );
  const instance = plugin.createInstance({}, context);
  instance.onHistory([candle(0, 10), candle(1, 11)]);
  assert.equal(instance.snapshot().points.at(-1).values.plot_0, 21);
  instance.onBuildingBar(candle(1, 20));
  assert.equal(instance.snapshot().points.at(-1).values.plot_0, 30);
  instance.dispose();
});

test("provisional drawings roll back and finalized drawings persist without author-owned arrays", () => {
  const plugin = defineIndicator(
    { id: "erc.indicator.draw.main", name: "Draw" },
    ({ close, openTimeMs }) => {
      plot.line(close, { color: close > 15 ? "#00ff00" : "#ff0000" });
      if (close > 15)
        plot.box({
          id: "zone",
          startTimeMs: openTimeMs,
          endTimeMs: openTimeMs + 60_000,
          top: close,
          bottom: close - 1,
          color: "#008800",
        });
    },
  );
  const instance = plugin.createInstance({}, context);
  instance.onHistory([candle(0, 10), candle(1, 12)]);
  instance.onBuildingBar(candle(1, 20));
  assert.equal(instance.snapshot().overlays.length, 1);
  instance.onBuildingBar(candle(1, 12));
  assert.equal(instance.snapshot().overlays.length, 0);
  instance.onFinalizedBar(candle(1, 20));
  instance.onBuildingBar(candle(2, 10));
  assert.equal(instance.snapshot().overlays[0].top, 20);
  const revision = instance.snapshot().visualRevision;
  instance.onBuildingBar(candle(2, 11));
  assert.equal(instance.snapshot().visualRevision, revision);
  instance.dispose();
});

test("plot.sync owns drawing diff, removal and provisional rollback", () => {
  const plugin = defineIndicator(
    { id: "erc.indicator.sync-draw.main", name: "Sync draw" },
    ({ close, openTimeMs }) => {
      plot.sync(
        close > 15
          ? [
              {
                id: "zone",
                kind: "box",
                startTimeMs: openTimeMs,
                endTimeMs: openTimeMs + 60_000,
                top: close,
                bottom: close - 1,
                color: "#008800",
              },
            ]
          : [],
      );
    },
  );
  const instance = plugin.createInstance({}, context);
  instance.onHistory([candle(0, 20), candle(1, 20)]);
  assert.equal(instance.snapshot().overlays.length, 1);
  assert.equal(instance.snapshot().overlays[0].top, 20);

  instance.onBuildingBar(candle(1, 10));
  assert.equal(instance.snapshot().overlays.length, 0);
  instance.onBuildingBar(candle(1, 22));
  assert.equal(instance.snapshot().overlays.length, 1);
  assert.equal(instance.snapshot().overlays[0].top, 22);

  instance.onFinalizedBar(candle(1, 22));
  instance.onBuildingBar(candle(2, 10));
  assert.equal(instance.snapshot().overlays.length, 0);
  instance.dispose();
});

test("plot.sync rejects drawing arrays above the drawing-scope limit", () => {
  const plugin = defineIndicator(
    { id: "erc.indicator.sync-limit.main", name: "Sync limit" },
    ({ openTimeMs }) => {
      plot.sync(
        Array.from({ length: 2_001 }, (_, index) => ({
          id: `zone-${index}`,
          kind: "box",
          startTimeMs: openTimeMs,
          endTimeMs: openTimeMs + 60_000,
          top: index + 1,
          bottom: index,
        })),
      );
    },
  );
  const instance = plugin.createInstance({}, context);
  assert.throws(
    () => instance.onHistory([candle(0), candle(1)]),
    /At most 2,000 drawings are allowed in one drawing scope/u,
  );
  instance.dispose();
});

test("plot discovery rejects duplicate output keys", () => {
  assert.throws(
    () =>
      defineIndicator(
        { id: "erc.indicator.duplicate-plot.main", name: "Duplicate plot" },
        () => {
          plot.line(1, { key: "shared" });
          plot.histogram(2, { key: "shared" });
        },
      ),
    /Plot keys must be unique/u,
  );
});

test("plot.drawings reconciles direct plot.box calls without author-owned drawing arrays", () => {
  const plugin = defineIndicator(
    { id: "erc.indicator.scoped-draw.main", name: "Scoped draw" },
    ({ close, openTimeMs }) => {
      plot.drawings("zones", () => {
        if (close <= 15) return;
        plot.box({
          id: "zone",
          startTimeMs: 0,
          endTimeMs: openTimeMs + 60_000,
          top: close,
          bottom: close - 1,
          color: "#008800",
        });
      });
    },
  );
  const instance = plugin.createInstance({}, context);
  instance.onHistory([candle(0, 20), candle(1, 20)]);
  assert.equal(instance.snapshot().overlays.length, 1);
  assert.equal(instance.snapshot().overlays[0].top, 20);

  instance.onBuildingBar(candle(1, 10));
  assert.equal(instance.snapshot().overlays.length, 0);
  instance.onBuildingBar(candle(1, 22));
  assert.equal(instance.snapshot().overlays.length, 1);
  assert.equal(instance.snapshot().overlays[0].top, 22);

  instance.onFinalizedBar(candle(1, 22));
  instance.onBuildingBar(candle(2, 10));
  assert.equal(instance.snapshot().overlays.length, 0);
  instance.dispose();
});

test("input changes initialize new kernels and generated colors use the supplied parameters", () => {
  const plugin = example();
  const instance = plugin.createInstance(
    { input_0: 7, input_1: "#ff0000" },
    context,
  );
  instance.onHistory(history);
  assert.equal(
    instance.snapshot().points.at(-1).values.plot_0,
    ta
      .movingAverage(
        history.map((candle) => candle.close),
        "ema",
        7,
      )
      .at(-1),
  );
  assert.equal(instance.snapshot().points.at(-1).colors.plot_0, "#ff0000");
  instance.dispose();

  const migrated = plugin.createInstance(
    { input_0: 0, input_1: 42, removed_old_key: "ignored" },
    context,
  );
  migrated.onHistory(history);
  assert.equal(
    migrated.snapshot().points.at(-1).values.plot_0,
    ta
      .movingAverage(
        history.map((candle) => candle.close),
        "ema",
        1,
      )
      .at(-1),
  );
  assert.equal(migrated.snapshot().points.at(-1).colors.plot_0, "#00ff00");
  migrated.dispose();
});

test("stale option, boolean and numeric parameters normalize to the current declaration", () => {
  const plugin = defineIndicator(
    { id: "erc.indicator.input-migration.main", name: "Input migration" },
    () => {
      const length = input.int(3, { key: "length", min: 1, max: 5 });
      const mode = input.string("close", {
        key: "mode",
        options: ["close", "open"],
      });
      const enabled = input.bool(true, { key: "enabled" });
      plot.line(length + (mode === "open" ? 10 : 0) + (enabled ? 100 : 0));
    },
  );
  const instance = plugin.createInstance(
    {
      length: 99,
      mode: "removed-mode",
      enabled: "legacy-true",
      oldSetting: 123,
    },
    context,
  );
  instance.onHistory([candle(0), candle(1)]);
  assert.equal(instance.snapshot().points.at(-1).values.plot_0, 105);
  instance.dispose();
});

test("conditional stateful declarations fail locally and history reload resets a failed instance", () => {
  const plugin = defineIndicator(
    { id: "erc.indicator.order.main", name: "Order" },
    ({ close }) => {
      if (close < 10) plot.line(ta.ema(3));
    },
  );
  const instance = plugin.createInstance({}, context);
  assert.throws(() => instance.onHistory([candle(0, 20)]), /same order/);
  assert.throws(() => instance.onBuildingBar(candle(0, 2)), /failed/);
  instance.onHistory([candle(0, 2)]);
  assert.equal(instance.snapshot().points.length, 1);
  instance.dispose();
  assert.throws(() => plot.line(1), /defineIndicator/);
  assert.throws(() => ta.ema(14), /defineIndicator/);
  assert.throws(
    () =>
      defineIndicator(
        { id: "erc.indicator.async.main", name: "Async" },
        async () => undefined,
      ),
    /synchronous/,
  );
});

test("ordinary updates execute once and never iterate the retained output history", () => {
  let evaluations = 0;
  const plugin = defineIndicator(
    { id: "erc.indicator.constant.main", name: "Constant" },
    ({ close }) => {
      evaluations += 1;
      plot.line(ta.sma(close, 14));
      plot.line(ta.highest(14));
      plot.line(ta.lowest(14));
    },
  );
  const instance = plugin.createInstance({}, context);
  instance.onHistory(
    Array.from({ length: 100_000 }, (_, index) => candle(index)),
  );
  const points = instance.snapshot().points;
  Object.defineProperty(points, Symbol.iterator, {
    value() {
      throw new Error("tick scanned output history");
    },
  });
  const before = evaluations;
  for (let index = 0; index < 100; index += 1)
    instance.onBuildingBar(candle(99_999, 100_010 + index));
  assert.equal(evaluations - before, 100);
  assert.strictEqual(instance.snapshot().points, points);
  assert.equal(points.length, 100_000);
  instance.dispose();
});
