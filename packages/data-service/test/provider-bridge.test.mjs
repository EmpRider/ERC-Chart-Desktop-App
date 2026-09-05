import assert from "node:assert/strict";
import test from "node:test";
import { createProviderDataService } from "../dist/index.js";

function createSink() {
  const candles = [];
  const ticks = [];
  const errors = [];
  return {
    candles,
    ticks,
    errors,
    sink: {
      onCandles(value) {
        candles.push(...value);
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

test("rejects malformed or mismatched provider market data before delivery", async () => {
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

test("keeps one canonical live series and bounded tick state for shared demand", async () => {
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
