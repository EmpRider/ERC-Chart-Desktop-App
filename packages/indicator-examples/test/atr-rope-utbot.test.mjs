import assert from "node:assert/strict";
import test from "node:test";

import { atrRopeUtBotIndicator } from "../dist/index.js";

const inputSelectors = Object.freeze({
  ropePeriod: ["ATR Rope", "ATR period"],
  ropeSensitivityMode: ["ATR Rope", "Sensitivity mode"],
  ropeDirectionMaType: ["ATR Rope Direction", "Direction MA"],
  ropeDirectionLookback: ["ATR Rope Direction", "Direction lookback"],
  ropeDirectionThreshold: ["ATR Rope Direction", "Direction threshold"],
  utbotAtrPeriod: ["UT Bot", "ATR period"],
  utbotMode: ["UT Bot", "Mode"],
  profilePeriod: ["ADX POC", "Profile period"],
  fastPocPeriod: ["ADX POC", "Fast POC period"],
  dmiLength: ["ADX POC", "ADX / DI length"],
  minEarlyBars: ["ADX POC", "Minimum early bars"],
  showTrailingStop: ["Display", "Show trailing stop"],
  adxPocSource: ["ADX POC", "Price source"],
  bodyWeight: ["ADX POC", "Body weight"],
});

function defaults(overrides = {}) {
  const parameters = Object.fromEntries(
    atrRopeUtBotIndicator.definition.inputs.map((input) => [
      input.key,
      input.defaultValue,
    ]),
  );
  for (const [name, value] of Object.entries(overrides)) {
    const selector = inputSelectors[name];
    const input =
      selector === undefined
        ? atrRopeUtBotIndicator.definition.inputs.find(
            (candidate) => candidate.key === name,
          )
        : atrRopeUtBotIndicator.definition.inputs.find(
            (candidate) =>
              candidate.group === selector[0] && candidate.label === selector[1],
          );
    assert.ok(input, `Missing input fixture ${name}`);
    parameters[input.key] = value;
  }
  return parameters;
}

function plotOutputKey(label) {
  const definition = atrRopeUtBotIndicator.definition.plots.find(
    (plot) => plot.label === label,
  );
  assert.ok(definition, `Missing plot fixture ${label}`);
  return definition.outputKey ?? definition.key;
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

function paginatedCandles(length) {
  return Array.from({ length }, (_, index) => ({
    instrumentId: "edge.instrument",
    timeframeId: "1m",
    openTimeMs: 1_800_000_000_000 + index * 60_000,
    open: 100 + (index % 7),
    high: 102 + (index % 7),
    low: 98 + (index % 7),
    close: 101 + (index % 7),
    volume: 1,
  }));
}

test("rebuilds across multiple paginated history pages without exhausting drawing updates", () => {
  const instance = atrRopeUtBotIndicator.createInstance(defaults(), {
    instrumentId: "edge.instrument",
    timeframeId: "1m",
  });
  try {
    const history = paginatedCandles(1_500);
    instance.onHistory(history);
    const snapshot = instance.snapshot();
    assert.equal(snapshot.points.length, history.length);
    assert.equal(snapshot.points[0].openTimeMs, history[0].openTimeMs);
    assert.equal(snapshot.points.at(-1).openTimeMs, history.at(-1).openTimeMs);
  } finally {
    instance.dispose();
  }
});

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
    const ropeKey = plotOutputKey("ATR Rope");
    const stopKey = plotOutputKey("UT Stop");

    const firstRope = snapshot.points.findIndex(
      (point) => point.values[ropeKey] !== null,
    );
    const firstStop = snapshot.points.findIndex(
      (point) => point.values[stopKey] !== null,
    );
    assert.ok(firstRope >= 0);
    assert.ok(firstStop >= 0);
    assert.ok(
      snapshot.points
        .slice(firstRope)
        .every((point) => Number.isFinite(point.values[ropeKey])),
    );
    assert.ok(
      snapshot.points
        .slice(firstStop)
        .every((point) => Number.isFinite(point.values[stopKey])),
    );

    const ropeColors = new Set(
      snapshot.points
        .slice(firstRope)
        .map((point) => point.colors?.[ropeKey])
        .filter(Boolean),
    );
    assert.ok(ropeColors.size >= 2);
  } finally {
    instance.dispose();
  }
});

test("keeps DMI/ADX semantics independent from the POC price source", () => {
  const context = { instrumentId: "edge.instrument", timeframeId: "1m" };
  const history = candles();
  const common = {
    dmiLength: 5,
    profilePeriod: 24,
    fastPocPeriod: 8,
    minEarlyBars: 5,
    bodyWeight: 0,
  };
  const closeSource = atrRopeUtBotIndicator.createInstance(
    defaults({ ...common, adxPocSource: "close" }),
    context,
  );
  const highSource = atrRopeUtBotIndicator.createInstance(
    defaults({ ...common, adxPocSource: "high" }),
    context,
  );
  try {
    closeSource.onHistory(history);
    highSource.onHistory(history);

    assert.deepEqual(highSource.snapshot(), closeSource.snapshot());
  } finally {
    closeSource.dispose();
    highSource.dispose();
  }
});

test("uses the configured POC price source for profile placement", () => {
  const context = { instrumentId: "edge.instrument", timeframeId: "1m" };
  const history = candles();
  const common = {
    dmiLength: 5,
    profilePeriod: 24,
    fastPocPeriod: 8,
    minEarlyBars: 5,
    bodyWeight: 0.7,
  };
  const closeSource = atrRopeUtBotIndicator.createInstance(
    defaults({ ...common, adxPocSource: "close" }),
    context,
  );
  const highSource = atrRopeUtBotIndicator.createInstance(
    defaults({ ...common, adxPocSource: "high" }),
    context,
  );
  try {
    closeSource.onHistory(history);
    highSource.onHistory(history);

    assert.notDeepEqual(
      highSource.snapshot().overlays,
      closeSource.snapshot().overlays,
    );
  } finally {
    closeSource.dispose();
    highSource.dispose();
  }
});

test("incremental building-bar updates match a fresh full-history calculation", () => {
  const parameters = defaults({
    ropePeriod: 5,
    ropeDirectionLookback: 4,
    ropeDirectionThreshold: 0.03,
    ropeDirectionMaType: "tema",
    utbotAtrPeriod: 4,
    utbotMode: "0lag",
    dmiLength: 5,
    profilePeriod: 24,
    fastPocPeriod: 8,
    minEarlyBars: 5,
  });
  const context = { instrumentId: "edge.instrument", timeframeId: "1m" };
  const history = candles();
  const incremental = atrRopeUtBotIndicator.createInstance(parameters, context);
  const reference = atrRopeUtBotIndicator.createInstance(parameters, context);
  try {
    const prior = history.slice(0, -1);
    const finalized = prior.at(-1);
    const building = history.at(-1);
    incremental.onHistory(prior);
    incremental.onFinalizedBar(finalized);
    incremental.onBuildingBar(building);
    reference.onHistory(history);

    assert.deepEqual(
      incremental.snapshot().points.at(-1),
      reference.snapshot().points.at(-1),
    );

    const replacement = {
      ...building,
      high: building.high + 0.07,
      low: building.low - 0.03,
      close: building.close + 0.05,
    };
    const pointsBefore = incremental.snapshot().points;
    const overlaysBefore = incremental.snapshot().overlays;
    // The worker projects only the tail; ordinary updates must not copy historical output.
    Object.defineProperty(pointsBefore, Symbol.iterator, {
      configurable: true,
      value() {
        throw new Error("building update iterated historical points");
      },
    });
    incremental.onBuildingBar(replacement);
    Reflect.deleteProperty(pointsBefore, Symbol.iterator);
    assert.strictEqual(incremental.snapshot().points, pointsBefore);
    assert.strictEqual(incremental.snapshot().overlays, overlaysBefore);
    reference.onHistory([...history.slice(0, -1), replacement]);

    assert.deepEqual(
      incremental.snapshot().points.at(-1),
      reference.snapshot().points.at(-1),
    );
    assert.deepEqual(
      incremental.snapshot().signals,
      reference.snapshot().signals,
    );
    assert.deepEqual(
      incremental.snapshot().overlays,
      reference.snapshot().overlays,
    );
  } finally {
    incremental.dispose();
    reference.dispose();
  }
});
