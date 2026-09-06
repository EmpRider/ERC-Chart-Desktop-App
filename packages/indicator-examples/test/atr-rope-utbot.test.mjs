import assert from "node:assert/strict";
import test from "node:test";

import { atrRopeUtBotIndicator } from "../dist/index.js";

function defaults(overrides = {}) {
  return {
    ...Object.fromEntries(
      atrRopeUtBotIndicator.definition.inputs.map((input) => [
        input.key,
        input.defaultValue,
      ]),
    ),
    ...overrides,
  };
}

function candles() {
  const result = [];
  let previous = 0;
  for (let index = 0; index < 140; index += 1) {
    const trend =
      index < 45
        ? index * 0.12
        : index < 90
          ? (90 - index) * 0.16
          : (index - 90) * 0.18;
    const close = index === 0 ? 0 : trend + Math.sin(index / 3) * 0.2;
    const open = previous;
    result.push({
      instrumentId: "edge.instrument",
      timeframeId: "1m",
      openTimeMs: 1_820_000_000_000 + index * 60_000,
      open,
      high: Math.max(open, close) + 0.08,
      low: Math.min(open, close) - 0.08,
      close,
    });
    previous = close;
  }
  return result;
}

test("handles zero threshold, period-one zero lag and zero previous close without NaN output", () => {
  const instance = atrRopeUtBotIndicator.createInstance(
    defaults({
      ropePeriod: 1,
      ropeSensitivityMode: "momentum",
      ropeDirectionThreshold: 0,
      ropeDirectionLookback: 1,
      utbotAtrPeriod: 1,
      utbotMode: "0lag",
      profilePeriod: 20,
      fastPocPeriod: 5,
      dmiLength: 3,
      minEarlyBars: 3,
    }),
    { instrumentId: "edge.instrument", timeframeId: "1m" },
  );
  try {
    const history = candles();
    instance.onHistory(history);
    const snapshot = instance.snapshot();

    assert.equal(snapshot.points.length, history.length);
    for (const point of snapshot.points) {
      for (const value of Object.values(point.values)) {
        assert.ok(value === null || Number.isFinite(value));
      }
    }
    assert.ok((snapshot.signals ?? []).length > 0);
    assert.ok(
      (snapshot.signals ?? []).every(
        (signal) =>
          signal.finalized && signal.occurredAtMs <= history.at(-2).openTimeMs,
      ),
    );
  } finally {
    instance.dispose();
  }
});

test("never finalizes a signal on the currently building candle", () => {
  const instance = atrRopeUtBotIndicator.createInstance(
    defaults({
      ropePeriod: 2,
      ropeDirectionLookback: 1,
      ropeDirectionThreshold: 0,
      utbotAtrPeriod: 2,
    }),
    { instrumentId: "edge.instrument", timeframeId: "1m" },
  );
  try {
    const history = candles();
    instance.onHistory(history.slice(0, -1));
    const building = history.at(-1);
    instance.onBuildingBar(building);
    const snapshot = instance.snapshot();
    assert.ok(
      (snapshot.signals ?? []).every(
        (signal) => signal.occurredAtMs < building.openTimeMs,
      ),
    );
  } finally {
    instance.dispose();
  }
});

test("keeps rope and trailing-stop series continuous while their colors change", () => {
  const instance = atrRopeUtBotIndicator.createInstance(
    defaults({
      ropePeriod: 2,
      ropeDirectionLookback: 1,
      ropeDirectionThreshold: 0,
      utbotAtrPeriod: 2,
      showTrailingStop: true,
    }),
    { instrumentId: "edge.instrument", timeframeId: "1m" },
  );
  try {
    instance.onHistory(candles());
    const snapshot = instance.snapshot();

    const firstRope = snapshot.points.findIndex(
      (point) => point.values.rope !== null,
    );
    const firstStop = snapshot.points.findIndex(
      (point) => point.values.utStop !== null,
    );
    assert.ok(firstRope >= 0);
    assert.ok(firstStop >= 0);
    assert.ok(
      snapshot.points
        .slice(firstRope)
        .every((point) => Number.isFinite(point.values.rope)),
    );
    assert.ok(
      snapshot.points
        .slice(firstStop)
        .every((point) => Number.isFinite(point.values.utStop)),
    );

    const ropeColors = new Set(
      snapshot.points
        .slice(firstRope)
        .map((point) => point.colors?.rope)
        .filter(Boolean),
    );
    assert.ok(ropeColors.size >= 2);
  } finally {
    instance.dispose();
  }
});
