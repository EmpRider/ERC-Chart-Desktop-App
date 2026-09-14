import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPluginIndicatorSeriesChange,
  markPluginIndicatorSeriesChange,
  pluginIndicatorDependencyVersion,
  pluginIndicatorSettingsFields,
  reconcilePluginIndicators,
  resolvePluginIndicatorSourcePlan,
} from "../dist/plugin-indicators.js";

const timeframeDefinition = {
  id: "erc.indicator.test.timeframe",
  name: "Timeframe test",
  placement: "overlay",
  inputs: [
    {
      key: "input_timeframe",
      label: "Timeframe",
      type: "string",
      defaultValue: "chart",
      editor: "timeframe",
    },
  ],
  outputs: [{ key: "line", label: "Line" }],
  plots: [{ key: "line", kind: "line", outputKey: "line" }],
  requiresLiveTicks: false,
  source: {
    timeframe: {
      requestedTimeframeId: "chart",
      inputKey: "input_timeframe",
    },
    taTimeframeIds: ["1h"],
  },
};

test("timeframe settings use active provider options without storing them in plugin metadata", () => {
  const fields = pluginIndicatorSettingsFields(
    timeframeDefinition,
    ["1m", "3m", "5m", "1h"],
    "1m",
    { input_timeframe: "3m" },
  );

  assert.deepEqual(fields[0].options, [
    { value: "chart", label: "Chart (1m)" },
    { value: "1m", label: "1m" },
    { value: "3m", label: "3m" },
    { value: "5m", label: "5m" },
    { value: "1h", label: "1h" },
  ]);
  assert.equal(timeframeDefinition.inputs[0].options, undefined);
});

test("unavailable saved timeframe keeps its preference while source resolution falls back to chart", () => {
  const indicator = {
    instanceId: "timeframe-instance",
    pluginId: "erc.indicator.test",
    definitionId: timeframeDefinition.id,
    enabled: true,
    parameters: { input_timeframe: "3m" },
    inputs: { source: { kind: "candles" } },
  };

  assert.deepEqual(
    resolvePluginIndicatorSourcePlan(indicator, timeframeDefinition, "1m", [
      "1m",
      "5m",
      "1h",
    ]),
    {
      requestedTimeframeId: "3m",
      activeTimeframeId: "1m",
      usedFallback: true,
      candleType: "standard",
      taTimeframeIds: ["1h"],
      taSources: [
        {
          requestedTimeframeId: "1h",
          activeTimeframeId: "1h",
          usedFallback: false,
        },
      ],
    },
  );
  assert.equal(indicator.parameters.input_timeframe, "3m");

  const fields = pluginIndicatorSettingsFields(
    timeframeDefinition,
    ["1m", "5m", "1h"],
    "1m",
    indicator.parameters,
  );
  assert.deepEqual(fields[0].options.at(-1), {
    value: "3m",
    label: "3m (Unavailable)",
  });
});

test("candle type source planning resolves the selected authored input", () => {
  const definition = {
    ...timeframeDefinition,
    inputs: [
      ...timeframeDefinition.inputs,
      {
        key: "input_candle",
        label: "Candle Type",
        type: "string",
        defaultValue: "standard",
        editor: "candle-type",
        options: [
          { value: "standard", label: "Standard" },
          { value: "heikin-ashi", label: "Heikin Ashi" },
        ],
      },
    ],
    source: {
      ...timeframeDefinition.source,
      candleType: {
        requestedCandleType: "standard",
        inputKey: "input_candle",
      },
    },
  };
  const indicator = {
    instanceId: "candle-instance",
    pluginId: "erc.indicator.test",
    definitionId: definition.id,
    enabled: true,
    parameters: { input_timeframe: "chart", input_candle: "heikin-ashi" },
    inputs: { source: { kind: "candles" } },
  };

  const plan = resolvePluginIndicatorSourcePlan(indicator, definition, "1m", [
    "1m",
    "1h",
  ]);
  assert.equal(plan.candleType, "heikin-ashi");
});

test("unavailable per-TA timeframe preserves its logical ID while resolving to chart data", () => {
  const definition = {
    ...timeframeDefinition,
    source: {
      ...timeframeDefinition.source,
      taTimeframeIds: ["4h"],
    },
  };
  const indicator = {
    instanceId: "ta-fallback-instance",
    pluginId: "erc.indicator.test",
    definitionId: definition.id,
    enabled: true,
    parameters: { input_timeframe: "chart" },
    inputs: { source: { kind: "candles" } },
  };

  const plan = resolvePluginIndicatorSourcePlan(indicator, definition, "1m", [
    "1m",
    "5m",
  ]);
  assert.deepEqual(plan.taSources, [
    {
      requestedTimeframeId: "4h",
      activeTimeframeId: "1m",
      usedFallback: true,
    },
  ]);
  assert.deepEqual(plan.taTimeframeIds, ["1m"]);
});

test("reconciliation sends the resolved indicator timeframe and per-TA sources to the runtime", async () => {
  let template;
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators() {
      return [];
    },
    createIndicator() {
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator() {
      return true;
    },
  };
  const summary = {
    pluginId: "erc.indicator.timeframe-test",
    pluginName: "Timeframe test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.timeframe-test/1.0.0/dist/index.js",
    definition: timeframeDefinition,
  };
  const indicator = {
    instanceId: "timeframe-runtime-instance",
    pluginId: summary.pluginId,
    definitionId: timeframeDefinition.id,
    enabled: true,
    parameters: { input_timeframe: "5m" },
    inputs: { source: { kind: "candles" } },
  };
  const requests = [];
  const reconciliation = reconcilePluginIndicators(
    module,
    chart,
    [indicator],
    [summary],
    async (request) => {
      requests.push(request);
      return {
        kind: "snapshot",
        snapshot: {
          points: request.data.candles.map((item) => ({
            openTimeMs: item.openTimeMs,
            values: { line: item.close },
          })),
          overlays: [],
          signals: [],
        },
      };
    },
    "TEST",
    "1m",
    new Set(),
    "profile-a",
    ["1m", "5m", "1h"],
  );
  const [runtimeId] = reconciliation.managedRuntimeIds;

  await template.calc(
    [{ timestamp: 60_000, open: 10, high: 12, low: 9, close: 11 }],
    { id: runtimeId },
  );

  assert.equal(requests[0].timeframeId, "5m");
  assert.equal(requests[0].candleType, "standard");
  assert.deepEqual(requests[0].sourceTimeframeIds, ["1h"]);
  assert.equal(requests[0].parameters.input_timeframe, "5m");
  assert.equal(requests[0].data.candles[0].timeframeId, "1m");
});

test("whole-indicator timeframe snapshots align only completed source bars onto chart bars", async () => {
  let template;
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators() {
      return [];
    },
    createIndicator() {
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator() {
      return true;
    },
  };
  const definition = {
    ...timeframeDefinition,
    id: "erc.indicator.test.whole-timeframe",
    inputs: [],
    source: {
      timeframe: { requestedTimeframeId: "1h" },
      taTimeframeIds: [],
    },
  };
  const summary = {
    pluginId: "erc.indicator.whole-timeframe-test",
    pluginName: "Whole timeframe test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.whole-timeframe-test/1.0.0/dist/index.js",
    definition,
  };
  const indicator = {
    instanceId: "whole-timeframe-instance",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: { source: { kind: "candles" } },
  };
  const reconciliation = reconcilePluginIndicators(
    module,
    chart,
    [indicator],
    [summary],
    async () => ({
      kind: "snapshot",
      snapshot: {
        points: [
          { openTimeMs: 0, values: { line: 100 } },
          { openTimeMs: 60 * 60_000, values: { line: 200 } },
        ],
        overlays: [],
        signals: [],
      },
    }),
    "TEST",
    "15m",
    new Set(),
    "profile-a",
    ["15m", "1h"],
  );
  const [runtimeId] = reconciliation.managedRuntimeIds;
  const chartBars = Array.from({ length: 9 }, (_, index) => ({
    timestamp: index * 15 * 60_000,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
  }));

  const rows = await template.calc(chartBars, { id: runtimeId });
  assert.deepEqual(
    rows.map((row) => row.line),
    [undefined, undefined, undefined, 100, 100, 100, 100, 200, 200],
  );
});

test("passes runtime point colors into KLineChart figure styles", async () => {
  let template;
  let runtimeId;
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators() {
      return [];
    },
    createIndicator(value) {
      runtimeId = value.id;
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator() {
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.dynamic-color",
    name: "Dynamic color",
    placement: "overlay",
    inputs: [],
    outputs: [{ key: "line", label: "Line" }],
    plots: [
      {
        key: "line",
        kind: "line",
        outputKey: "line",
        color: "#111111",
        width: 2,
      },
    ],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.test",
    pluginName: "Test",
    version: "1.0.0",
    definition,
  };
  const indicator = {
    instanceId: "dynamic-color-instance",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: { source: { kind: "candles" } },
  };
  const candle = {
    timestamp: 1_900_000_000_000,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
  };

  reconcilePluginIndicators(
    module,
    chart,
    [indicator],
    [summary],
    async () => ({
      kind: "snapshot",
      snapshot: {
        points: [
          {
            openTimeMs: candle.timestamp,
            values: { line: 11 },
            colors: { line: "#abcdef" },
            sizes: { line: 4 },
          },
        ],
        overlays: [],
        signals: [],
      },
    }),
    "TEST",
    "1m",
  );

  assert.ok(template);
  assert.ok(runtimeId);
  const [row] = await template.calc([candle], { id: runtimeId });
  assert.equal(row.line, 11);
  const styles = template.figures[0].styles({
    data: { prev: null, current: row, next: null },
  });
  assert.equal(styles.color, "#abcdef");
  assert.equal(styles.size, 4);
  assert.equal(styles.lineCap, "round");
  assert.equal(styles.lineJoin, "round");
});

test("shares one KLineChart template across instances and releases removed contexts", async () => {
  const templates = [];
  const module = {
    registerIndicator(value) {
      templates.push(value);
    },
  };
  const activeIds = new Set();
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: templates[0]?.name }] : [];
    },
    createIndicator(value) {
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.shared-template",
    name: "Shared template",
    placement: "overlay",
    inputs: [],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.shared-template-test",
    pluginName: "Shared template test",
    version: "1.0.0",
    definition,
  };
  const makeIndicator = (instanceId) => ({
    instanceId,
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: { source: { kind: "candles" } },
  });
  const first = makeIndicator("shared-template-first");
  const second = makeIndicator("shared-template-second");
  const candle = {
    timestamp: 1_900_000_000_000,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
  };
  const sync = async ({ instanceId }) => ({
    kind: "snapshot",
    snapshot: {
      points: [
        {
          openTimeMs: candle.timestamp,
          values: { line: instanceId.endsWith(`:${first.instanceId}`) ? 1 : 2 },
        },
      ],
      overlays: [],
      signals: [],
    },
  });

  const initial = reconcilePluginIndicators(
    module,
    chart,
    [first, second],
    [summary],
    sync,
    "TEST",
    "1m",
  );

  assert.equal(templates.length, 1);
  const template = templates[0];
  const firstRuntimeId = [...activeIds].find((id) =>
    id.endsWith(`:${first.instanceId}`),
  );
  const secondRuntimeId = [...activeIds].find((id) =>
    id.endsWith(`:${second.instanceId}`),
  );
  assert.ok(firstRuntimeId);
  assert.ok(secondRuntimeId);
  const [firstRow] = await template.calc([candle], { id: firstRuntimeId });
  const [secondRow] = await template.calc([candle], { id: secondRuntimeId });
  assert.equal(firstRow.line, 1);
  assert.equal(secondRow.line, 2);

  const afterRemoval = reconcilePluginIndicators(
    module,
    chart,
    [second],
    [summary],
    sync,
    "TEST",
    "1m",
    initial.managedRuntimeIds,
  );
  assert.deepEqual(afterRemoval.removedInstanceIds, [firstRuntimeId]);
  assert.equal(templates.length, 1);
  const [releasedRow] = await template.calc([candle], { id: firstRuntimeId });
  assert.deepEqual(releasedRow, {});
});

test("reconciles explicit cross-indicator bindings in dependency order", () => {
  let template;
  const createdIds = [];
  const activeIds = new Set();
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: template?.name }] : [];
    },
    createIndicator(value) {
      createdIds.push(value.id);
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.dependency-order",
    name: "Dependency order",
    placement: "overlay",
    inputs: [
      {
        key: "source",
        label: "Source",
        type: "source",
        defaultValue: "close",
      },
    ],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.dependency-order-test",
    pluginName: "Dependency order test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.dependency-order-test/1.0.0/dist/index.js",
    definition,
  };
  const indicator = (instanceId, inputs) => ({
    instanceId,
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs,
  });
  const base = indicator("dag-base", { source: { kind: "candles" } });
  const middle = indicator("dag-middle", {
    source: {
      kind: "indicator-output",
      instanceId: base.instanceId,
      outputKey: "line",
    },
  });
  const leaf = indicator("dag-leaf", {
    source: {
      kind: "indicator-output",
      instanceId: middle.instanceId,
      outputKey: "line",
    },
  });

  reconcilePluginIndicators(
    module,
    chart,
    [leaf, middle, base],
    [summary],
    async () => ({
      kind: "snapshot",
      snapshot: { points: [], overlays: [], signals: [] },
    }),
    "TEST",
    "1m",
  );

  assert.deepEqual(
    createdIds.map((id) => id.slice(id.lastIndexOf(":") + 1)),
    ["dag-base", "dag-middle", "dag-leaf"],
  );
});

test("rejects indicator-output bindings to undeclared consumer inputs before activation", () => {
  let createCalls = 0;
  const module = {
    registerIndicator(value) {
      assert.ok(value);
    },
  };
  const chart = {
    getIndicators() {
      return [];
    },
    createIndicator() {
      createCalls += 1;
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator() {
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.dependency-unknown-input",
    name: "Dependency unknown input",
    placement: "overlay",
    inputs: [],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.dependency-unknown-input-test",
    pluginName: "Dependency unknown input test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.dependency-unknown-input-test/1.0.0/dist/index.js",
    definition,
  };
  const base = {
    instanceId: "dependency-unknown-input-base",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: { source: { kind: "candles" } },
  };
  const consumer = {
    instanceId: "dependency-unknown-input-consumer",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: {
      source: {
        kind: "indicator-output",
        instanceId: base.instanceId,
        outputKey: "line",
      },
    },
  };

  assert.throws(
    () =>
      reconcilePluginIndicators(
        module,
        chart,
        [consumer, base],
        [summary],
        async () => ({
          kind: "snapshot",
          snapshot: { points: [], overlays: [], signals: [] },
        }),
        "TEST",
        "1m",
      ),
    (error) => error?.code === "INDICATOR_DEPENDENCY_MISSING_INPUT",
  );
  assert.equal(createCalls, 0);
});

test("rejects indicator-output bindings to non-source consumer inputs before activation", () => {
  let createCalls = 0;
  const module = {
    registerIndicator(value) {
      assert.ok(value);
    },
  };
  const chart = {
    getIndicators() {
      return [];
    },
    createIndicator() {
      createCalls += 1;
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator() {
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.dependency-incompatible-input",
    name: "Dependency incompatible input",
    placement: "overlay",
    inputs: [
      {
        key: "source",
        label: "Source",
        type: "number",
        defaultValue: 14,
      },
    ],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.dependency-incompatible-input-test",
    pluginName: "Dependency incompatible input test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.dependency-incompatible-input-test/1.0.0/dist/index.js",
    definition,
  };
  const base = {
    instanceId: "dependency-incompatible-input-base",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: { source: 14 },
    inputs: { source: { kind: "candles" } },
  };
  const consumer = {
    instanceId: "dependency-incompatible-input-consumer",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: { source: 14 },
    inputs: {
      source: {
        kind: "indicator-output",
        instanceId: base.instanceId,
        outputKey: "line",
      },
    },
  };

  assert.throws(
    () =>
      reconcilePluginIndicators(
        module,
        chart,
        [consumer, base],
        [summary],
        async () => ({
          kind: "snapshot",
          snapshot: { points: [], overlays: [], signals: [] },
        }),
        "TEST",
        "1m",
      ),
    (error) => error?.code === "INDICATOR_DEPENDENCY_INCOMPATIBLE_INPUT",
  );
  assert.equal(createCalls, 0);
});

test("changing an explicit output binding advances the dependent configuration generation", async () => {
  let template;
  const activeIds = new Set();
  const requests = [];
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: template?.name }] : [];
    },
    createIndicator(value) {
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.dependency-generation",
    name: "Dependency generation",
    placement: "overlay",
    inputs: [
      {
        key: "source",
        label: "Source",
        type: "source",
        defaultValue: "close",
      },
    ],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.dependency-generation-test",
    pluginName: "Dependency generation test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.dependency-generation-test/1.0.0/dist/index.js",
    definition,
  };
  const source = (instanceId) => ({
    instanceId,
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: { source: { kind: "candles" } },
  });
  const sourceA = source("binding-source-a");
  const sourceB = source("binding-source-b");
  const consumer = (sourceInstanceId) => ({
    instanceId: "binding-consumer",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: {
      source: {
        kind: "indicator-output",
        instanceId: sourceInstanceId,
        outputKey: "line",
      },
    },
  });
  const sync = async (request) => {
    requests.push(request);
    const candles = request.data.candles ?? [request.data.candle];
    return {
      kind: "snapshot",
      snapshot: {
        points: candles.filter(Boolean).map((item) => ({
          openTimeMs: item.openTimeMs,
          values: { line: item.close },
        })),
        overlays: [],
        signals: [],
      },
    };
  };
  const candle = {
    timestamp: 1_900_000_000_000,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
  };

  const first = reconcilePluginIndicators(
    module,
    chart,
    [sourceA, sourceB, consumer(sourceA.instanceId)],
    [summary],
    sync,
    "TEST",
    "1m",
  );
  const consumerRuntimeId = [...first.managedRuntimeIds].find((id) =>
    id.endsWith(":binding-consumer"),
  );
  assert.ok(consumerRuntimeId);
  await template.calc([candle], { id: consumerRuntimeId });

  reconcilePluginIndicators(
    module,
    chart,
    [sourceA, sourceB, consumer(sourceB.instanceId)],
    [summary],
    sync,
    "TEST",
    "1m",
    first.managedRuntimeIds,
  );
  await template.calc([candle], { id: consumerRuntimeId });

  assert.deepEqual(
    requests
      .filter(({ instanceId }) => instanceId === consumerRuntimeId)
      .map(({ configGeneration }) => configGeneration),
    [1, 2],
  );
});

test("dependency freshness changes when an upstream result changes without a source revision change", () => {
  const dependency = {
    inputKey: "source",
    instanceId: "upstream",
    outputKey: "line",
    sourceGeneration: 2,
    sourceRevision: 7,
    configGeneration: 4,
    outputRevision: 1,
    points: [{ openTimeMs: 0, values: { line: 42 } }],
  };

  assert.notEqual(
    pluginIndicatorDependencyVersion([dependency]),
    pluginIndicatorDependencyVersion([
      { ...dependency, outputRevision: dependency.outputRevision + 1 },
    ]),
  );
});

test("multiple bindings to one upstream share one serialized dependency history", async () => {
  let template;
  const activeIds = new Set();
  const requests = [];
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: template?.name }] : [];
    },
    createIndicator(value) {
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const sourceInputs = Array.from({ length: 5 }, (_, index) => ({
    key: `source_${index}`,
    label: `Source ${index}`,
    type: "source",
    defaultValue: "close",
  }));
  const definition = {
    id: "erc.indicator.test.shared-dependency-history",
    name: "Shared dependency history",
    placement: "overlay",
    inputs: sourceInputs,
    outputs: [
      { key: "line", label: "Line" },
      { key: "signal", label: "Signal" },
    ],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.shared-dependency-history-test",
    pluginName: "Shared dependency history test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.shared-dependency-history-test/1.0.0/dist/index.js",
    definition,
  };
  const candleInputs = Object.fromEntries(
    sourceInputs.map(({ key }) => [key, { kind: "candles" }]),
  );
  const base = {
    instanceId: "shared-history-base",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: candleInputs,
  };
  const consumer = {
    instanceId: "shared-history-consumer",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: Object.fromEntries(
      sourceInputs.map(({ key }, index) => [
        key,
        {
          kind: "indicator-output",
          instanceId: base.instanceId,
          outputKey: index % 2 === 0 ? "line" : "signal",
        },
      ]),
    ),
  };
  const sync = async (request) => {
    requests.push(request);
    const candles = request.data.candles ?? [request.data.candle];
    return {
      kind: "snapshot",
      snapshot: {
        points: candles.filter(Boolean).map((item) => ({
          openTimeMs: item.openTimeMs,
          values: { line: item.close * 2, signal: item.close * 3 },
        })),
        overlays: [],
        signals: [],
      },
    };
  };
  const reconciliation = reconcilePluginIndicators(
    module,
    chart,
    [consumer, base],
    [summary],
    sync,
    "TEST",
    "1m",
  );
  const consumerRuntimeId = [...reconciliation.managedRuntimeIds].find((id) =>
    id.endsWith(`:${consumer.instanceId}`),
  );
  assert.ok(consumerRuntimeId);
  await template.calc(
    [
      {
        timestamp: 1_900_000_000_000,
        open: 10,
        high: 12,
        low: 9,
        close: 11,
      },
    ],
    { id: consumerRuntimeId },
  );

  const consumerRequest = requests.find(
    ({ instanceId }) => instanceId === consumerRuntimeId,
  );
  assert.equal(consumerRequest?.dependencies?.length, 5);
  assert.equal(
    new Set(consumerRequest.dependencies.map(({ points }) => points)).size,
    1,
  );
  assert.deepEqual(consumerRequest.dependencies[0].points[0].values, {
    line: 22,
    signal: 33,
  });
});

test("dependent calculation publishes upstream output first and consumes the matching revision", async () => {
  let template;
  const activeIds = new Set();
  const requestOrder = [];
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: template?.name }] : [];
    },
    createIndicator(value) {
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.dependency-values",
    name: "Dependency values",
    placement: "overlay",
    inputs: [
      {
        key: "source",
        label: "Source",
        type: "source",
        defaultValue: "close",
      },
    ],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.dependency-values-test",
    pluginName: "Dependency values test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.dependency-values-test/1.0.0/dist/index.js",
    definition,
  };
  const base = {
    instanceId: "dependency-values-base",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: { source: { kind: "candles" } },
  };
  const consumer = {
    instanceId: "dependency-values-consumer",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: {
      source: {
        kind: "indicator-output",
        instanceId: base.instanceId,
        outputKey: "line",
      },
    },
  };
  const sync = async (request) => {
    requestOrder.push(request);
    const candles = request.data.candles ?? [request.data.candle];
    if (request.instanceId.endsWith(`:${base.instanceId}`)) {
      return {
        kind: "snapshot",
        snapshot: {
          points: candles.filter(Boolean).map((item) => ({
            openTimeMs: item.openTimeMs,
            values: { line: item.close * 2 },
          })),
          overlays: [],
          signals: [],
        },
      };
    }
    const dependency = request.dependencies?.[0];
    return {
      kind: "snapshot",
      snapshot: {
        points: candles.filter(Boolean).map((item) => ({
          openTimeMs: item.openTimeMs,
          values: {
            line:
              (dependency?.points.find(
                (point) => point.openTimeMs === item.openTimeMs,
              )?.values.line ?? 0) + 1,
          },
        })),
        overlays: [],
        signals: [],
      },
    };
  };
  const reconciliation = reconcilePluginIndicators(
    module,
    chart,
    [consumer, base],
    [summary],
    sync,
    "TEST",
    "1m",
  );
  const consumerRuntimeId = [...reconciliation.managedRuntimeIds].find((id) =>
    id.endsWith(`:${consumer.instanceId}`),
  );
  assert.ok(consumerRuntimeId);
  const dataList = [
    {
      timestamp: 1_900_000_000_000,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
    },
  ];

  const rows = await template.calc(dataList, { id: consumerRuntimeId });

  assert.deepEqual(
    requestOrder.map(({ instanceId }) =>
      instanceId.slice(instanceId.lastIndexOf(":") + 1),
    ),
    [base.instanceId, consumer.instanceId],
  );
  assert.deepEqual(requestOrder[1].dependencies, [
    {
      inputKey: "source",
      instanceId: base.instanceId,
      outputKey: "line",
      sourceGeneration: 0,
      sourceRevision: 1,
      configGeneration: 1,
      outputRevision: 1,
      points: [
        {
          openTimeMs: dataList[0].timestamp,
          values: { line: 22 },
        },
      ],
    },
  ]);
  assert.deepEqual(rows, [{ line: 23 }]);
});

test("live dependency updates stay incremental and send only the affected dependency point", async () => {
  let template;
  const activeIds = new Set();
  const requests = [];
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: template?.name }] : [];
    },
    createIndicator(value) {
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.dependency-incremental",
    name: "Dependency incremental",
    placement: "overlay",
    inputs: [
      {
        key: "source",
        label: "Source",
        type: "source",
        defaultValue: "close",
      },
    ],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.dependency-incremental-test",
    pluginName: "Dependency incremental test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.dependency-incremental-test/1.0.0/dist/index.js",
    definition,
  };
  const base = {
    instanceId: "dependency-incremental-base",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: { source: { kind: "candles" } },
  };
  const consumer = {
    instanceId: "dependency-incremental-consumer",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: {
      source: {
        kind: "indicator-output",
        instanceId: base.instanceId,
        outputKey: "line",
      },
    },
  };
  const pointsFor = (request, multiplier) => {
    const candles =
      request.data.kind === "building"
        ? [request.data.candle]
        : request.data.kind === "rollover"
          ? [request.data.finalized, request.data.building]
          : request.data.candles;
    const dependency = request.dependencies?.[0];
    return candles.map((candle) => ({
      openTimeMs: candle.openTimeMs,
      values: {
        line:
          dependency === undefined
            ? candle.close * multiplier
            : (dependency.points.find(
                (point) => point.openTimeMs === candle.openTimeMs,
              )?.values.line ?? 0) + 1,
      },
    }));
  };
  const sync = async (request) => {
    requests.push(request);
    const points = pointsFor(request, 2);
    if (request.data.kind === "building") return { kind: "building", points };
    if (request.data.kind === "rollover") return { kind: "rollover", points };
    return {
      kind: "snapshot",
      snapshot: { points, overlays: [], signals: [] },
    };
  };
  const reconciliation = reconcilePluginIndicators(
    module,
    chart,
    [consumer, base],
    [summary],
    sync,
    "TEST",
    "1m",
  );
  const consumerRuntimeId = [...reconciliation.managedRuntimeIds].find((id) =>
    id.endsWith(`:${consumer.instanceId}`),
  );
  assert.ok(consumerRuntimeId);
  const data = [
    {
      timestamp: 1_900_000_000_000,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
    },
    {
      timestamp: 1_900_000_060_000,
      open: 11,
      high: 13,
      low: 10,
      close: 12,
    },
  ];

  await template.calc(data, { id: consumerRuntimeId });
  data[1] = { ...data[1], close: 13 };
  await template.calc(data, { id: consumerRuntimeId });

  const consumerRequests = requests.filter(({ instanceId }) =>
    instanceId.endsWith(`:${consumer.instanceId}`),
  );
  assert.equal(consumerRequests.length, 2);
  assert.equal(consumerRequests[1].data.kind, "building");
  assert.deepEqual(
    consumerRequests[1].dependencies?.[0]?.points.map(
      ({ openTimeMs }) => openTimeMs,
    ),
    [data[1].timestamp],
  );
});

test("an upstream full-output rebuild forces a downstream historical rebuild during a chart delta", async () => {
  let template;
  const activeIds = new Set();
  const requests = [];
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: template?.name }] : [];
    },
    createIndicator(value) {
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.dependency-history-rebuild",
    name: "Dependency history rebuild",
    placement: "overlay",
    inputs: [
      {
        key: "source",
        label: "Source",
        type: "source",
        defaultValue: "close",
      },
    ],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.dependency-history-rebuild-test",
    pluginName: "Dependency history rebuild test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.dependency-history-rebuild-test/1.0.0/dist/index.js",
    definition,
  };
  const base = {
    instanceId: "dependency-history-rebuild-base",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: { source: { kind: "candles" } },
  };
  const consumer = {
    instanceId: "dependency-history-rebuild-consumer",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: {
      source: {
        kind: "indicator-output",
        instanceId: base.instanceId,
        outputKey: "line",
      },
    },
  };
  let rebuildUpstreamOutput = false;
  const historyStart = 1_900_000_000_000;
  const sync = async (request) => {
    requests.push(request);
    const isBase = request.instanceId.endsWith(`:${base.instanceId}`);
    if (isBase && rebuildUpstreamOutput) {
      return {
        kind: "snapshot",
        snapshot: {
          points: [
            { openTimeMs: historyStart, values: { line: 999 } },
            { openTimeMs: historyStart + 60_000, values: { line: 24 } },
          ],
          overlays: [],
          signals: [],
        },
      };
    }
    const candles =
      request.data.kind === "building"
        ? [request.data.candle]
        : request.data.kind === "rollover"
          ? [request.data.finalized, request.data.building]
          : request.data.candles;
    const dependency = request.dependencies?.[0];
    const points = candles.map((item) => ({
      openTimeMs: item.openTimeMs,
      values: {
        line:
          dependency?.points.find(
            (point) => point.openTimeMs === item.openTimeMs,
          )?.values.line ?? item.close * 2,
      },
    }));
    if (request.data.kind === "building") return { kind: "building", points };
    if (request.data.kind === "rollover") return { kind: "rollover", points };
    return {
      kind: "snapshot",
      snapshot: { points, overlays: [], signals: [] },
    };
  };
  const reconciliation = reconcilePluginIndicators(
    module,
    chart,
    [consumer, base],
    [summary],
    sync,
    "TEST",
    "1m",
  );
  const consumerRuntimeId = [...reconciliation.managedRuntimeIds].find((id) =>
    id.endsWith(`:${consumer.instanceId}`),
  );
  assert.ok(consumerRuntimeId);
  const data = [
    {
      timestamp: historyStart,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
    },
    {
      timestamp: historyStart + 60_000,
      open: 11,
      high: 13,
      low: 10,
      close: 12,
    },
  ];
  await template.calc(data, { id: consumerRuntimeId });

  rebuildUpstreamOutput = true;
  data[1] = { ...data[1], close: 13 };
  await template.calc(data, { id: consumerRuntimeId });

  const latestConsumerRequest = requests
    .filter(({ instanceId }) => instanceId === consumerRuntimeId)
    .at(-1);
  assert.equal(latestConsumerRequest?.data.kind, "rebuild");
  assert.deepEqual(
    latestConsumerRequest?.dependencies?.[0]?.points.map((point) => ({
      openTimeMs: point.openTimeMs,
      line: point.values.line,
    })),
    [
      { openTimeMs: historyStart, line: 999 },
      { openTimeMs: historyStart + 60_000, line: 24 },
    ],
  );
});

test("a historical change to an unbound upstream output keeps the downstream update incremental", async () => {
  let template;
  const activeIds = new Set();
  const requests = [];
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: template?.name }] : [];
    },
    createIndicator(value) {
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.dependency-output-history",
    name: "Dependency output history",
    placement: "overlay",
    inputs: [
      {
        key: "source",
        label: "Source",
        type: "source",
        defaultValue: "close",
      },
    ],
    outputs: [
      { key: "line", label: "Line" },
      { key: "stable", label: "Stable" },
    ],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.dependency-output-history-test",
    pluginName: "Dependency output history test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.dependency-output-history-test/1.0.0/dist/index.js",
    definition,
  };
  const base = {
    instanceId: "dependency-output-history-base",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: { source: { kind: "candles" } },
  };
  const consumer = {
    instanceId: "dependency-output-history-consumer",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: {
      source: {
        kind: "indicator-output",
        instanceId: base.instanceId,
        outputKey: "stable",
      },
    },
  };
  let rebuildUpstreamOutput = false;
  const historyStart = 1_900_000_000_000;
  const sync = async (request) => {
    requests.push(request);
    const isBase = request.instanceId.endsWith(`:${base.instanceId}`);
    if (isBase && rebuildUpstreamOutput) {
      return {
        kind: "snapshot",
        snapshot: {
          points: [
            {
              openTimeMs: historyStart,
              values: { line: 999, stable: 110 },
            },
            {
              openTimeMs: historyStart + 60_000,
              values: { line: 26, stable: 130 },
            },
          ],
          overlays: [],
          signals: [],
        },
      };
    }
    const candles =
      request.data.kind === "building"
        ? [request.data.candle]
        : request.data.kind === "rollover"
          ? [request.data.finalized, request.data.building]
          : request.data.candles;
    const dependency = request.dependencies?.[0];
    const points = candles.map((item) => ({
      openTimeMs: item.openTimeMs,
      values: isBase
        ? { line: item.close * 2, stable: item.close * 10 }
        : {
            line:
              dependency?.points.find(
                (point) => point.openTimeMs === item.openTimeMs,
              )?.values.stable ?? null,
            stable: null,
          },
    }));
    if (request.data.kind === "building") return { kind: "building", points };
    if (request.data.kind === "rollover") return { kind: "rollover", points };
    return {
      kind: "snapshot",
      snapshot: { points, overlays: [], signals: [] },
    };
  };
  const reconciliation = reconcilePluginIndicators(
    module,
    chart,
    [consumer, base],
    [summary],
    sync,
    "TEST",
    "1m",
  );
  const consumerRuntimeId = [...reconciliation.managedRuntimeIds].find((id) =>
    id.endsWith(`:${consumer.instanceId}`),
  );
  assert.ok(consumerRuntimeId);
  const data = [
    {
      timestamp: historyStart,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
    },
    {
      timestamp: historyStart + 60_000,
      open: 11,
      high: 13,
      low: 10,
      close: 12,
    },
  ];
  await template.calc(data, { id: consumerRuntimeId });

  rebuildUpstreamOutput = true;
  data[1] = { ...data[1], close: 13 };
  await template.calc(data, { id: consumerRuntimeId });

  const latestConsumerRequest = requests
    .filter(({ instanceId }) => instanceId === consumerRuntimeId)
    .at(-1);
  assert.equal(latestConsumerRequest?.data.kind, "building");
  assert.deepEqual(latestConsumerRequest?.dependencies?.[0]?.points, [
    {
      openTimeMs: historyStart + 60_000,
      values: { stable: 130 },
    },
  ]);
});

test("aligns higher-timeframe dependency outputs only after source candles close", async () => {
  let template;
  const activeIds = new Set();
  const requests = [];
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: template?.name }] : [];
    },
    createIndicator(value) {
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.dependency-mtf",
    name: "Dependency MTF",
    placement: "overlay",
    inputs: [
      {
        key: "source",
        label: "Source",
        type: "source",
        defaultValue: "close",
      },
      {
        key: "input_timeframe",
        label: "Timeframe",
        type: "string",
        defaultValue: "chart",
        editor: "timeframe",
      },
    ],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
    source: {
      timeframe: {
        requestedTimeframeId: "chart",
        inputKey: "input_timeframe",
      },
      taTimeframeIds: [],
    },
  };
  const summary = {
    pluginId: "erc.indicator.dependency-mtf-test",
    pluginName: "Dependency MTF test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.dependency-mtf-test/1.0.0/dist/index.js",
    definition,
  };
  const base = {
    instanceId: "dependency-mtf-base",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: { input_timeframe: "1h" },
    inputs: { source: { kind: "candles" } },
  };
  const consumer = {
    instanceId: "dependency-mtf-consumer",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: { input_timeframe: "chart" },
    inputs: {
      source: {
        kind: "indicator-output",
        instanceId: base.instanceId,
        outputKey: "line",
      },
    },
  };
  let upstreamBuildingValue = 200;
  const sync = async (request) => {
    requests.push(request);
    if (request.instanceId.endsWith(`:${base.instanceId}`)) {
      return {
        kind: "snapshot",
        snapshot: {
          points: [
            { openTimeMs: 0, values: { line: 100 } },
            {
              openTimeMs: 60 * 60_000,
              values: { line: upstreamBuildingValue },
            },
          ],
          overlays: [],
          signals: [],
        },
      };
    }
    const candles =
      request.data.kind === "building"
        ? [request.data.candle]
        : request.data.kind === "rollover"
          ? [request.data.finalized, request.data.building]
          : request.data.candles;
    const dependency = request.dependencies?.[0];
    const points = candles.map((candle) => ({
      openTimeMs: candle.openTimeMs,
      values: {
        line:
          dependency?.points.find(
            (point) => point.openTimeMs === candle.openTimeMs,
          )?.values.line ?? null,
      },
    }));
    if (request.data.kind === "building") return { kind: "building", points };
    if (request.data.kind === "rollover") return { kind: "rollover", points };
    return {
      kind: "snapshot",
      snapshot: { points, overlays: [], signals: [] },
    };
  };
  const reconciliation = reconcilePluginIndicators(
    module,
    chart,
    [consumer, base],
    [summary],
    sync,
    "TEST",
    "15m",
    new Set(),
    "profile-a",
    ["15m", "1h"],
  );
  const consumerRuntimeId = [...reconciliation.managedRuntimeIds].find((id) =>
    id.endsWith(`:${consumer.instanceId}`),
  );
  assert.ok(consumerRuntimeId);
  const data = Array.from({ length: 6 }, (_, index) => ({
    timestamp: index * 15 * 60_000,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
  }));

  await template.calc(data, { id: consumerRuntimeId });
  const firstConsumerRequest = requests
    .filter(({ instanceId }) => instanceId === consumerRuntimeId)
    .at(-1);
  assert.deepEqual(firstConsumerRequest?.dependencies?.[0]?.points, [
    { openTimeMs: 45 * 60_000, values: { line: 100 } },
    { openTimeMs: 60 * 60_000, values: { line: 100 } },
    { openTimeMs: 75 * 60_000, values: { line: 100 } },
  ]);

  upstreamBuildingValue = 250;
  data[5] = { ...data[5], close: 12 };
  await template.calc(data, { id: consumerRuntimeId });
  const liveConsumerRequest = requests
    .filter(({ instanceId }) => instanceId === consumerRuntimeId)
    .at(-1);
  assert.equal(liveConsumerRequest?.data.kind, "building");
  assert.deepEqual(liveConsumerRequest?.dependencies?.[0]?.points, [
    { openTimeMs: 75 * 60_000, values: { line: 100 } },
  ]);
});

test("re-resolves an upstream dependency when configuration changes during calculation", async () => {
  let template;
  const activeIds = new Set();
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: template?.name }] : [];
    },
    createIndicator(value) {
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.dependency-race",
    name: "Dependency race",
    placement: "overlay",
    inputs: [
      {
        key: "multiplier",
        label: "Multiplier",
        type: "number",
        defaultValue: 1,
        effect: "calculation",
      },
      {
        key: "source",
        label: "Source",
        type: "source",
        defaultValue: "close",
      },
    ],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.dependency-race-test",
    pluginName: "Dependency race test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.dependency-race-test/1.0.0/dist/index.js",
    definition,
  };
  const base = (multiplier) => ({
    instanceId: "dependency-race-base",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: { multiplier },
    inputs: { source: { kind: "candles" } },
  });
  const consumer = {
    instanceId: "dependency-race-consumer",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: { multiplier: 1 },
    inputs: {
      source: {
        kind: "indicator-output",
        instanceId: "dependency-race-base",
        outputKey: "line",
      },
    },
  };
  let resolveOldBase;
  const sync = async (request) => {
    const candles =
      request.data.kind === "building"
        ? [request.data.candle]
        : request.data.kind === "rollover"
          ? [request.data.finalized, request.data.building]
          : request.data.candles;
    if (
      request.instanceId.endsWith(":dependency-race-base") &&
      request.parameters.multiplier === 1
    ) {
      return new Promise((resolve) => {
        resolveOldBase = resolve;
      });
    }
    const dependency = request.dependencies?.[0];
    const multiplier = request.parameters.multiplier ?? 1;
    return {
      kind: "snapshot",
      snapshot: {
        points: candles.map((candle) => ({
          openTimeMs: candle.openTimeMs,
          values: {
            line:
              dependency?.points.find(
                (point) => point.openTimeMs === candle.openTimeMs,
              )?.values.line ?? candle.close * multiplier,
          },
        })),
        overlays: [],
        signals: [],
      },
    };
  };
  const first = reconcilePluginIndicators(
    module,
    chart,
    [consumer, base(1)],
    [summary],
    sync,
    "TEST",
    "1m",
  );
  const consumerRuntimeId = [...first.managedRuntimeIds].find((id) =>
    id.endsWith(":dependency-race-consumer"),
  );
  assert.ok(consumerRuntimeId);
  const candle = {
    timestamp: 1_900_000_000_000,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
  };
  const oldConsumerCalculation = template.calc([candle], {
    id: consumerRuntimeId,
  });
  await Promise.resolve();
  assert.equal(typeof resolveOldBase, "function");

  reconcilePluginIndicators(
    module,
    chart,
    [consumer, base(2)],
    [summary],
    sync,
    "TEST",
    "1m",
    first.managedRuntimeIds,
  );
  resolveOldBase({
    kind: "snapshot",
    snapshot: {
      points: [{ openTimeMs: candle.timestamp, values: { line: 11 } }],
      overlays: [],
      signals: [],
    },
  });

  await assert.doesNotReject(oldConsumerCalculation);
  const currentRows = await template.calc([candle], { id: consumerRuntimeId });
  assert.equal(currentRows[0].line, 22);
});

test("bounds published dependency history to the worker 100k payload limit", async () => {
  let template;
  const activeIds = new Set();
  const requests = [];
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: template?.name }] : [];
    },
    createIndicator(value) {
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.dependency-bound",
    name: "Dependency bound",
    placement: "overlay",
    inputs: [
      {
        key: "multiplier",
        label: "Multiplier",
        type: "number",
        defaultValue: 1,
        effect: "calculation",
      },
      {
        key: "source",
        label: "Source",
        type: "source",
        defaultValue: "close",
      },
    ],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.dependency-bound-test",
    pluginName: "Dependency bound test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.dependency-bound-test/1.0.0/dist/index.js",
    definition,
  };
  const base = {
    instanceId: "dependency-bound-base",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: { multiplier: 1 },
    inputs: { source: { kind: "candles" } },
  };
  const consumer = (multiplier) => ({
    instanceId: "dependency-bound-consumer",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: { multiplier },
    inputs: {
      source: {
        kind: "indicator-output",
        instanceId: base.instanceId,
        outputKey: "line",
      },
    },
  });
  const sync = async (request) => {
    requests.push(request);
    const candles =
      request.data.kind === "building"
        ? [request.data.candle]
        : request.data.kind === "rollover"
          ? [request.data.finalized, request.data.building]
          : request.data.candles;
    const points = candles.map((candle) => ({
      openTimeMs: candle.openTimeMs,
      values: { line: candle.close },
    }));
    if (request.data.kind === "building") return { kind: "building", points };
    if (request.data.kind === "rollover") return { kind: "rollover", points };
    return {
      kind: "snapshot",
      snapshot: { points, overlays: [], signals: [] },
    };
  };
  const first = reconcilePluginIndicators(
    module,
    chart,
    [consumer(1), base],
    [summary],
    sync,
    "TEST",
    "1m",
  );
  const consumerRuntimeId = [...first.managedRuntimeIds].find((id) =>
    id.endsWith(":dependency-bound-consumer"),
  );
  assert.ok(consumerRuntimeId);

  const start = 1_900_000_000_000;
  const data = Array.from({ length: 100_000 }, (_, index) => ({
    timestamp: start + index * 60_000,
    open: index,
    high: index + 2,
    low: index - 1,
    close: index + 1,
  }));
  await template.calc(data, { id: consumerRuntimeId });

  data.push({
    timestamp: start + 100_000 * 60_000,
    open: 100_000,
    high: 100_002,
    low: 99_999,
    close: 100_001,
  });
  await template.calc(data, { id: consumerRuntimeId });

  reconcilePluginIndicators(
    module,
    chart,
    [consumer(2), base],
    [summary],
    sync,
    "TEST",
    "1m",
    first.managedRuntimeIds,
  );
  await template.calc(data, { id: consumerRuntimeId });

  const finalConsumerRequest = requests
    .filter(({ instanceId }) => instanceId === consumerRuntimeId)
    .at(-1);
  assert.equal(finalConsumerRequest?.data.kind, "rebuild");
  assert.equal(finalConsumerRequest?.dependencies?.[0]?.points.length, 100_000);
  assert.equal(
    finalConsumerRequest?.dependencies?.[0]?.points[0]?.openTimeMs,
    start + 60_000,
  );
});

test("upstream configuration changes invalidate and rebuild unchanged downstream data", async () => {
  let template;
  const activeIds = new Set();
  const requests = [];
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: template?.name }] : [];
    },
    createIndicator(value) {
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.dependency-invalidation",
    name: "Dependency invalidation",
    placement: "overlay",
    inputs: [
      {
        key: "multiplier",
        label: "Multiplier",
        type: "number",
        defaultValue: 2,
        effect: "calculation",
      },
      {
        key: "source",
        label: "Source",
        type: "source",
        defaultValue: "close",
      },
    ],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.dependency-invalidation-test",
    pluginName: "Dependency invalidation test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.dependency-invalidation-test/1.0.0/dist/index.js",
    definition,
  };
  const base = (multiplier) => ({
    instanceId: "dependency-invalidation-base",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: { multiplier },
    inputs: { source: { kind: "candles" } },
  });
  const consumer = {
    instanceId: "dependency-invalidation-consumer",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: { multiplier: 1 },
    inputs: {
      source: {
        kind: "indicator-output",
        instanceId: "dependency-invalidation-base",
        outputKey: "line",
      },
    },
  };
  const sync = async (request) => {
    requests.push(request);
    const candles = request.data.candles ?? [request.data.candle];
    const dependency = request.dependencies?.[0];
    const multiplier = request.parameters.multiplier ?? 1;
    return {
      kind: "snapshot",
      snapshot: {
        points: candles.filter(Boolean).map((item) => ({
          openTimeMs: item.openTimeMs,
          values: {
            line:
              dependency === undefined
                ? item.close * multiplier
                : (dependency.points.find(
                    (point) => point.openTimeMs === item.openTimeMs,
                  )?.values.line ?? 0) * multiplier,
          },
        })),
        overlays: [],
        signals: [],
      },
    };
  };
  const first = reconcilePluginIndicators(
    module,
    chart,
    [consumer, base(2)],
    [summary],
    sync,
    "TEST",
    "1m",
  );
  const consumerRuntimeId = [...first.managedRuntimeIds].find((id) =>
    id.endsWith(`:${consumer.instanceId}`),
  );
  assert.ok(consumerRuntimeId);
  const dataList = [
    {
      timestamp: 1_900_000_060_000,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
    },
  ];
  assert.deepEqual(await template.calc(dataList, { id: consumerRuntimeId }), [
    { line: 22 },
  ]);

  reconcilePluginIndicators(
    module,
    chart,
    [consumer, base(3)],
    [summary],
    sync,
    "TEST",
    "1m",
    first.managedRuntimeIds,
  );
  assert.deepEqual(await template.calc(dataList, { id: consumerRuntimeId }), [
    { line: 33 },
  ]);

  const consumerRequests = requests.filter(({ instanceId }) =>
    instanceId.endsWith(`:${consumer.instanceId}`),
  );
  assert.equal(consumerRequests.length, 2);
  assert.deepEqual(
    consumerRequests.map(({ configGeneration }) => configGeneration),
    [1, 2],
  );
  assert.deepEqual(
    consumerRequests.map(
      ({ dependencies }) => dependencies?.[0]?.configGeneration,
    ),
    [1, 2],
  );
});

test("configuration-only upstream changes preserve matching source revisions across dependencies", async () => {
  let template;
  const activeIds = new Set();
  const requests = [];
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: template?.name }] : [];
    },
    createIndicator(value) {
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.dependency-revision",
    name: "Dependency revision",
    placement: "overlay",
    inputs: [
      {
        key: "multiplier",
        label: "Multiplier",
        type: "number",
        defaultValue: 1,
        effect: "calculation",
      },
      {
        key: "first",
        label: "First source",
        type: "source",
        defaultValue: "close",
      },
      {
        key: "second",
        label: "Second source",
        type: "source",
        defaultValue: "close",
      },
    ],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.dependency-revision-test",
    pluginName: "Dependency revision test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.dependency-revision-test/1.0.0/dist/index.js",
    definition,
  };
  const source = (instanceId, multiplier) => ({
    instanceId,
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: { multiplier },
    inputs: { source: { kind: "candles" } },
  });
  const sourceA = (multiplier) => source("dependency-revision-a", multiplier);
  const sourceB = source("dependency-revision-b", 1);
  const consumer = {
    instanceId: "dependency-revision-consumer",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: { multiplier: 1 },
    inputs: {
      first: {
        kind: "indicator-output",
        instanceId: sourceA(1).instanceId,
        outputKey: "line",
      },
      second: {
        kind: "indicator-output",
        instanceId: sourceB.instanceId,
        outputKey: "line",
      },
    },
  };
  const sync = async (request) => {
    requests.push(request);
    const current =
      request.data.kind === "building"
        ? [request.data.candle]
        : request.data.kind === "rollover"
          ? [request.data.finalized, request.data.building]
          : request.data.candles;
    const multiplier = request.parameters.multiplier ?? 1;
    const dependencyTotal = (request.dependencies ?? []).reduce(
      (sum, dependency) => sum + (dependency.points.at(-1)?.values.line ?? 0),
      0,
    );
    return {
      kind: "snapshot",
      snapshot: {
        points: current.map((item) => ({
          openTimeMs: item.openTimeMs,
          values: {
            line:
              request.dependencies === undefined
                ? item.close * multiplier
                : dependencyTotal,
          },
        })),
        overlays: [],
        signals: [],
      },
    };
  };
  const first = reconcilePluginIndicators(
    module,
    chart,
    [consumer, sourceB, sourceA(1)],
    [summary],
    sync,
    "TEST",
    "1m",
  );
  const consumerRuntimeId = [...first.managedRuntimeIds].find((id) =>
    id.endsWith(`:${consumer.instanceId}`),
  );
  assert.ok(consumerRuntimeId);
  const data = [
    {
      timestamp: 1_900_000_120_000,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
    },
  ];
  await template.calc(data, { id: consumerRuntimeId });
  data[0] = { ...data[0], close: 12 };
  await template.calc(data, { id: consumerRuntimeId });
  data[0] = { ...data[0], close: 13 };
  await template.calc(data, { id: consumerRuntimeId });

  reconcilePluginIndicators(
    module,
    chart,
    [consumer, sourceB, sourceA(2)],
    [summary],
    sync,
    "TEST",
    "1m",
    first.managedRuntimeIds,
  );
  await template.calc(data, { id: consumerRuntimeId });

  const latestConsumer = requests
    .filter(({ instanceId }) => instanceId.endsWith(`:${consumer.instanceId}`))
    .at(-1);
  assert.ok(latestConsumer);
  assert.deepEqual(
    latestConsumer.dependencies.map(({ sourceRevision }) => sourceRevision),
    [3, 3],
  );
});

test("scopes identical workspace instance ids to their owning chart", async () => {
  let template;
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const makeChart = () => {
    const ids = new Set();
    return {
      ids,
      chart: {
        getIndicators({ id }) {
          return ids.has(id) ? [{ id, name: template?.name }] : [];
        },
        createIndicator(value) {
          ids.add(value.id);
          return "candle_pane";
        },
        overrideIndicator() {
          return true;
        },
        removeIndicator({ id }) {
          ids.delete(id);
          return true;
        },
      },
    };
  };
  const definition = {
    id: "erc.indicator.test.chart-scope",
    name: "Chart scope",
    placement: "overlay",
    inputs: [],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.chart-scope-test",
    pluginName: "Chart scope test",
    version: "1.0.0",
    definition,
  };
  const indicator = {
    instanceId: "restored-instance",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: { source: { kind: "candles" } },
  };
  const candle = {
    timestamp: 1_900_000_000_000,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
  };
  const first = makeChart();
  const second = makeChart();

  reconcilePluginIndicators(
    module,
    first.chart,
    [indicator],
    [summary],
    async () => ({
      kind: "snapshot",
      snapshot: {
        points: [{ openTimeMs: candle.timestamp, values: { line: 1 } }],
        overlays: [],
        signals: [],
      },
    }),
    "TEST",
    "1m",
  );
  reconcilePluginIndicators(
    module,
    second.chart,
    [indicator],
    [summary],
    async () => ({
      kind: "snapshot",
      snapshot: {
        points: [{ openTimeMs: candle.timestamp, values: { line: 2 } }],
        overlays: [],
        signals: [],
      },
    }),
    "TEST",
    "1m",
  );

  const [firstRuntimeId] = first.ids;
  const [secondRuntimeId] = second.ids;
  assert.ok(template);
  assert.notEqual(firstRuntimeId, secondRuntimeId);
  const [firstRow] = await template.calc([candle], { id: firstRuntimeId });
  const [secondRow] = await template.calc([candle], { id: secondRuntimeId });
  assert.equal(firstRow.line, 1);
  assert.equal(secondRow.line, 2);
});

test("does not let an older async calculation overwrite a newer configuration", async () => {
  let template;
  const activeIds = new Set();
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: template?.name }] : [];
    },
    createIndicator(value) {
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.stale-calculation",
    name: "Stale calculation",
    placement: "overlay",
    inputs: [
      {
        key: "length",
        label: "Length",
        type: "number",
        defaultValue: 1,
        effect: "calculation",
      },
    ],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.stale-calculation-test",
    pluginName: "Stale calculation test",
    version: "1.0.0",
    definition,
  };
  const makeIndicator = (length) => ({
    instanceId: "stale-instance",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: { length },
    inputs: { source: { kind: "candles" } },
  });
  const candle = {
    timestamp: 1_900_000_000_000,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
  };
  let resolveOld;
  let resolveNew;
  const oldSync = () =>
    new Promise((resolve) => {
      resolveOld = resolve;
    });
  const newerSync = () =>
    new Promise((resolve) => {
      resolveNew = resolve;
    });

  const initial = reconcilePluginIndicators(
    module,
    chart,
    [makeIndicator(1)],
    [summary],
    oldSync,
    "TEST",
    "1m",
  );
  const [runtimeId] = initial.managedRuntimeIds;
  const oldCalculation = template.calc([candle], { id: runtimeId });

  reconcilePluginIndicators(
    module,
    chart,
    [makeIndicator(2)],
    [summary],
    newerSync,
    "TEST",
    "1m",
    initial.managedRuntimeIds,
  );
  const newerCalculation = template.calc([candle], { id: runtimeId });
  resolveNew({
    kind: "snapshot",
    snapshot: {
      points: [{ openTimeMs: candle.timestamp, values: { line: 22 } }],
      overlays: [],
      signals: [],
    },
  });
  assert.equal((await newerCalculation)[0].line, 22);

  resolveOld({
    kind: "snapshot",
    snapshot: {
      points: [{ openTimeMs: candle.timestamp, values: { line: 11 } }],
      overlays: [],
      signals: [],
    },
  });
  assert.equal((await oldCalculation)[0].line, 22);
});

test("sends one history snapshot followed by bounded building and rollover deltas", async () => {
  let template;
  const activeIds = new Set();
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: template?.name }] : [];
    },
    createIndicator(value) {
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.incremental-transport",
    name: "Incremental transport",
    placement: "overlay",
    inputs: [],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.incremental-transport-test",
    pluginName: "Incremental transport test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.incremental-transport-test/1.0.0/dist/index.js",
    definition,
  };
  const indicator = {
    instanceId: "incremental-transport-instance",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: { source: { kind: "candles" } },
  };
  const first = {
    timestamp: 1_900_000_000_000,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
  };
  const second = {
    timestamp: first.timestamp + 60_000,
    open: 11,
    high: 13,
    low: 10,
    close: 12,
  };
  const secondUpdate = { ...second, high: 14, close: 13 };
  const third = {
    timestamp: second.timestamp + 60_000,
    open: 13,
    high: 15,
    low: 12,
    close: 14,
  };
  const requests = [];
  let release;
  let deferNext = false;
  const sync = async (request) => {
    requests.push(request);
    if (deferNext) {
      deferNext = false;
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    if (request.data.kind === "building") {
      return {
        kind: "building",
        points: [
          {
            openTimeMs: request.data.candle.openTimeMs,
            values: { line: request.data.candle.close },
          },
        ],
        overlays: [],
        signals: [],
      };
    }
    if (request.data.kind === "rollover") {
      return {
        kind: "rollover",
        points: [
          {
            openTimeMs: request.data.finalized.openTimeMs,
            values: { line: request.data.finalized.close },
          },
          {
            openTimeMs: request.data.building.openTimeMs,
            values: { line: request.data.building.close },
          },
        ],
        overlays: [],
        signals: [],
      };
    }
    return {
      kind: "snapshot",
      snapshot: {
        points: request.data.candles.map((item) => ({
          openTimeMs: item.openTimeMs,
          values: { line: item.close },
        })),
        overlays: [],
        signals: [],
      },
    };
  };

  const reconciliation = reconcilePluginIndicators(
    module,
    chart,
    [indicator],
    [summary],
    sync,
    "TEST",
    "1m",
  );
  const [runtimeId] = reconciliation.managedRuntimeIds;

  const initialRows = await template.calc([first, second], { id: runtimeId });
  const buildingRows = await template.calc([first, secondUpdate], {
    id: runtimeId,
  });
  await template.calc([first, secondUpdate], { id: runtimeId });
  const rolloverRows = await template.calc([first, secondUpdate, third], {
    id: runtimeId,
  });

  assert.deepEqual(
    requests.map((request) => request.data.kind),
    ["snapshot", "building", "rollover"],
  );
  assert.equal(requests[0].data.candles.length, 2);
  assert.equal("candles" in requests[1].data, false);
  assert.equal("candles" in requests[2].data, false);
  assert.equal(requests[1].data.candle.openTimeMs, second.timestamp);
  assert.equal(requests[2].data.finalized.openTimeMs, second.timestamp);
  assert.equal(requests[2].data.building.openTimeMs, third.timestamp);
  assert.strictEqual(initialRows, buildingRows);
  assert.strictEqual(buildingRows, rolloverRows);
  assert.deepEqual(
    rolloverRows.map(({ line }) => line),
    [first.close, secondUpdate.close, third.close],
  );
  const countBeforeBurst = requests.length;
  deferNext = true;
  const live = [first, secondUpdate, { ...third, close: 15 }];
  const pending = [template.calc(live, { id: runtimeId })];
  for (let index = 0; index < 100; index += 1) {
    live[2] = { ...third, close: 16 + index };
    pending.push(template.calc(live, { id: runtimeId }));
  }
  assert.equal(
    requests.length,
    countBeforeBurst + 1,
    "one active worker request regardless of tick burst",
  );
  release();
  const results = await Promise.all(pending);
  assert.equal(
    requests.length,
    countBeforeBurst + 2,
    "one pending latest building update",
  );
  assert.equal(requests.at(-1).data.kind, "building");
  assert.equal(results.at(-1).at(-1).line, 115);

  // A finalized bar arriving while the worker is busy must not be lost or applied to a shifted timeline.
  deferNext = true;
  live[2] = { ...third, close: 116 };
  const beforeRollover = template.calc(live, { id: runtimeId });
  live.push({ ...third, timestamp: third.timestamp + 60_000, close: 117 });
  const afterRollover = template.calc(live, { id: runtimeId });
  release();
  await Promise.all([beforeRollover, afterRollover]);
  assert.equal(requests.at(-1).data.kind, "rollover");
  assert.deepEqual(
    (await afterRollover).map((row) => row.line),
    [11, 13, 116, 117],
  );

  const runtimeIndicator = { id: runtimeId, result: await afterRollover };
  const older = { ...first, timestamp: first.timestamp - 60_000, close: 9 };
  deferNext = true;
  const paginated = [older, ...live];
  const pageCalculation = template.calc(paginated, runtimeIndicator);
  assert.deepEqual(
    runtimeIndicator.result.map((row) => row.line),
    [undefined, 11, 13, 116, 117],
    "existing plots stay on their candles before the worker finishes pagination",
  );
  assert.equal(requests.at(-1).data.kind, "rebuild");
  release();
  runtimeIndicator.result = await pageCalculation;
  assert.deepEqual(
    runtimeIndicator.result.map((row) => row.line),
    [9, 11, 13, 116, 117],
  );
});

test("canonical historical corrections force a rebuild without prefix scanning", async () => {
  let template;
  const activeIds = new Set();
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: template?.name }] : [];
    },
    createIndicator(value) {
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.correction-rebuild",
    name: "Correction rebuild",
    placement: "overlay",
    inputs: [],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.correction-rebuild-test",
    pluginName: "Correction rebuild test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.correction-rebuild-test/1.0.0/dist/index.js",
    definition,
  };
  const indicator = {
    instanceId: "correction-rebuild-instance",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: { source: { kind: "candles" } },
  };
  const first = {
    timestamp: 1_900_000_000_000,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
  };
  const second = { ...first, timestamp: first.timestamp + 60_000, close: 12 };
  const third = { ...second, timestamp: second.timestamp + 60_000, close: 13 };
  const correctedFirst = { ...first, close: 10.5 };
  const requests = [];
  const sync = async (request) => {
    requests.push(request);
    return {
      kind: "snapshot",
      snapshot: {
        points: request.data.candles.map((item) => ({
          openTimeMs: item.openTimeMs,
          values: { line: item.close },
        })),
        overlays: [],
        signals: [],
      },
    };
  };
  const reconciliation = reconcilePluginIndicators(
    module,
    chart,
    [indicator],
    [summary],
    sync,
    "TEST",
    "1m",
  );
  const [runtimeId] = reconciliation.managedRuntimeIds;
  await template.calc([first, second, third], { id: runtimeId });

  const change = {
    generation: 1,
    revision: 9,
    kind: "rebuild",
    dirtyFromOpenTimeMs: first.timestamp,
  };
  markPluginIndicatorSeriesChange(chart, change);
  try {
    const rows = await template.calc([correctedFirst, second, third], {
      id: runtimeId,
    });
    assert.equal(rows[0].line, correctedFirst.close);
  } finally {
    clearPluginIndicatorSeriesChange(chart, change.revision);
  }

  assert.deepEqual(
    requests.map(({ data }) => data.kind),
    ["snapshot", "rebuild"],
  );
  assert.equal(requests[1].dataRevision, 9);
  assert.equal(requests[1].data.candles[0].close, correctedFirst.close);
});

test("resets revision state and calculation generation when provider profile changes", async () => {
  let template;
  const activeIds = new Set();
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators({ id }) {
      return activeIds.has(id) ? [{ id, name: template?.name }] : [];
    },
    createIndicator(value) {
      activeIds.add(value.id);
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator({ id }) {
      activeIds.delete(id);
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.provider-scope",
    name: "Provider scope",
    placement: "overlay",
    inputs: [],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.provider-scope-test",
    pluginName: "Provider scope test",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.provider-scope-test/1.0.0/dist/index.js",
    definition,
  };
  const indicator = {
    instanceId: "provider-scope-instance",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: { source: { kind: "candles" } },
  };
  const data = [
    { timestamp: 60_000, open: 10, high: 12, low: 9, close: 11 },
    { timestamp: 120_000, open: 11, high: 13, low: 10, close: 12 },
  ];
  const requests = [];
  const sync = async (request) => {
    requests.push(request);
    const candles =
      request.data.candles ?? [request.data.candle].filter(Boolean);
    return {
      kind: "snapshot",
      snapshot: {
        points: candles.map((item) => ({
          openTimeMs: item.openTimeMs,
          values: { line: item.close },
        })),
        overlays: [],
        signals: [],
      },
    };
  };

  const first = reconcilePluginIndicators(
    module,
    chart,
    [indicator],
    [summary],
    sync,
    "BTCUSD",
    "1m",
    new Set(),
    "profile-a",
  );
  const [runtimeId] = first.managedRuntimeIds;
  markPluginIndicatorSeriesChange(chart, {
    generation: 3,
    revision: 50,
    kind: "rebuild",
    dirtyFromOpenTimeMs: 60_000,
  });
  await template.calc(data, { id: runtimeId });

  reconcilePluginIndicators(
    module,
    chart,
    [indicator],
    [summary],
    sync,
    "BTCUSD",
    "1m",
    first.managedRuntimeIds,
    "profile-b",
  );
  await template.calc(
    data.map((item) => ({ ...item, close: item.close + 100 })),
    { id: runtimeId },
  );

  assert.equal(requests[0].dataRevision, 50);
  assert.equal(requests[0].data.kind, "rebuild");
  assert.equal(requests[0].providerProfileId, "profile-a");
  assert.equal(requests[1].dataRevision, 1);
  assert.equal(requests[1].data.kind, "snapshot");
  assert.equal(requests[1].providerProfileId, "profile-b");
  assert.equal(requests[1].configGeneration, requests[0].configGeneration + 1);
});
