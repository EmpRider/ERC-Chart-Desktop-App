import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPluginIndicatorSeriesChange,
  markPluginIndicatorSeriesChange,
  reconcilePluginIndicators,
} from "../dist/plugin-indicators.js";

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
  assert.equal(requests[1].dataRevision, 1);
  assert.equal(requests[1].data.kind, "snapshot");
  assert.equal(requests[1].configGeneration, requests[0].configGeneration + 1);
});
