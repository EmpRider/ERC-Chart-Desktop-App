import assert from "node:assert/strict";
import test from "node:test";

import {
  createBrowserIndicatorRuntime,
  createRendererIndicatorSourceDataService,
} from "../dist/indicator-worker-runtime.js";

const candle = {
  instrumentId: "fixture.instrument",
  timeframeId: "1m",
  openTimeMs: 1_800_000_000_000,
  open: 100,
  high: 102,
  low: 99,
  close: 101,
  volume: 10,
};

test("lazily rebuilds history when an incremental update reaches a fresh worker", async () => {
  const posted = [];
  let rebuildCalls = 0;
  let terminations = 0;
  const runtime = createBrowserIndicatorRuntime({
    workerFactory() {
      let onmessage = null;
      return {
        get onmessage() {
          return onmessage;
        },
        set onmessage(value) {
          onmessage = value;
        },
        onerror: null,
        postMessage(message) {
          posted.push(message);
          if (message.type !== "sync") return;
          queueMicrotask(() =>
            onmessage?.({
              data: {
                type: "result",
                instanceId: message.instanceId,
                sequence: message.sequence,
                dataRevision: message.dataRevision,
                configGeneration: message.configGeneration,
                result: {
                  kind: "snapshot",
                  snapshot: { points: [], overlays: [], signals: [] },
                },
              },
            }),
          );
        },
        terminate() {
          terminations += 1;
        },
      };
    },
  });

  try {
    await runtime.sync({
      instanceId: "fixture-instance",
      runtimeEntryUrl:
        "erc-plugin://plugin/erc.indicator.fixture/1.0.0/dist/index.js",
      pluginId: "erc.indicator.fixture",
      definitionId: "erc.indicator.fixture.main",
      instrumentId: candle.instrumentId,
      timeframeId: candle.timeframeId,
      parameters: {},
      data: { kind: "building", candle },
      rebuildCandles() {
        rebuildCalls += 1;
        return [candle];
      },
      dataRevision: 2,
      configGeneration: 1,
    });

    assert.equal(rebuildCalls, 1);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].data.kind, "rebuild");
    assert.deepEqual(posted[0].data.candles, [candle]);
  } finally {
    runtime.dispose();
  }
  assert.equal(terminations, 1);
});

test("provider-backed indicator sources rebuild workers from source-engine candles instead of chart candles", async () => {
  const posted = [];
  const historyRequests = [];
  const chartCandle = { ...candle, timeframeId: "15m", close: 115 };
  const sourceCandle = { ...candle, timeframeId: "1m", close: 101 };
  const runtime = createBrowserIndicatorRuntime({
    sourceDataService: {
      async requestHistory(providerProfileId, request) {
        historyRequests.push({ providerProfileId, request });
        return [sourceCandle];
      },
      async subscribe() {
        return { unsubscribe: async () => undefined };
      },
    },
    workerFactory() {
      let onmessage = null;
      return {
        get onmessage() {
          return onmessage;
        },
        set onmessage(value) {
          onmessage = value;
        },
        onerror: null,
        postMessage(message) {
          posted.push(message);
          if (message.type !== "sync") return;
          queueMicrotask(() =>
            onmessage?.({
              data: {
                type: "result",
                instanceId: message.instanceId,
                sequence: message.sequence,
                dataRevision: message.dataRevision,
                configGeneration: message.configGeneration,
                result: {
                  kind: "snapshot",
                  snapshot: { points: [], overlays: [], signals: [] },
                },
              },
            }),
          );
        },
        terminate() {
          return undefined;
        },
      };
    },
  });

  try {
    await runtime.sync({
      instanceId: "fixture-instance",
      runtimeEntryUrl:
        "erc-plugin://plugin/erc.indicator.fixture/1.0.0/dist/index.js",
      pluginId: "erc.indicator.fixture",
      definitionId: "erc.indicator.fixture.main",
      providerProfileId: "profile-a",
      instrumentId: candle.instrumentId,
      timeframeId: "1m",
      parameters: {},
      data: { kind: "building", candle: chartCandle },
      rebuildCandles: () => [chartCandle],
      dataRevision: 2,
      configGeneration: 1,
    });

    assert.deepEqual(historyRequests, [
      {
        providerProfileId: "profile-a",
        request: {
          instrumentId: candle.instrumentId,
          timeframeId: "1m",
          limit: 100_000,
        },
      },
    ]);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].timeframeId, "1m");
    assert.deepEqual(posted[0].data, {
      kind: "rebuild",
      candles: [sourceCandle],
    });
  } finally {
    runtime.dispose();
  }
});

test("provider-backed indicators acquire independent base and per-TA timeframe sources", async () => {
  const posted = [];
  const historyRequests = [];
  const runtime = createBrowserIndicatorRuntime({
    sourceDataService: {
      async requestHistory(providerProfileId, request) {
        historyRequests.push({ providerProfileId, request });
        return [
          {
            ...candle,
            timeframeId: request.timeframeId,
            close: request.timeframeId === "1h" ? 160 : 101,
          },
        ];
      },
      async subscribe() {
        return { unsubscribe: async () => undefined };
      },
    },
    workerFactory() {
      let onmessage = null;
      return {
        get onmessage() {
          return onmessage;
        },
        set onmessage(value) {
          onmessage = value;
        },
        onerror: null,
        postMessage(message) {
          posted.push(message);
          if (message.type !== "sync") return;
          queueMicrotask(() =>
            onmessage?.({
              data: {
                type: "result",
                instanceId: message.instanceId,
                sequence: message.sequence,
                dataRevision: message.dataRevision,
                configGeneration: message.configGeneration,
                result: {
                  kind: "snapshot",
                  snapshot: { points: [], overlays: [], signals: [] },
                },
              },
            }),
          );
        },
        terminate() {
          return undefined;
        },
      };
    },
  });

  try {
    await runtime.sync({
      instanceId: "mtf-instance",
      runtimeEntryUrl:
        "erc-plugin://plugin/erc.indicator.fixture/1.0.0/dist/index.js",
      pluginId: "erc.indicator.fixture",
      definitionId: "erc.indicator.fixture.main",
      providerProfileId: "profile-a",
      instrumentId: candle.instrumentId,
      timeframeId: "1m",
      sourceTimeframeIds: ["1h"],
      parameters: {},
      data: { kind: "building", candle },
      rebuildCandles: () => [candle],
      dataRevision: 2,
      configGeneration: 1,
    });

    assert.deepEqual(
      historyRequests.map(({ request }) => request.timeframeId),
      ["1m", "1h"],
    );
    assert.deepEqual(posted[0].data.candles, [
      { ...candle, timeframeId: "1m", close: 101 },
    ]);
    assert.deepEqual(posted[0].sources, [
      {
        timeframeId: "1h",
        candles: [{ ...candle, timeframeId: "1h", close: 160 }],
      },
    ]);
  } finally {
    runtime.dispose();
  }
});

test("per-TA fallback aliases the active source under the requested timeframe ID", async () => {
  const posted = [];
  const historyRequests = [];
  const runtime = createBrowserIndicatorRuntime({
    sourceDataService: {
      async requestHistory(providerProfileId, request) {
        historyRequests.push({ providerProfileId, request });
        return [{ ...candle, timeframeId: request.timeframeId }];
      },
      async subscribe() {
        return { unsubscribe: async () => undefined };
      },
    },
    workerFactory() {
      let onmessage = null;
      return {
        get onmessage() {
          return onmessage;
        },
        set onmessage(value) {
          onmessage = value;
        },
        onerror: null,
        postMessage(message) {
          posted.push(message);
          if (message.type !== "sync") return;
          queueMicrotask(() =>
            onmessage?.({
              data: {
                type: "result",
                instanceId: message.instanceId,
                sequence: message.sequence,
                dataRevision: message.dataRevision,
                configGeneration: message.configGeneration,
                result: {
                  kind: "snapshot",
                  snapshot: { points: [], overlays: [], signals: [] },
                },
              },
            }),
          );
        },
        terminate() {
          return undefined;
        },
      };
    },
  });

  try {
    await runtime.sync({
      instanceId: "ta-fallback-instance",
      runtimeEntryUrl:
        "erc-plugin://plugin/erc.indicator.fixture/1.0.0/dist/index.js",
      pluginId: "erc.indicator.fixture",
      definitionId: "erc.indicator.fixture.main",
      providerProfileId: "profile-a",
      instrumentId: candle.instrumentId,
      timeframeId: "1m",
      sourceTimeframes: [
        { requestedTimeframeId: "4h", activeTimeframeId: "1m" },
      ],
      parameters: {},
      data: { kind: "building", candle },
      rebuildCandles: () => [candle],
      dataRevision: 2,
      configGeneration: 1,
    });

    assert.deepEqual(
      historyRequests.map(({ request }) => request.timeframeId),
      ["1m"],
    );
    assert.deepEqual(posted[0].sources, [
      {
        timeframeId: "4h",
        activeTimeframeId: "1m",
        candles: [{ ...candle, timeframeId: "1m" }],
      },
    ]);
  } finally {
    runtime.dispose();
  }
});

test("renderer provider bridge adapts history and live events for indicator sources", async () => {
  const historyRequests = [];
  const liveRequests = [];
  const delivered = [];
  const errors = [];
  let listener;
  let unsubscribes = 0;
  const service = createRendererIndicatorSourceDataService({
    async requestProviderHistory(request) {
      historyRequests.push(request);
      return [candle];
    },
    async subscribeProviderData(request, next) {
      liveRequests.push(request);
      listener = next;
      return async () => {
        unsubscribes += 1;
      };
    },
  });

  const history = await service.requestHistory("profile-a", {
    instrumentId: candle.instrumentId,
    timeframeId: candle.timeframeId,
    limit: 100_000,
  });
  const subscription = await service.subscribe(
    "profile-a",
    {
      instrumentId: candle.instrumentId,
      timeframeId: candle.timeframeId,
    },
    {
      onCandles(candles, series) {
        delivered.push({ candles, series });
      },
      onTicks() {
        return undefined;
      },
      onError(code) {
        errors.push(code);
      },
    },
  );
  const series = {
    generation: 1,
    revision: 2,
    previousRevision: 1,
    kind: "incremental",
  };
  listener?.({
    subscriptionId: "fixture-live",
    type: "candles",
    candles: [candle],
    series,
  });
  listener?.({
    subscriptionId: "fixture-live",
    type: "error",
    code: "PROVIDER_OFFLINE",
  });
  await subscription.unsubscribe();

  assert.deepEqual(history, [candle]);
  assert.deepEqual(historyRequests, [
    {
      profileId: "profile-a",
      instrumentId: candle.instrumentId,
      timeframeId: candle.timeframeId,
      limit: 100_000,
    },
  ]);
  assert.deepEqual(liveRequests, [
    {
      profileId: "profile-a",
      instrumentId: candle.instrumentId,
      timeframeId: candle.timeframeId,
    },
  ]);
  assert.deepEqual(delivered, [{ candles: [candle], series }]);
  assert.deepEqual(errors, ["PROVIDER_OFFLINE"]);
  assert.equal(unsubscribes, 1);
});
