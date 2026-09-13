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
        provenance: { kind: "market", candleType: "standard" },
      },
    ]);
  } finally {
    runtime.dispose();
  }
});

test("per-TA acquisition failure releases the already acquired base source", async () => {
  let unsubscribeCount = 0;
  const expected = new Error("higher timeframe unavailable");
  const runtime = createBrowserIndicatorRuntime({
    sourceDataService: {
      async requestHistory(_providerProfileId, request) {
        if (request.timeframeId === "1h") throw expected;
        return [{ ...candle, timeframeId: request.timeframeId }];
      },
      async subscribe() {
        return {
          async unsubscribe() {
            unsubscribeCount += 1;
          },
        };
      },
    },
  });

  try {
    await assert.rejects(
      runtime.sync({
        instanceId: "mtf-acquisition-failure",
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
      }),
      (error) => error === expected,
    );
    assert.equal(unsubscribeCount, 1);
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
        provenance: { kind: "market", candleType: "standard" },
      },
    ]);
  } finally {
    runtime.dispose();
  }
});

test("provider-backed runtime acquires and rebuilds from the selected Heikin Ashi source", async () => {
  const posted = [];
  const raw = {
    ...candle,
    open: 10,
    high: 14,
    low: 8,
    close: 12,
  };
  const runtime = createBrowserIndicatorRuntime({
    sourceDataService: {
      async requestHistory() {
        return [raw];
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
      instanceId: "ha-runtime-instance",
      runtimeEntryUrl:
        "erc-plugin://plugin/erc.indicator.fixture/1.0.0/dist/index.js",
      pluginId: "erc.indicator.fixture",
      definitionId: "erc.indicator.fixture.main",
      providerProfileId: "profile-a",
      instrumentId: candle.instrumentId,
      timeframeId: "1m",
      candleType: "heikin-ashi",
      parameters: {},
      data: { kind: "building", candle: raw },
      rebuildCandles: () => [raw],
      dataRevision: 2,
      configGeneration: 1,
    });

    assert.deepEqual(posted[0].data.candles, [
      { ...raw, open: 11, high: 14, low: 8, close: 11 },
    ]);
    assert.deepEqual(posted[0].sourceProvenance, {
      kind: "synthetic",
      candleType: "heikin-ashi",
    });
  } finally {
    runtime.dispose();
  }
});

test("provider-backed indicators keep building deltas while the source revision is stable", async () => {
  const posted = [];
  const sourceCandle = { ...candle, timeframeId: "1m", close: 101 };
  const runtime = createBrowserIndicatorRuntime({
    sourceDataService: {
      async requestHistory() {
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

  const sync = (dataRevision, close) =>
    runtime.sync({
      instanceId: "stable-source-instance",
      runtimeEntryUrl:
        "erc-plugin://plugin/erc.indicator.fixture/1.0.0/dist/index.js",
      pluginId: "erc.indicator.fixture",
      definitionId: "erc.indicator.fixture.main",
      providerProfileId: "profile-a",
      instrumentId: candle.instrumentId,
      timeframeId: "1m",
      parameters: {},
      data: {
        kind: "building",
        candle: { ...sourceCandle, close },
      },
      rebuildCandles: () => [sourceCandle],
      dataRevision,
      configGeneration: 1,
    });

  try {
    await sync(1, 101);
    await sync(2, 102);
    assert.equal(posted.length, 2);
    assert.equal(posted[0].data.kind, "rebuild");
    assert.equal(posted[1].data.kind, "building");
    assert.equal(posted[1].data.candle.close, 102);
  } finally {
    runtime.dispose();
  }
});

test("provider-backed indicators rebuild when the source revision changes", async () => {
  const posted = [];
  let sourceSink;
  const sourceCandle = { ...candle, timeframeId: "1m", close: 101 };
  const runtime = createBrowserIndicatorRuntime({
    sourceDataService: {
      async requestHistory() {
        return [sourceCandle];
      },
      async subscribe(_profileId, _request, sink) {
        sourceSink = sink;
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
  const sync = (dataRevision, close) =>
    runtime.sync({
      instanceId: "changed-source-instance",
      runtimeEntryUrl:
        "erc-plugin://plugin/erc.indicator.fixture/1.0.0/dist/index.js",
      pluginId: "erc.indicator.fixture",
      definitionId: "erc.indicator.fixture.main",
      providerProfileId: "profile-a",
      instrumentId: candle.instrumentId,
      timeframeId: "1m",
      parameters: {},
      data: {
        kind: "building",
        candle: { ...sourceCandle, close },
      },
      rebuildCandles: () => [sourceCandle],
      dataRevision,
      configGeneration: 1,
    });

  try {
    await sync(1, 101);
    const revised = { ...sourceCandle, close: 105 };
    sourceSink.onCandles([revised], {
      generation: 0,
      revision: 1,
      previousRevision: 0,
      kind: "incremental",
    });
    await sync(2, 105);
    assert.equal(posted.length, 2);
    assert.deepEqual(posted[1].data, {
      kind: "rebuild",
      candles: [revised],
    });
  } finally {
    runtime.dispose();
  }
});

test("concurrent source acquisition for one instance retains only one releasable lease", async () => {
  let releaseHistory;
  const historyGate = new Promise((resolve) => {
    releaseHistory = resolve;
  });
  let unsubscribes = 0;
  const runtime = createBrowserIndicatorRuntime({
    sourceDataService: {
      async requestHistory() {
        await historyGate;
        return [candle];
      },
      async subscribe() {
        return {
          async unsubscribe() {
            unsubscribes += 1;
          },
        };
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
  const request = (dataRevision) => ({
    instanceId: "concurrent-source-instance",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.fixture/1.0.0/dist/index.js",
    pluginId: "erc.indicator.fixture",
    definitionId: "erc.indicator.fixture.main",
    providerProfileId: "profile-a",
    instrumentId: candle.instrumentId,
    timeframeId: "1m",
    parameters: {},
    data: { kind: "building", candle },
    rebuildCandles: () => [candle],
    dataRevision,
    configGeneration: 1,
  });

  try {
    const first = runtime.sync(request(1));
    const second = runtime.sync(request(1));
    await Promise.resolve();
    releaseHistory();
    await Promise.all([first, second]);
    runtime.disposeInstance("concurrent-source-instance");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(unsubscribes, 1);
  } finally {
    runtime.dispose();
  }
});

test("disposeInstance fences a pending provider source acquisition and releases its late lease", async () => {
  let releaseHistory;
  const historyGate = new Promise((resolve) => {
    releaseHistory = resolve;
  });
  let signalHistoryStarted;
  const historyStarted = new Promise((resolve) => {
    signalHistoryStarted = resolve;
  });
  let unsubscribes = 0;
  let workerPosts = 0;
  const runtime = createBrowserIndicatorRuntime({
    sourceDataService: {
      async requestHistory() {
        signalHistoryStarted();
        await historyGate;
        return [candle];
      },
      async subscribe() {
        return {
          async unsubscribe() {
            unsubscribes += 1;
          },
        };
      },
    },
    workerFactory() {
      return {
        postMessage() {
          workerPosts += 1;
        },
        terminate() {
          return undefined;
        },
        set onmessage(listener) {
          void listener;
        },
        set onerror(listener) {
          void listener;
        },
      };
    },
  });
  try {
    const pending = runtime.sync({
      instanceId: "disposed-source-instance",
      runtimeEntryUrl:
        "erc-plugin://plugin/erc.indicator.fixture/1.0.0/dist/index.js",
      pluginId: "erc.indicator.fixture",
      definitionId: "erc.indicator.fixture.main",
      parameters: {},
      dataRevision: 1,
      configGeneration: 1,
      providerProfileId: "profile-1",
      instrumentId: candle.instrumentId,
      timeframeId: candle.timeframeId,
      data: { kind: "rebuild", candles: [candle] },
      rebuildCandles: () => [candle],
    });
    await historyStarted;
    runtime.disposeInstance("disposed-source-instance");
    releaseHistory();
    await assert.rejects(pending, /source acquisition was superseded/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(unsubscribes, 1);
    assert.equal(workerPosts, 0);
  } finally {
    releaseHistory?.();
    runtime.dispose();
  }
});

test("disposeInstance rejects provider source work that was queued before disposal", async () => {
  let releaseHistory;
  const historyGate = new Promise((resolve) => {
    releaseHistory = resolve;
  });
  let signalHistoryStarted;
  const historyStarted = new Promise((resolve) => {
    signalHistoryStarted = resolve;
  });
  let historyCalls = 0;
  let unsubscribes = 0;
  let workerPosts = 0;
  const runtime = createBrowserIndicatorRuntime({
    sourceDataService: {
      async requestHistory() {
        historyCalls += 1;
        signalHistoryStarted();
        await historyGate;
        return [candle];
      },
      async subscribe() {
        return {
          async unsubscribe() {
            unsubscribes += 1;
          },
        };
      },
    },
    workerFactory() {
      return {
        postMessage() {
          workerPosts += 1;
        },
        terminate() {
          return undefined;
        },
        set onmessage(listener) {
          void listener;
        },
        set onerror(listener) {
          void listener;
        },
      };
    },
  });
  const request = (dataRevision) => ({
    instanceId: "queued-dispose-instance",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.fixture/1.0.0/dist/index.js",
    pluginId: "erc.indicator.fixture",
    definitionId: "erc.indicator.fixture.main",
    parameters: {},
    dataRevision,
    configGeneration: 1,
    providerProfileId: "profile-1",
    instrumentId: candle.instrumentId,
    timeframeId: candle.timeframeId,
    data: { kind: "rebuild", candles: [candle] },
    rebuildCandles: () => [candle],
  });
  try {
    const first = runtime.sync(request(1));
    const second = runtime.sync(request(2));
    await historyStarted;
    runtime.disposeInstance("queued-dispose-instance");
    releaseHistory();
    const results = await Promise.allSettled([first, second]);
    assert.deepEqual(
      results.map(({ status }) => status),
      ["rejected", "rejected"],
    );
    for (const result of results) {
      if (result.status === "rejected")
        assert.match(
          result.reason.message,
          /source acquisition was superseded/,
        );
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(historyCalls, 1);
    assert.equal(unsubscribes, 1);
    assert.equal(workerPosts, 0);
  } finally {
    releaseHistory?.();
    runtime.dispose();
  }
});

test("disposeInstance fences worker dispatch while obsolete source release is pending", async () => {
  let releaseOldSource;
  const oldSourceGate = new Promise((resolve) => {
    releaseOldSource = resolve;
  });
  let signalOldRelease;
  const oldReleaseStarted = new Promise((resolve) => {
    signalOldRelease = resolve;
  });
  const unsubscribes = new Map();
  let workerSyncPosts = 0;
  const runtime = createBrowserIndicatorRuntime({
    sourceDataService: {
      async requestHistory(_profileId, request) {
        return [{ ...candle, timeframeId: request.timeframeId }];
      },
      async subscribe(_profileId, request) {
        return {
          async unsubscribe() {
            unsubscribes.set(
              request.timeframeId,
              (unsubscribes.get(request.timeframeId) ?? 0) + 1,
            );
            if (request.timeframeId === "1m") {
              signalOldRelease();
              await oldSourceGate;
            }
          },
        };
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
          if (message.type !== "sync") return;
          workerSyncPosts += 1;
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
  const request = (timeframeId, dataRevision, sourceTimeframeIds = []) => {
    const sourceCandle = { ...candle, timeframeId };
    return {
      instanceId: "release-dispose-instance",
      runtimeEntryUrl:
        "erc-plugin://plugin/erc.indicator.fixture/1.0.0/dist/index.js",
      pluginId: "erc.indicator.fixture",
      definitionId: "erc.indicator.fixture.main",
      parameters: {},
      dataRevision,
      configGeneration: 1,
      providerProfileId: "profile-1",
      instrumentId: candle.instrumentId,
      timeframeId,
      sourceTimeframeIds,
      data: { kind: "rebuild", candles: [sourceCandle] },
      rebuildCandles: () => [sourceCandle],
    };
  };
  try {
    await runtime.sync(request("1m", 1, ["5m", "15m"]));
    assert.equal(workerSyncPosts, 1);

    const pending = runtime.sync(request("1h", 2));
    await oldReleaseStarted;
    runtime.disposeInstance("release-dispose-instance");
    releaseOldSource();

    await assert.rejects(pending, /source acquisition was superseded/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(workerSyncPosts, 1);
    assert.equal(unsubscribes.get("1m"), 1);
    assert.equal(unsubscribes.get("5m"), 1);
    assert.equal(unsubscribes.get("15m"), 1);
    assert.equal(unsubscribes.get("1h"), 1);
  } finally {
    releaseOldSource?.();
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
