import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  createInitialWorkspace,
  workspaceReducer,
  toPersistedWorkspace,
} from "../dist/index.js";

test("production shell delivers canonical corrections and coalesced revisions to chart and indicator", async (t) => {
  const { document, window } = parseHTML(
    '<html><body><main id="root"></main></body></html>',
  );
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(globalThis, {
    document,
    window,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let data = [];
  let loader;
  let listener;
  let stops = 0;
  let resets = 0;
  const templates = new Map();
  const indicators = new Map();
  const calculations = [];
  const requests = [];
  const calculate = () => {
    for (const indicator of indicators.values())
      calculations.push(templates.get(indicator.name).calc(data, indicator));
  };
  const chart = {
    subscribeAction: () => undefined,
    unsubscribeAction: () => undefined,
    setStyles: () => undefined,
    setSymbol: () => undefined,
    setPeriod: () => undefined,
    setTimezone: () => undefined,
    getDataList: () => data,
    getIndicators: ({ id }) => (indicators.has(id) ? [indicators.get(id)] : []),
    createIndicator(value) {
      indicators.set(value.id, value);
      return "candle_pane";
    },
    overrideIndicator(value) {
      indicators.set(value.id, value);
      return true;
    },
    removeIndicator({ id }) {
      indicators.delete(id);
      return true;
    },
    setDataLoader(value) {
      loader = value;
    },
    resetData() {
      resets += 1;
      calculations.push(load());
    },
  };
  const load = async () => {
    await loader.getBars({
      type: "init",
      timestamp: null,
      callback(value) {
        data = value;
        calculate();
      },
    });
    loader.subscribeBar({
      callback(value) {
        const index = data.findIndex(
          ({ timestamp }) => timestamp === value.timestamp,
        );
        if (index >= 0) data[index] = value;
        else data.push(value);
        calculate();
      },
    });
  };
  globalThis.__seriesFixture = {
    chart,
    registerIndicator(value) {
      templates.set(value.name, value);
    },
    runtime: {
      dispose: () => undefined,
      disposeInstance: () => undefined,
      async sync(request) {
        requests.push(request);
        return {
          kind: "snapshot",
          snapshot: {
            points: request.rebuildCandles().map((candle) => ({
              openTimeMs: candle.openTimeMs,
              values: { line: candle.close },
            })),
            overlays: [],
            signals: [],
          },
        };
      },
    },
  };
  const bundle = await build({
    entryPoints: [
      fileURLToPath(new URL("../src/development-shell.tsx", import.meta.url)),
    ],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    plugins: [
      {
        name: "chart-boundary",
        setup(builder) {
          builder.onResolve(
            { filter: /^(react(?:\/.*)?|@erc-chart\/.*)$/ },
            ({ path }) => ({ path: import.meta.resolve(path), external: true }),
          );
          builder.onResolve({ filter: /^klinecharts$/ }, () => ({
            path: "chart",
            namespace: "fixture",
          }));
          builder.onResolve(
            { filter: /indicator-worker-runtime\.js$/ },
            () => ({ path: "worker", namespace: "fixture" }),
          );
          builder.onLoad(
            { filter: /.*/, namespace: "fixture" },
            ({ path }) => ({
              contents:
                path === "chart"
                  ? "export const getSupportedIndicators = () => []; export const init = () => globalThis.__seriesFixture.chart; export const dispose = () => {}; export const registerIndicator = value => globalThis.__seriesFixture.registerIndicator(value);"
                  : "export const createBrowserIndicatorRuntime = () => globalThis.__seriesFixture.runtime;",
            }),
          );
        },
      },
    ],
  });
  const { RuntimeApplicationShell } = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + "\n//# sourceURL=runtime-series-fixture.mjs").toString("base64")}`
  );
  const candle = (openTimeMs, close) => ({
    instrumentId: "BTCUSD",
    timeframeId: "1m",
    openTimeMs,
    open: 10,
    high: 20,
    low: 5,
    close,
    volume: 1,
  });
  const session = {
    profileId: "profile-a",
    providerId: "fixture",
    providerName: "Fixture",
    instrument: { id: "BTCUSD", symbol: "BTCUSD", name: "Bitcoin" },
    timeframeId: "1m",
    candles: [candle(0, 11), candle(60_000, 12)],
  };
  const summary = {
    pluginId: "erc.indicator.fixture",
    pluginName: "Fixture",
    version: "1.0.0",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.fixture/1.0.0/dist/index.js",
    definition: {
      id: "fixture",
      name: "Fixture",
      placement: "overlay",
      inputs: [],
      outputs: [{ key: "line", label: "Line" }],
      plots: [{ key: "line", kind: "line", outputKey: "line" }],
      requiresLiveTicks: false,
    },
  };
  const indicator = {
    instanceId: "fixture",
    pluginId: summary.pluginId,
    definitionId: "fixture",
    enabled: true,
    parameters: {},
    inputs: { source: { kind: "candles" } },
  };
  const workspace = workspaceReducer(createInitialWorkspace(), {
    type: "configure-tab-provider",
    tabId: "tab-1",
    providerProfileId: "profile-a",
    instrumentId: "BTCUSD",
    timeframeSeconds: 60,
  });
  const persisted = toPersistedWorkspace(workspace, 1);
  persisted.tabs[0].chartSlots[0].indicators = [indicator];
  const bridge = {
    getRuntimeInfo: async () => ({
      ipcContractVersion: 1,
      applicationName: "ERC Chart",
    }),
    loadWorkspace: async () => persisted,
    saveWorkspace: async () => undefined,
    flushWorkspace: async () => undefined,
    listIndicators: async () => [summary],
    startProviderProfile: async () => session,
    loadProviderSession: async () => session,
    subscribeProviderData: async (_request, callback) => {
      listener = callback;
      return async () => {
        stops += 1;
      };
    },
  };
  const root = createRoot(document.getElementById("root"));
  t.after(async () => {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    delete globalThis.__seriesFixture;
  });
  await act(async () =>
    root.render(createElement(RuntimeApplicationShell, { bridge })),
  );
  for (let attempt = 0; attempt < 20 && (!loader || !listener); attempt += 1)
    await act(async () => new Promise(setImmediate));
  assert.ok(loader);
  assert.ok(listener);
  await act(async () => load());
  await Promise.all(calculations);
  const emit = (
    candles,
    revision,
    kind = "incremental",
    generation = 2,
    previousRevision = revision - 1,
  ) =>
    listener({
      type: "candles",
      candles,
      series: {
        generation,
        revision,
        previousRevision,
        kind,
        dirtyFromOpenTimeMs: candles[0].openTimeMs,
      },
    });
  await act(async () => {
    emit([candle(0, 15), candle(60_000, 12)], 7, "rebuild");
    emit([candle(60_000, 12)], 8);
  });
  await Promise.all(calculations);
  assert.equal(
    data[0].close,
    15,
    "central session cache must reset a historical chart correction",
  );
  assert.ok(
    requests.some(
      ({ dataRevision, data: update }) =>
        dataRevision === 8 && update.kind === "rebuild",
    ),
  );
  const resetCount = resets;
  await act(async () => {
    emit([candle(0, 16), candle(60_000, 12)], 9, "rebuild");
    emit([candle(60_000, 14)], 10);
  });
  await Promise.all(calculations);
  assert.equal(data[0].close, 16);
  assert.equal(data[1].close, 14);
  assert.equal(
    resets,
    resetCount + 1,
    "batched correction must not become a tail-only update",
  );
  assert.ok(
    requests.some(
      ({ dataRevision, data: update }) =>
        dataRevision === 10 && update.kind === "rebuild",
    ),
  );
  const beforeStale = requests.length;
  await act(async () => {
    emit([candle(60_000, 6)], 9);
    emit([candle(60_000, 7)], 100, "incremental", 1);
  });
  await Promise.all(calculations);
  assert.equal(data[1].close, 14);
  assert.equal(requests.length, beforeStale);
  await act(async () =>
    emit([candle(0, 17), candle(60_000, 18)], 1, "rebuild", 3),
  );
  await Promise.all(calculations);
  assert.equal(data[0].close, 17);
  assert.ok(
    requests.some(
      ({ dataRevision, data: update }) =>
        dataRevision === 1 &&
        update.kind === "rebuild" &&
        update.candles[0].close === 17,
    ),
  );
  const beforeIncrement = resets;
  await act(async () => emit([candle(60_000, 19)], 2, "incremental", 3));
  await Promise.all(calculations);
  assert.equal(data[1].close, 19);
  assert.equal(
    resets,
    beforeIncrement,
    "contiguous building update stays incremental",
  );
  await act(async () => {
    emit([candle(60_000, 18)], 3, "incremental", 3);
    emit([candle(60_000, 20)], 4, "incremental", 3);
  });
  await Promise.all(calculations);
  assert.equal(
    resets,
    beforeIncrement,
    "batched building updates must not rebuild history",
  );
  assert.equal(data[1].close, 20);
  await act(async () =>
    emit([candle(60_000, 19), candle(120_000, 18)], 6, "incremental", 3, 4),
  );
  await Promise.all(calculations);
  assert.equal(
    resets,
    beforeIncrement,
    "one rollover has two canonical revisions, not a missing event",
  );
  assert.equal(requests.at(-1).data.kind, "rollover");
  await act(async () => emit([candle(120_000, 19)], 9, "incremental", 3, 8));
  await Promise.all(calculations);
  assert.equal(
    resets,
    beforeIncrement + 1,
    "a genuine delivery gap still rebuilds safely",
  );
  await act(async () => root.unmount());
  assert.equal(stops, 1);
});
