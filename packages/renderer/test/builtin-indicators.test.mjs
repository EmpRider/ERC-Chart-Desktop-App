import assert from "node:assert/strict";
import test from "node:test";
import {
  builtInIndicatorDefinitions,
  builtInIndicatorPluginId,
  createBuiltInWorkspaceIndicator,
  ercAtrIndicatorTemplate,
  ercWmaIndicatorTemplate,
  reconcileBuiltInIndicators,
  registerApplicationBuiltInIndicators,
  toBuiltInKLineIndicatorSpecs,
  updateBuiltInIndicatorParameters,
} from "../dist/index.js";

test("exposes the Signal built-in indicator set without plugin indicators", () => {
  assert.deepEqual(
    builtInIndicatorDefinitions.map(({ id, name }) => [id, name]),
    [
      ["rsi", "RSI"],
      ["macd", "MACD"],
      ["bollinger", "Bollinger Bands"],
      ["moving-average", "Moving Average"],
      ["ma-crossover", "MA Crossover"],
      ["atr", "ATR"],
      ["adx", "ADX"],
      ["stochastic", "Stochastic"],
    ],
  );
});

test("creates persisted built-in instances with Signal defaults", () => {
  assert.deepEqual(createBuiltInWorkspaceIndicator("rsi", "rsi-1"), {
    instanceId: "rsi-1",
    pluginId: builtInIndicatorPluginId,
    definitionId: "rsi",
    enabled: true,
    parameters: { length: 14 },
    inputs: { source: { kind: "candles" } },
  });
  assert.deepEqual(
    createBuiltInWorkspaceIndicator("macd", "macd-1").parameters,
    { fast: 12, slow: 26, signal: 9 },
  );
  assert.deepEqual(
    createBuiltInWorkspaceIndicator("bollinger", "boll-1").parameters,
    { length: 20, multiplier: 2 },
  );
});

test("maps Signal built-ins onto native KLineCharts indicators", () => {
  const cases = [
    ["rsi", "RSI", "panel", [14]],
    ["macd", "MACD", "panel", [12, 26, 9]],
    ["bollinger", "BOLL", "overlay", [20, 2]],
    ["atr", "ERC_ATR", "panel", [14]],
    ["adx", "DMI", "panel", [14, 6]],
    ["stochastic", "KDJ", "panel", [14, 3, 3]],
  ];
  for (const [definitionId, name, placement, calcParams] of cases) {
    const [spec] = toBuiltInKLineIndicatorSpecs(
      createBuiltInWorkspaceIndicator(definitionId, `${definitionId}-1`),
    );
    assert.equal(spec.name, name);
    assert.equal(spec.placement, placement);
    assert.deepEqual(spec.calcParams, calcParams);
  }
});

test("keeps native MACD precision above KLineCharts' four-decimal default", () => {
  const [spec] = toBuiltInKLineIndicatorSpecs(
    createBuiltInWorkspaceIndicator("macd", "macd-precision"),
  );

  assert.equal(spec.precision, 8);
});

test("uses application built-ins only where KLineCharts core lacks the primitive", () => {
  const registered = [];
  const supported = ["MA", "EMA", "SMA", "BOLL", "MACD", "RSI", "DMI", "KDJ"];
  registerApplicationBuiltInIndicators({
    getSupportedIndicators: () => [
      ...supported,
      ...registered.map(({ name }) => name),
    ],
    registerIndicator: (indicator) => registered.push(indicator),
  });
  assert.deepEqual(
    registered.map(({ name }) => name),
    ["ERC_ATR", "ERC_WMA"],
  );
});

test("application ATR and WMA templates calculate deterministic native chart data", () => {
  const bars = [
    { open: 9, high: 10, low: 8, close: 9, timestamp: 1 },
    { open: 9, high: 12, low: 9, close: 11, timestamp: 2 },
    { open: 11, high: 13, low: 10, close: 12, timestamp: 3 },
  ];
  const atr = ercAtrIndicatorTemplate.calc(bars, {
    calcParams: [2],
  });
  assert.deepEqual(atr, [{}, { atr: 2.5 }, { atr: 2.75 }]);

  const wma = ercWmaIndicatorTemplate.calc(bars, {
    calcParams: [3],
  });
  assert.deepEqual(wma.slice(0, 2), [{}, {}]);
  assert.equal(wma[2].wma, (9 + 11 * 2 + 12 * 3) / 6);
});

test("composes moving averages and MA crossover from native KLineCharts primitives", () => {
  const movingAverage = updateBuiltInIndicatorParameters(
    createBuiltInWorkspaceIndicator("moving-average", "ma-1"),
    { length: "30", method: "ema" },
  );
  assert.ok(movingAverage);
  assert.deepEqual(toBuiltInKLineIndicatorSpecs(movingAverage), [
    {
      id: "ma-1",
      ownerInstanceId: "ma-1",
      name: "EMA",
      shortName: "Moving Average",
      placement: "overlay",
      calcParams: [30],
      visible: true,
    },
  ]);

  const weightedAverage = updateBuiltInIndicatorParameters(
    createBuiltInWorkspaceIndicator("moving-average", "wma-1"),
    { length: "21", method: "wma" },
  );
  assert.ok(weightedAverage);
  assert.equal(
    toBuiltInKLineIndicatorSpecs(weightedAverage)[0].name,
    "ERC_WMA",
  );

  const crossover = createBuiltInWorkspaceIndicator("ma-crossover", "cross-1");
  assert.deepEqual(
    toBuiltInKLineIndicatorSpecs(crossover).map((spec) => ({
      id: spec.id,
      name: spec.name,
      calcParams: spec.calcParams,
    })),
    [
      { id: "cross-1:fast", name: "EMA", calcParams: [10] },
      { id: "cross-1:slow", name: "MA", calcParams: [20] },
    ],
  );
});

test("normalizes edited built-in parameters before persistence", () => {
  const rsi = createBuiltInWorkspaceIndicator("rsi", "rsi-1");
  assert.deepEqual(updateBuiltInIndicatorParameters(rsi, { length: "999" }), {
    ...rsi,
    parameters: { length: 500 },
  });

  const movingAverage = createBuiltInWorkspaceIndicator(
    "moving-average",
    "ma-1",
  );
  assert.deepEqual(
    updateBuiltInIndicatorParameters(movingAverage, {
      length: "25",
      method: "unknown",
    })?.parameters,
    { length: 25, method: "sma" },
  );
});

function createFakeChart() {
  const indicators = new Map();
  const calls = [];
  return {
    calls,
    indicators,
    createIndicator(value, isStack) {
      calls.push(["create", value.id, value.name, isStack]);
      indicators.set(value.id, { ...value });
      return value.id;
    },
    getIndicators(filter = {}) {
      return [...indicators.values()].filter(
        (indicator) =>
          (filter.id === undefined || indicator.id === filter.id) &&
          (filter.name === undefined || indicator.name === filter.name) &&
          (filter.paneId === undefined || indicator.paneId === filter.paneId),
      );
    },
    overrideIndicator(value) {
      calls.push(["override", value.id, value.name]);
      const current = indicators.get(value.id);
      if (current === undefined) return false;
      indicators.set(value.id, { ...current, ...value });
      return true;
    },
    removeIndicator(filter = {}) {
      calls.push(["remove", filter.id]);
      let removed = false;
      for (const [id, indicator] of indicators) {
        if (
          (filter.id === undefined || indicator.id === filter.id) &&
          (filter.name === undefined || indicator.name === filter.name) &&
          (filter.paneId === undefined || indicator.paneId === filter.paneId)
        ) {
          indicators.delete(id);
          removed = true;
        }
      }
      return removed;
    },
  };
}

test("reconciles only persisted built-in instances with the KLineCharts runtime", () => {
  const chart = createFakeChart();
  const rsi = createBuiltInWorkspaceIndicator("rsi", "rsi-1");
  const pluginIndicator = {
    instanceId: "plugin-1",
    pluginId: "com.example.plugin",
    definitionId: "custom",
    enabled: true,
    parameters: {},
    inputs: { source: { kind: "candles" } },
  };
  const first = reconcileBuiltInIndicators(chart, [rsi, pluginIndicator]);

  assert.deepEqual(chart.calls, [["create", "rsi-1", "RSI", false]]);
  assert.deepEqual([...first.managedRuntimeIds], ["rsi-1"]);
  assert.equal(first.ownerByRuntimeId.get("rsi-1"), "rsi-1");

  chart.calls.length = 0;
  const disabled = { ...rsi, enabled: false };
  const second = reconcileBuiltInIndicators(
    chart,
    [disabled],
    first.managedRuntimeIds,
  );
  assert.deepEqual(chart.calls, [["override", "rsi-1", "RSI"]]);
  assert.equal(chart.indicators.get("rsi-1").visible, false);

  chart.calls.length = 0;
  reconcileBuiltInIndicators(chart, [], second.managedRuntimeIds);
  assert.deepEqual(chart.calls, [["remove", "rsi-1"]]);
  assert.equal(chart.indicators.size, 0);
});

test("passes MACD precision through to the native KLineCharts indicator", () => {
  const chart = createFakeChart();
  const macd = createBuiltInWorkspaceIndicator("macd", "macd-1");

  reconcileBuiltInIndicators(chart, [macd]);

  assert.equal(chart.indicators.get("macd-1").precision, 8);
});

test("recreates a native moving average when its KLineCharts primitive changes", () => {
  const chart = createFakeChart();
  const initial = createBuiltInWorkspaceIndicator("moving-average", "ma-1");
  const first = reconcileBuiltInIndicators(chart, [initial]);
  chart.calls.length = 0;
  const changed = updateBuiltInIndicatorParameters(initial, {
    length: "20",
    method: "ema",
  });
  assert.ok(changed);

  reconcileBuiltInIndicators(chart, [changed], first.managedRuntimeIds);
  assert.deepEqual(chart.calls, [
    ["remove", "ma-1"],
    ["create", "ma-1", "EMA", true],
  ]);
});
