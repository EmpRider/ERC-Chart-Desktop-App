import assert from "node:assert/strict";
import test from "node:test";
import { createProviderDataService } from "../dist/index.js";

function createSink() {
  const candles = [];
  const ticks = [];
  const errors = [];
  const series = [];
  return {
    candles,
    ticks,
    errors,
    series,
    sink: {
      onCandles(value, change) {
        candles.push(...value);
        series.push(change);
      },
      onTicks(value) {
        ticks.push(...value);
      },
      onError(code) {
        errors.push(code);
      },
    },
  };
}

function createUpstream() {
  const subscriptions = [];
  const calls = { capabilities: [], instruments: [], history: [] };
  return {
    calls,
    subscriptions,
    upstream: {
      async getCapabilities(providerProfileId) {
        calls.capabilities.push(providerProfileId);
        return {
          instruments: true,
          nativeTimeframes: ["1m"],
          liveData: true,
          derivedTimeframes: true,
        };
      },
      async getInstruments(providerProfileId) {
        calls.instruments.push(providerProfileId);
        return [{ id: "BTCUSD", symbol: "BTCUSD", name: "Bitcoin / USD" }];
      },
      async requestHistory(providerProfileId, request) {
        calls.history.push({ providerProfileId, request });
        return [
          {
            instrumentId: request.instrumentId,
            timeframeId: request.timeframeId,
            openTimeMs: 1_000,
            open: 10,
            high: 12,
            low: 9,
            close: 11,
          },
        ];
      },
      async subscribe(providerProfileId, request, sink) {
        const record = {
          providerProfileId,
          request,
          sink,
          unsubscribeCount: 0,
        };
        subscriptions.push(record);
        return {
          async unsubscribe() {
            record.unsubscribeCount += 1;
          },
        };
      },
    },
  };
}

const request = { instrumentId: "BTCUSD", timeframeId: "1m" };

test("pagination publishes revision continuity without rebuilding the live chart, while corrections still rebuild", async () => {
  const fixture = createUpstream();
  const candle = (openTimeMs, close = 11) => ({
    ...request,
    openTimeMs,
    open: 10,
    high: 20,
    low: 9,
    close,
  });
  let history = [candle(120_000), candle(180_000)];
  fixture.upstream.requestHistory = async () => history;
  const service = createProviderDataService(fixture.upstream, {
    now: () => 190_000,
  });
  await service.requestHistory("profile-a", request);
  const sink = createSink();
  const other = createSink();
  await service.subscribe("profile-a", request, sink.sink);
  await service.subscribe("profile-a", request, other.sink);
  fixture.subscriptions[0].sink.onCandles([candle(180_000, 12)]);
  const before = sink.series.at(-1);
  history = [candle(0), candle(60_000)];
  const page = await service.requestHistory("profile-a", {
    ...request,
    fromMs: 0,
    toMs: 119_999,
    limit: 2,
  });
  assert.deepEqual(
    page.map((bar) => bar.openTimeMs),
    [0, 60_000],
  );
  const pagination = sink.series.at(-1);
  assert.equal(pagination.kind, "incremental");
  assert.equal(pagination.previousRevision, before.revision);
  assert.ok(pagination.revision > before.revision);
  assert.deepEqual(sink.candles.at(-1), candle(180_000, 12));
  assert.deepEqual(other.series.at(-1), pagination);
  fixture.subscriptions[0].sink.onCandles([candle(180_000, 13)]);
  assert.equal(sink.series.at(-1).kind, "incremental");
  assert.equal(sink.series.at(-1).previousRevision, pagination.revision);

  history = [candle(60_000, 15)];
  await service.requestHistory("profile-a", {
    ...request,
    fromMs: 60_000,
    toMs: 119_999,
    limit: 1,
  });
  assert.equal(sink.series.at(-1).kind, "rebuild");
  assert.equal(sink.candles.slice(-4)[1].close, 15);
  await service.shutdown();
});

test("forwards discovery/capabilities/history and multiplexes compatible live demand", async () => {
  const fixture = createUpstream();
  const service = createProviderDataService(fixture.upstream);

  assert.equal((await service.getCapabilities("profile-a")).liveData, true);
  assert.deepEqual(await service.getInstruments("profile-a"), [
    { id: "BTCUSD", symbol: "BTCUSD", name: "Bitcoin / USD" },
  ]);
  assert.equal(
    (await service.requestHistory("profile-a", request))[0].close,
    11,
  );

  const first = createSink();
  const second = createSink();
  const firstHandle = await service.subscribe("profile-a", request, first.sink);
  const secondHandle = await service.subscribe(
    "profile-a",
    request,
    second.sink,
  );

  assert.equal(fixture.subscriptions.length, 1);
  const upstream = fixture.subscriptions[0];
  upstream.sink.onTicks([
    { instrumentId: "BTCUSD", timestampMs: 2_000, price: 12 },
  ]);
  upstream.sink.onCandles([
    {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: 1_000,
      open: 10,
      high: 13,
      low: 9,
      close: 12,
    },
  ]);
  upstream.sink.onError("PROVIDER_DEGRADED");

  assert.equal(first.ticks.length, 1);
  assert.equal(second.ticks.length, 1);
  assert.equal(first.candles.length, 1);
  assert.equal(second.candles.length, 1);
  assert.deepEqual(first.errors, ["PROVIDER_DEGRADED"]);
  assert.deepEqual(second.errors, ["PROVIDER_DEGRADED"]);

  await firstHandle.unsubscribe();
  assert.equal(upstream.unsubscribeCount, 0);
  await secondHandle.unsubscribe();
  assert.equal(upstream.unsubscribeCount, 1);
  await secondHandle.unsubscribe();
  assert.equal(upstream.unsubscribeCount, 1);

  assert.deepEqual(fixture.calls.capabilities, ["profile-a"]);
  assert.deepEqual(fixture.calls.instruments, ["profile-a"]);
  assert.equal(fixture.calls.history.length, 1);
});

test("publishes canonical rebuild metadata when live data corrects finalized history", async () => {
  const fixture = createUpstream();
  const service = createProviderDataService(fixture.upstream);
  await service.requestHistory("profile-a", request);
  const target = createSink();
  const handle = await service.subscribe("profile-a", request, target.sink);
  const upstream = fixture.subscriptions[0];

  upstream.sink.onCandles([
    {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: 1_000,
      open: 10,
      high: 12,
      low: 9,
      close: 10.5,
    },
  ]);

  assert.equal(target.candles.length, 1);
  assert.equal(target.series.length, 1);
  assert.equal(target.series[0].kind, "rebuild");
  assert.equal(target.series[0].dirtyFromOpenTimeMs, 1_000);
  assert.equal(target.series[0].revision > 1, true);
  const snapshot = await service.seriesSnapshot("profile-a", request);
  assert.equal(snapshot.close[snapshot.close.length - 1], 10.5);

  await handle.unsubscribe();
  await service.shutdown();
});

test("invalidates and restores only the affected provider profile while retaining demand", async () => {
  const fixture = createUpstream();
  const service = createProviderDataService(fixture.upstream);
  const first = createSink();
  const second = createSink();

  const firstHandle = await service.subscribe("profile-a", request, first.sink);
  const secondHandle = await service.subscribe(
    "profile-b",
    request,
    second.sink,
  );
  const staleProfileA = fixture.subscriptions[0];
  const profileB = fixture.subscriptions[1];

  await service.invalidateProfile("profile-a");
  assert.equal(staleProfileA.unsubscribeCount, 1);
  assert.equal(profileB.unsubscribeCount, 0);

  staleProfileA.sink.onTicks([
    { instrumentId: "BTCUSD", timestampMs: 3_000, price: 13 },
  ]);
  assert.equal(first.ticks.length, 0);

  await service.restoreProfile("profile-a");
  assert.equal(fixture.subscriptions.length, 3);
  const restoredProfileA = fixture.subscriptions[2];
  restoredProfileA.sink.onTicks([
    { instrumentId: "BTCUSD", timestampMs: 4_000, price: 14 },
  ]);
  profileB.sink.onTicks([
    { instrumentId: "BTCUSD", timestampMs: 4_001, price: 15 },
  ]);
  assert.equal(first.ticks[0].price, 14);
  assert.equal(second.ticks[0].price, 15);

  await firstHandle.unsubscribe();
  await secondHandle.unsubscribe();
  assert.equal(restoredProfileA.unsubscribeCount, 1);
  assert.equal(profileB.unsubscribeCount, 1);
});

test("tick-tail overflow during pending history preserves every processed tick and canonical revision", async () => {
  const fixture = createUpstream();
  const history = deferred();
  const started = deferred();
  fixture.upstream.requestHistory = () => {
    started.resolve();
    return history.promise;
  };
  const service = createProviderDataService(fixture.upstream, {
    now: () => 120_000,
    tickBufferCapacity: 2,
  });
  const target = createSink();
  const handle = await service.subscribe("profile-a", request, target.sink);
  try {
    const pending = service.requestHistory("profile-a", request);
    await started.promise;
    const ticks = Array.from({ length: 10 }, (_, index) => ({
      instrumentId: "BTCUSD",
      timestampMs: 120_000 + index,
      price: 10 + index,
      volume: 1,
    }));
    fixture.subscriptions[0].sink.onTicks(ticks);
    history.resolve([
      {
        ...request,
        openTimeMs: 120_000,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
      },
    ]);
    const candles = await pending;
    assert.deepEqual(candles.at(-1), {
      ...request,
      openTimeMs: 120_000,
      open: 10,
      high: 19,
      low: 10,
      close: 19,
      volume: 10,
    });
    assert.deepEqual(target.ticks, ticks);
    const snapshot = await service.seriesSnapshot("profile-a", request);
    assert.equal(snapshot.revision, target.series.at(-1).revision);
    assert.equal(snapshot.generation, target.series.at(-1).generation);
    assert.deepEqual(target.errors, []);
  } finally {
    await handle.unsubscribe();
    await service.shutdown();
  }
});

test("unsubscribe during history rejects late hydration without mutating a replacement demand", async () => {
  const fixture = createUpstream();
  const history = deferred();
  const started = deferred();
  fixture.upstream.requestHistory = () => {
    started.resolve();
    return history.promise;
  };
  const service = createProviderDataService(fixture.upstream);
  const first = createSink();
  const old = await service.subscribe("profile-a", request, first.sink);
  const pending = service.requestHistory("profile-a", request);
  const rejected = assert.rejects(pending, /invalidated/u);
  await started.promise;
  await old.unsubscribe();
  const replacement = createSink();
  const current = await service.subscribe(
    "profile-a",
    request,
    replacement.sink,
  );
  try {
    await old.unsubscribe();
    history.resolve([
      { ...request, openTimeMs: 0, open: 10, high: 10, low: 10, close: 10 },
    ]);
    await rejected;
    fixture.subscriptions[0].sink.onTicks([
      { instrumentId: "BTCUSD", timestampMs: 120_000, price: 999 },
    ]);
    fixture.subscriptions[1].sink.onTicks([
      { instrumentId: "BTCUSD", timestampMs: 120_000, price: 12 },
    ]);
    assert.deepEqual(first.candles, []);
    assert.equal(replacement.candles.at(-1).close, 12);
    assert.equal(fixture.subscriptions[1].unsubscribeCount, 0);
  } finally {
    await current.unsubscribe();
    await service.shutdown();
  }
  assert.deepEqual(
    fixture.subscriptions.map(({ unsubscribeCount }) => unsubscribeCount),
    [1, 1],
  );
});

test("shutdown releases each active upstream subscription once", async () => {
  const fixture = createUpstream();
  const service = createProviderDataService(fixture.upstream);
  await service.subscribe("profile-a", request, createSink().sink);
  await service.subscribe(
    "profile-a",
    { instrumentId: "ETHUSD", timeframeId: "1m" },
    createSink().sink,
  );

  await service.shutdown();
  assert.deepEqual(
    fixture.subscriptions.map((subscription) => subscription.unsubscribeCount),
    [1, 1],
  );
  await service.shutdown();
  assert.deepEqual(
    fixture.subscriptions.map((subscription) => subscription.unsubscribeCount),
    [1, 1],
  );
});

test("counts repeated subscriptions independently even when they reuse the same sink", async () => {
  const fixture = createUpstream();
  const service = createProviderDataService(fixture.upstream);
  const shared = createSink();

  const first = await service.subscribe("profile-a", request, shared.sink);
  const second = await service.subscribe("profile-a", request, shared.sink);
  assert.equal(fixture.subscriptions.length, 1);

  fixture.subscriptions[0].sink.onTicks([
    { instrumentId: "BTCUSD", timestampMs: 5_000, price: 16 },
  ]);
  assert.equal(shared.ticks.length, 2);

  await first.unsubscribe();
  assert.equal(fixture.subscriptions[0].unsubscribeCount, 0);
  fixture.subscriptions[0].sink.onTicks([
    { instrumentId: "BTCUSD", timestampMs: 5_001, price: 17 },
  ]);
  assert.equal(shared.ticks.length, 3);

  await second.unsubscribe();
  assert.equal(fixture.subscriptions[0].unsubscribeCount, 1);
});

test("ECDD-96 acceptance: rejects malformed or mismatched provider market data before delivery", async () => {
  const fixture = createUpstream();
  fixture.upstream.requestHistory = async () => [
    {
      instrumentId: "ETHUSD",
      timeframeId: "1m",
      openTimeMs: 1_000,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
    },
  ];
  const service = createProviderDataService(fixture.upstream);

  await assert.rejects(
    service.requestHistory("profile-a", request),
    /identity does not match the requested series/,
  );

  const target = createSink();
  const handle = await service.subscribe("profile-a", request, target.sink);
  const upstream = fixture.subscriptions[0];
  upstream.sink.onCandles([
    {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: 2_000,
      open: 10,
      high: Number.NaN,
      low: 9,
      close: 11,
    },
  ]);
  upstream.sink.onTicks([
    { instrumentId: "ETHUSD", timestampMs: 2_001, price: 12 },
  ]);

  assert.equal(target.candles.length, 0);
  assert.equal(target.ticks.length, 0);
  assert.deepEqual(target.errors, [
    "PROVIDER_INVALID_CANDLE",
    "PROVIDER_INVALID_TICK",
  ]);

  await handle.unsubscribe();
});

test("ECDD-94 acceptance: a profile loads history and updates a building candle", async () => {
  const fixture = createUpstream();
  const service = createProviderDataService(fixture.upstream, {
    now: () => 120_500,
    tickBufferCapacity: 2,
  });

  await service.requestHistory("profile-a", {
    ...request,
    fromMs: 60_000,
    toMs: 120_000,
  });
  const first = createSink();
  const second = createSink();
  const firstHandle = await service.subscribe("profile-a", request, first.sink);
  const secondHandle = await service.subscribe(
    "profile-a",
    request,
    second.sink,
  );

  assert.equal(fixture.subscriptions.length, 1);
  fixture.subscriptions[0].sink.onTicks([
    { instrumentId: "BTCUSD", timestampMs: 120_100, price: 12 },
    { instrumentId: "BTCUSD", timestampMs: 120_200, price: 13 },
    { instrumentId: "BTCUSD", timestampMs: 120_300, price: 14 },
  ]);

  const snapshot = await service.seriesSnapshot("profile-a", request);
  assert.equal(snapshot.building.openTimeMs, 120_000);
  assert.equal(snapshot.building.open, 12);
  assert.equal(snapshot.building.close, 14);
  assert.equal(first.candles.length, 3);
  assert.equal(second.candles.length, 3);
  assert.equal(first.candles.at(-1).openTimeMs, 120_000);
  assert.equal(first.candles.at(-1).close, 14);
  assert.deepEqual(
    service
      .tickSnapshot("profile-a", "BTCUSD")
      .map(({ timestampMs }) => timestampMs),
    [120_200, 120_300],
  );
  assert.equal(first.ticks.length, 3);
  assert.equal(second.ticks.length, 3);

  await firstHandle.unsubscribe();
  await secondHandle.unsubscribe();
});

test("derives declared target history and live state from one native provider feed", async () => {
  const fixture = createUpstream();
  fixture.upstream.getCapabilities = async () => ({
    instruments: true,
    nativeTimeframes: ["1m"],
    liveData: true,
    derivedTimeframes: true,
    derivedTimeframeIds: ["3m"],
    timeframes: [
      {
        id: "1m",
        seconds: 60,
        historical: true,
        live: true,
        native: true,
        alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
      },
      {
        id: "3m",
        seconds: 180,
        historical: true,
        live: true,
        native: false,
        derivedFromTimeframeId: "1m",
        alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
      },
    ],
  });
  fixture.upstream.requestHistory = async (
    providerProfileId,
    historyRequest,
  ) => {
    fixture.calls.history.push({ providerProfileId, request: historyRequest });
    return [0, 1, 2, 3, 4, 5].map((index) => ({
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: index * 60_000,
      open: 10 + index,
      high: 12 + index,
      low: 9 + index,
      close: 11 + index,
    }));
  };
  const service = createProviderDataService(fixture.upstream, {
    now: () => 390_000,
  });
  const derivedRequest = {
    instrumentId: "BTCUSD",
    timeframeId: "3m",
    fromMs: 0,
    toMs: 360_000,
    limit: 2,
  };

  const history = await service.requestHistory("profile-a", derivedRequest);
  assert.equal(fixture.calls.history[0].request.timeframeId, "1m");
  assert.equal(fixture.calls.history[0].request.limit, 9);
  assert.deepEqual(
    history.map(({ timeframeId, openTimeMs, open, high, low, close }) => ({
      timeframeId,
      openTimeMs,
      open,
      high,
      low,
      close,
    })),
    [
      {
        timeframeId: "3m",
        openTimeMs: 0,
        open: 10,
        high: 14,
        low: 9,
        close: 13,
      },
      {
        timeframeId: "3m",
        openTimeMs: 180_000,
        open: 13,
        high: 17,
        low: 12,
        close: 16,
      },
    ],
  );

  const sink = createSink();
  const handle = await service.subscribe(
    "profile-a",
    { instrumentId: "BTCUSD", timeframeId: "3m" },
    sink.sink,
  );
  assert.equal(fixture.subscriptions[0].request.timeframeId, "1m");
  fixture.subscriptions[0].sink.onTicks([
    { instrumentId: "BTCUSD", timestampMs: 360_100, price: 20 },
    { instrumentId: "BTCUSD", timestampMs: 360_200, price: 22 },
  ]);
  const snapshot = await service.seriesSnapshot("profile-a", {
    instrumentId: "BTCUSD",
    timeframeId: "3m",
  });
  assert.equal(snapshot.building.openTimeMs, 360_000);
  assert.equal(snapshot.building.open, 20);
  assert.equal(snapshot.building.close, 22);
  assert.equal(sink.ticks.length, 2);

  await handle.unsubscribe();
});

test("ECDD-95 acceptance: reconnect repairs a deliberately created gap", async () => {
  const fixture = createUpstream();
  let repairing = false;
  fixture.upstream.requestHistory = async (
    providerProfileId,
    historyRequest,
  ) => {
    fixture.calls.history.push({ providerProfileId, request: historyRequest });
    if (!repairing) {
      return [0, 120_000].map((openTimeMs, index) => ({
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        openTimeMs,
        open: 10 + index,
        high: 12 + index,
        low: 9 + index,
        close: 11 + index,
      }));
    }
    return [
      {
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        openTimeMs: historyRequest.fromMs,
        open: 20,
        high: 22,
        low: 19,
        close: 21,
      },
    ];
  };
  const service = createProviderDataService(fixture.upstream, {
    now: () => 180_500,
  });
  const sink = createSink();

  await service.requestHistory("profile-a", {
    ...request,
    fromMs: 0,
    toMs: 120_000,
  });
  const handle = await service.subscribe("profile-a", request, sink.sink);
  await service.invalidateProfile("profile-a");
  repairing = true;
  await service.restoreProfile("profile-a");

  const repairRequests = fixture.calls.history.slice(1).map(({ request }) => ({
    fromMs: request.fromMs,
    toMs: request.toMs,
  }));
  assert.deepEqual(repairRequests, [
    { fromMs: 60_000, toMs: 60_000 },
    { fromMs: 180_000, toMs: 180_000 },
  ]);
  assert.equal(fixture.subscriptions.length, 2);
  const snapshot = await service.seriesSnapshot("profile-a", request);
  assert.deepEqual([...snapshot.timeMs], [0, 60_000, 120_000]);
  assert.equal(snapshot.building.openTimeMs, 180_000);
  assert.equal(sink.series.at(-1).kind, "rebuild");
  assert.equal(sink.series.at(-1).dirtyFromOpenTimeMs, 60_000);
  assert.deepEqual(
    sink.candles.slice(-4).map(({ openTimeMs }) => openTimeMs),
    [0, 60_000, 120_000, 180_000],
  );

  await handle.unsubscribe();
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("concurrent demand shares one upstream and releases it once", async () => {
  const fixture = createUpstream();
  const capabilities = deferred();
  fixture.upstream.getCapabilities = async () => capabilities.promise;
  const service = createProviderDataService(fixture.upstream);
  const firstPending = service.subscribe(
    "profile-a",
    request,
    createSink().sink,
  );
  const secondPending = service.subscribe(
    "profile-a",
    request,
    createSink().sink,
  );

  capabilities.resolve({
    instruments: true,
    nativeTimeframes: ["1m"],
    liveData: true,
    derivedTimeframes: true,
  });
  const handles = await Promise.all([firstPending, secondPending]);

  assert.equal(fixture.subscriptions.length, 1);
  await Promise.all(handles.map((handle) => handle.unsubscribe()));
  assert.deepEqual(
    fixture.subscriptions.map((subscription) => subscription.unsubscribeCount),
    [1],
  );
  await service.shutdown();
});

test("accepted native tick fans out once to every active timeframe", async () => {
  const fixture = createUpstream();
  fixture.upstream.getCapabilities = async () => ({
    instruments: true,
    nativeTimeframes: ["1m", "5m"],
    liveData: true,
    derivedTimeframes: false,
    timeframes: [
      {
        id: "1m",
        seconds: 60,
        historical: true,
        live: true,
        native: true,
        alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
      },
      {
        id: "5m",
        seconds: 300,
        historical: true,
        live: true,
        native: true,
        alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
      },
    ],
  });
  const service = createProviderDataService(fixture.upstream);
  const oneMinute = createSink();
  const fiveMinute = createSink();
  const handles = await Promise.all([
    service.subscribe(
      "profile-a",
      { instrumentId: "BTCUSD", timeframeId: "1m" },
      oneMinute.sink,
    ),
    service.subscribe(
      "profile-a",
      { instrumentId: "BTCUSD", timeframeId: "5m" },
      fiveMinute.sink,
    ),
  ]);
  assert.equal(fixture.subscriptions.length, 2);

  const tick = [{ instrumentId: "BTCUSD", timestampMs: 100_000, price: 12 }];
  fixture.subscriptions[0].sink.onTicks(tick);
  fixture.subscriptions[1].sink.onTicks(tick);

  assert.equal(oneMinute.candles.length, 1);
  assert.equal(fiveMinute.candles.length, 1);
  assert.equal(oneMinute.ticks.length, 1);
  assert.equal(fiveMinute.ticks.length, 1);

  await Promise.all(handles.map((handle) => handle.unsubscribe()));
  await service.shutdown();
});

test("derived live candle retains native history constituents", async () => {
  const fixture = createUpstream();
  fixture.upstream.getCapabilities = async () => ({
    instruments: true,
    nativeTimeframes: ["1m"],
    liveData: true,
    derivedTimeframes: true,
    derivedTimeframeIds: ["5m"],
    timeframes: [
      {
        id: "1m",
        seconds: 60,
        historical: true,
        live: true,
        native: true,
        alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
      },
      {
        id: "5m",
        seconds: 300,
        historical: true,
        live: true,
        native: false,
        derivedFromTimeframeId: "1m",
        alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
      },
    ],
  });
  fixture.upstream.requestHistory = async () => [
    {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: 0,
      open: 10,
      high: 20,
      low: 5,
      close: 11,
      volume: 2,
    },
    {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: 60_000,
      open: 11,
      high: 12,
      low: 9,
      close: 12,
      volume: 3,
    },
  ];
  const service = createProviderDataService(fixture.upstream, {
    now: () => 120_000,
  });
  const targetRequest = { instrumentId: "BTCUSD", timeframeId: "5m" };
  await service.requestHistory("profile-a", targetRequest);
  const target = createSink();
  const handle = await service.subscribe(
    "profile-a",
    targetRequest,
    target.sink,
  );

  fixture.subscriptions[0].sink.onCandles([
    {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: 120_000,
      open: 12,
      high: 13,
      low: 11,
      close: 13,
      volume: 4,
    },
  ]);

  assert.deepEqual(target.candles.at(-1), {
    instrumentId: "BTCUSD",
    timeframeId: "5m",
    openTimeMs: 0,
    open: 10,
    high: 20,
    low: 5,
    close: 13,
    volume: 9,
  });
  await handle.unsubscribe();
  await service.shutdown();
});

test("tick candle uses provider nonzero alignment origin", async () => {
  const fixture = createUpstream();
  fixture.upstream.getCapabilities = async () => ({
    instruments: true,
    nativeTimeframes: ["1m"],
    liveData: true,
    derivedTimeframes: false,
    timeframes: [
      {
        id: "1m",
        seconds: 60,
        historical: true,
        live: true,
        native: true,
        alignment: { mode: "epoch", originMs: 30_000, timeZone: "UTC" },
      },
    ],
  });
  const service = createProviderDataService(fixture.upstream);
  const target = createSink();
  const handle = await service.subscribe("profile-a", request, target.sink);
  fixture.subscriptions[0].sink.onTicks([
    { instrumentId: "BTCUSD", timestampMs: 100_000, price: 12 },
  ]);

  const snapshot = await service.seriesSnapshot("profile-a", request);
  assert.equal(snapshot.building.openTimeMs, 90_000);
  await handle.unsubscribe();
  await service.shutdown();
});

test("shutdown fences an acquisition waiting on capabilities", async () => {
  const fixture = createUpstream();
  const capabilities = deferred();
  fixture.upstream.getCapabilities = async () => capabilities.promise;
  const service = createProviderDataService(fixture.upstream);

  const pending = service.subscribe("profile-a", request, createSink().sink);
  const stopping = service.shutdown();
  capabilities.resolve({
    instruments: true,
    nativeTimeframes: ["1m"],
    liveData: true,
    derivedTimeframes: true,
  });

  await assert.rejects(pending, /invalidated|shut down/i);
  await stopping;
  assert.equal(fixture.subscriptions.length, 0);
});

test("profile invalidation rejects history that resolves from the old epoch", async () => {
  const fixture = createUpstream();
  const history = deferred();
  const historyStarted = deferred();
  fixture.upstream.requestHistory = async () => {
    historyStarted.resolve();
    return history.promise;
  };
  const service = createProviderDataService(fixture.upstream);

  const pending = service.requestHistory("profile-a", request);
  await historyStarted.promise;
  await service.invalidateProfile("profile-a");
  history.resolve([
    {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: 60_000,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
    },
  ]);

  await assert.rejects(pending, /invalidated/i);
  await service.shutdown();
});

test("failed live connect can be retried without retaining a poisoned demand", async () => {
  const fixture = createUpstream();
  let attempts = 0;
  fixture.upstream.subscribe = async (providerProfileId, liveRequest, sink) => {
    attempts += 1;
    if (attempts === 1) throw new Error("synthetic connect failure");
    const record = {
      providerProfileId,
      request: liveRequest,
      sink,
      unsubscribeCount: 0,
    };
    fixture.subscriptions.push(record);
    return {
      async unsubscribe() {
        record.unsubscribeCount += 1;
      },
    };
  };
  const service = createProviderDataService(fixture.upstream);

  await assert.rejects(
    service.subscribe("profile-a", request, createSink().sink),
    /synthetic connect failure/,
  );
  const handle = await service.subscribe(
    "profile-a",
    request,
    createSink().sink,
  );
  assert.equal(attempts, 2);
  assert.equal(fixture.subscriptions.length, 1);
  await handle.unsubscribe();
  assert.equal(fixture.subscriptions[0].unsubscribeCount, 1);
  await service.shutdown();
});

test("native and derived consumers sharing a source use one upstream", async () => {
  const fixture = createUpstream();
  fixture.upstream.getCapabilities = async () => ({
    instruments: true,
    nativeTimeframes: ["1m"],
    liveData: true,
    derivedTimeframes: true,
    derivedTimeframeIds: ["5m"],
    timeframes: [
      {
        id: "1m",
        seconds: 60,
        historical: true,
        live: true,
        native: true,
        alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
      },
      {
        id: "5m",
        seconds: 300,
        historical: true,
        live: true,
        native: false,
        derivedFromTimeframeId: "1m",
        alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
      },
    ],
  });
  const service = createProviderDataService(fixture.upstream);
  const handles = await Promise.all([
    service.subscribe(
      "profile-a",
      { instrumentId: "BTCUSD", timeframeId: "1m" },
      createSink().sink,
    ),
    service.subscribe(
      "profile-a",
      { instrumentId: "BTCUSD", timeframeId: "5m" },
      createSink().sink,
    ),
  ]);

  assert.equal(fixture.subscriptions.length, 1);
  await Promise.all(handles.map((handle) => handle.unsubscribe()));
  assert.equal(fixture.subscriptions[0].unsubscribeCount, 1);
  await service.shutdown();
});

test("late history cannot overwrite a newer live native constituent", async () => {
  const fixture = createUpstream();
  fixture.upstream.getCapabilities = async () => ({
    instruments: true,
    nativeTimeframes: ["1m"],
    liveData: true,
    derivedTimeframes: true,
    derivedTimeframeIds: ["5m"],
    timeframes: [
      {
        id: "1m",
        seconds: 60,
        historical: true,
        live: true,
        native: true,
        alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
      },
      {
        id: "5m",
        seconds: 300,
        historical: true,
        live: true,
        native: false,
        derivedFromTimeframeId: "1m",
        alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
      },
    ],
  });
  const history = deferred();
  const historyStarted = deferred();
  fixture.upstream.requestHistory = async () => {
    historyStarted.resolve();
    return history.promise;
  };
  const service = createProviderDataService(fixture.upstream, {
    now: () => 120_000,
  });
  const derivedRequest = { instrumentId: "BTCUSD", timeframeId: "5m" };
  const pendingHistory = service.requestHistory("profile-a", derivedRequest);
  await historyStarted.promise;
  const sink = createSink();
  const handle = await service.subscribe(
    "profile-a",
    derivedRequest,
    sink.sink,
  );
  fixture.subscriptions[0].sink.onCandles([
    {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: 120_000,
      open: 12,
      high: 20,
      low: 8,
      close: 19,
      volume: 7,
    },
  ]);
  history.resolve([
    {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: 0,
      open: 10,
      high: 11,
      low: 9,
      close: 10,
      volume: 1,
    },
    {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: 60_000,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
      volume: 2,
    },
    {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: 120_000,
      open: 11,
      high: 13,
      low: 10,
      close: 12,
      volume: 3,
    },
  ]);

  const result = await pendingHistory;
  assert.deepEqual(result.at(-1), {
    instrumentId: "BTCUSD",
    timeframeId: "5m",
    openTimeMs: 0,
    open: 10,
    high: 20,
    low: 8,
    close: 19,
    volume: 10,
  });
  await handle.unsubscribe();
  await service.shutdown();
});

test("derived restore hydrates the current source bucket even without a target gap", async () => {
  const fixture = createUpstream();
  fixture.upstream.getCapabilities = async () => ({
    instruments: true,
    nativeTimeframes: ["1m"],
    liveData: true,
    derivedTimeframes: true,
    derivedTimeframeIds: ["5m"],
    timeframes: [
      {
        id: "1m",
        seconds: 60,
        historical: true,
        live: true,
        native: true,
        alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
      },
      {
        id: "5m",
        seconds: 300,
        historical: true,
        live: true,
        native: false,
        derivedFromTimeframeId: "1m",
        alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
      },
    ],
  });
  let restoring = false;
  fixture.upstream.requestHistory = async () =>
    restoring
      ? [
          {
            instrumentId: "BTCUSD",
            timeframeId: "1m",
            openTimeMs: 0,
            open: 10,
            high: 20,
            low: 5,
            close: 11,
            volume: 2,
          },
          {
            instrumentId: "BTCUSD",
            timeframeId: "1m",
            openTimeMs: 60_000,
            open: 11,
            high: 12,
            low: 9,
            close: 12,
            volume: 3,
          },
          {
            instrumentId: "BTCUSD",
            timeframeId: "1m",
            openTimeMs: 120_000,
            open: 12,
            high: 13,
            low: 11,
            close: 13,
            volume: 4,
          },
        ]
      : [
          {
            instrumentId: "BTCUSD",
            timeframeId: "1m",
            openTimeMs: 0,
            open: 10,
            high: 10,
            low: 10,
            close: 10,
            volume: 1,
          },
          {
            instrumentId: "BTCUSD",
            timeframeId: "1m",
            openTimeMs: 60_000,
            open: 10,
            high: 10,
            low: 10,
            close: 10,
            volume: 1,
          },
        ];
  const service = createProviderDataService(fixture.upstream, {
    now: () => 120_000,
  });
  const targetRequest = { instrumentId: "BTCUSD", timeframeId: "5m" };
  await service.requestHistory("profile-a", targetRequest);
  const sink = createSink();
  const handle = await service.subscribe("profile-a", targetRequest, sink.sink);
  await service.invalidateProfile("profile-a");
  restoring = true;
  await service.restoreProfile("profile-a");

  assert.deepEqual(sink.candles.at(-1), {
    instrumentId: "BTCUSD",
    timeframeId: "5m",
    openTimeMs: 0,
    open: 10,
    high: 20,
    low: 5,
    close: 13,
    volume: 9,
  });
  assert.equal(fixture.subscriptions.length, 2);
  await handle.unsubscribe();
  await service.shutdown();
});
