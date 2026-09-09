import assert from "node:assert/strict";
import test from "node:test";
import {
  defineIndicator,
  history,
  indicatorContractVersion,
  indicatorSdkVersion,
  plot,
} from "../dist/index.js";

const context = { instrumentId: "TEST", timeframeId: "1m" };
const candle = (index, close) => ({
  ...context,
  openTimeMs: index * 60_000,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: index + 1,
});

test("pins the indicator authoring API to the indicator contract", () => {
  assert.equal(indicatorSdkVersion, indicatorContractVersion);
  assert.equal(indicatorSdkVersion, 1);
});

test("history uses identical finalized and provisional bars-back semantics", () => {
  const plugin = defineIndicator(
    { id: "erc.indicator.history.main", name: "History" },
    ({ close }) => {
      plot.line(history(close, 1), { key: "previous" });
      plot.line(history(close, 0), { key: "current" });
      plot.line(history(close * 2, 1), { key: "derived" });
    },
  );
  const instance = plugin.createInstance({}, context);
  instance.onHistory([candle(0, 10), candle(1, 11), candle(2, 12)]);

  assert.deepEqual(
    instance.snapshot().points.map((point) => point.values.previous),
    [null, 10, 11],
  );
  assert.deepEqual(
    instance.snapshot().points.map((point) => point.values.current),
    [10, 11, 12],
  );
  assert.deepEqual(
    instance.snapshot().points.map((point) => point.values.derived),
    [null, 20, 22],
  );

  instance.onBuildingBar(candle(2, 40));
  assert.equal(instance.snapshot().points.at(-1).values.previous, 11);
  assert.equal(instance.snapshot().points.at(-1).values.current, 40);
  assert.equal(instance.snapshot().points.at(-1).values.derived, 22);

  instance.onFinalizedBar(candle(2, 40));
  instance.onBuildingBar(candle(3, 50));
  assert.equal(instance.snapshot().points.at(-1).values.previous, 40);
  assert.equal(instance.snapshot().points.at(-1).values.current, 50);
  assert.equal(instance.snapshot().points.at(-1).values.derived, 80);
  instance.dispose();
});

test("history rejects negative and fractional offsets", () => {
  for (const barsBack of [-1, 1.5]) {
    assert.throws(
      () =>
        defineIndicator(
          { id: "erc.indicator.invalid-history.main", name: "Invalid" },
          ({ close }) => {
            plot.line(history(close, barsBack));
          },
        ),
      /History offset must be a non-negative safe integer/u,
    );
  }
});
