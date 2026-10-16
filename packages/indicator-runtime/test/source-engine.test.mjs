import assert from "node:assert/strict";
import test from "node:test";

import { createProviderDataService } from "../../data-service/dist/index.js";
import { createIndicatorSourceEngine } from "../dist/index.js";

function candle(timeframeId, openTimeMs, close) {
  return Object.freeze({
    instrumentId: "EURUSD",
    timeframeId,
    openTimeMs,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  });
}

function ohlc(timeframeId, openTimeMs, open, high, low, close) {
  return Object.freeze({
    instrumentId: "EURUSD",
    timeframeId,
    openTimeMs,
    open,
    high,
    low,
    close,
    volume: 1,
  });
}

test("indicator source acquisition uses the requested provider timeframe instead of chart candles", async () => {
  const historyRequests = [];
  const subscriptions = [];
  let unsubscribeCount = 0;
  const dataService = {
    async requestHistory(providerProfileId, request) {
      historyRequests.push({ providerProfileId, request });
      return [candle(request.timeframeId, 0, 101)];
    },
    async subscribe(providerProfileId, request, sink) {
      subscriptions.push({ providerProfileId, request, sink });
      return {
        async unsubscribe() {
          unsubscribeCount += 1;
        },
      };
    },
  };

  assert.equal(
    typeof createIndicatorSourceEngine,
    "function",
    "indicator-runtime must expose the provider-aware source engine",
  );

  const engine = createIndicatorSourceEngine(dataService);
  const source = await engine.acquire({
    providerProfileId: "profile-a",
    instrumentId: "EURUSD",
    timeframeId: "1m",
    candleType: "standard",
  });

  assert.deepEqual(historyRequests, [
    {
      providerProfileId: "profile-a",
      request: {
        instrumentId: "EURUSD",
        timeframeId: "1m",
        limit: 100_000,
      },
    },
  ]);
  assert.deepEqual(
    subscriptions.map(({ providerProfileId, request }) => ({
      providerProfileId,
      request,
    })),
    [
      {
        providerProfileId: "profile-a",
        request: { instrumentId: "EURUSD", timeframeId: "1m" },
      },
    ],
  );
  assert.deepEqual(source.snapshot().candles, [candle("1m", 0, 101)]);

  await source.release();
  assert.equal(unsubscribeCount, 1);
  await engine.dispose();
});

test("equal indicator sources share one provider acquisition until the final lease releases", async () => {
  let historyCount = 0;
  let subscriptionCount = 0;
  let unsubscribeCount = 0;
  const dataService = {
    async requestHistory(_providerProfileId, request) {
      historyCount += 1;
      return [candle(request.timeframeId, 0, 102)];
    },
    async subscribe() {
      subscriptionCount += 1;
      return {
        async unsubscribe() {
          unsubscribeCount += 1;
        },
      };
    },
  };
  const engine = createIndicatorSourceEngine(dataService);
  const key = {
    providerProfileId: "profile-a",
    instrumentId: "EURUSD",
    timeframeId: "1m",
    candleType: "standard",
  };

  const first = await engine.acquire(key);
  const second = await engine.acquire(key);

  assert.equal(historyCount, 1);
  assert.equal(subscriptionCount, 1);
  assert.deepEqual(first.snapshot(), second.snapshot());

  await first.release();
  assert.equal(unsubscribeCount, 0);
  await second.release();
  assert.equal(unsubscribeCount, 1);
  await second.release();
  assert.equal(unsubscribeCount, 1);
  await engine.dispose();
});

test("acquisition retries when the previously shared source closes before the lease is granted", async () => {
  let historyCount = 0;
  let subscriptionCount = 0;
  let unsubscribeCount = 0;
  const dataService = {
    async requestHistory(_providerProfileId, request) {
      historyCount += 1;
      return [candle(request.timeframeId, 0, 102 + historyCount)];
    },
    async subscribe() {
      subscriptionCount += 1;
      return {
        async unsubscribe() {
          unsubscribeCount += 1;
        },
      };
    },
  };
  const engine = createIndicatorSourceEngine(dataService);
  const key = {
    providerProfileId: "profile-a",
    instrumentId: "EURUSD",
    timeframeId: "1m",
    candleType: "standard",
  };

  const first = await engine.acquire(key);
  const replacementPromise = engine.acquire(key);
  await first.release();
  const replacement = await replacementPromise;

  assert.equal(historyCount, 2);
  assert.equal(subscriptionCount, 2);
  assert.equal(unsubscribeCount, 1);
  assert.equal(replacement.snapshot().candles[0].close, 104);

  await replacement.release();
  assert.equal(unsubscribeCount, 2);
  await engine.dispose();
});

test("derived indicator source delegates acquisition to the provider data planner", async () => {
  const historyRequests = [];
  const subscriptions = [];
  const upstream = {
    async getCapabilities() {
      return {
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
      };
    },
    async getInstruments() {
      return [{ id: "BTCUSD", symbol: "BTCUSD", name: "Bitcoin / USD" }];
    },
    async requestHistory(providerProfileId, request) {
      historyRequests.push({ providerProfileId, request });
      return [0, 1, 2, 3, 4, 5].map((index) => ({
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        openTimeMs: index * 60_000,
        open: 10 + index,
        high: 12 + index,
        low: 9 + index,
        close: 11 + index,
      }));
    },
    async subscribe(providerProfileId, request, sink) {
      const subscription = {
        providerProfileId,
        request,
        sink,
        unsubscribeCount: 0,
      };
      subscriptions.push(subscription);
      return {
        async unsubscribe() {
          subscription.unsubscribeCount += 1;
        },
      };
    },
  };
  const dataService = createProviderDataService(upstream, {
    now: () => 390_000,
  });
  const engine = createIndicatorSourceEngine(dataService);

  const source = await engine.acquire({
    providerProfileId: "profile-a",
    instrumentId: "BTCUSD",
    timeframeId: "3m",
    candleType: "standard",
  });

  assert.equal(historyRequests[0].request.timeframeId, "1m");
  assert.equal(subscriptions[0].request.timeframeId, "1m");
  assert.deepEqual(
    source.snapshot().candles.map(({ timeframeId, openTimeMs }) => ({
      timeframeId,
      openTimeMs,
    })),
    [
      { timeframeId: "3m", openTimeMs: 0 },
      { timeframeId: "3m", openTimeMs: 180_000 },
    ],
  );

  await source.release();
  assert.equal(subscriptions[0].unsubscribeCount, 1);
  await engine.dispose();
  await dataService.shutdown();
});

test("Heikin Ashi source transforms explicit historical OHLC and records synthetic provenance", async () => {
  const dataService = {
    async requestHistory() {
      return [ohlc("1m", 0, 10, 14, 8, 12), ohlc("1m", 60_000, 12, 16, 10, 14)];
    },
    async subscribe() {
      return { unsubscribe: async () => undefined };
    },
  };
  const engine = createIndicatorSourceEngine(dataService);
  const source = await engine.acquire({
    providerProfileId: "profile-a",
    instrumentId: "EURUSD",
    timeframeId: "1m",
    candleType: "heikin-ashi",
  });

  assert.deepEqual(source.snapshot().candles, [
    ohlc("1m", 0, 11, 14, 8, 11),
    ohlc("1m", 60_000, 11, 16, 10, 13),
  ]);
  assert.deepEqual(source.snapshot().provenance, {
    kind: "synthetic",
    candleType: "heikin-ashi",
  });

  await source.release();
  await engine.dispose();
});

test("Heikin Ashi repeated building revisions derive from the previous finalized candle", async () => {
  let liveSink;
  const dataService = {
    async requestHistory() {
      return [ohlc("1m", 0, 10, 14, 8, 12)];
    },
    async subscribe(_providerProfileId, _request, sink) {
      liveSink = sink;
      return { unsubscribe: async () => undefined };
    },
  };
  const engine = createIndicatorSourceEngine(dataService);
  const source = await engine.acquire({
    providerProfileId: "profile-a",
    instrumentId: "EURUSD",
    timeframeId: "1m",
    candleType: "heikin-ashi",
  });

  liveSink.onCandles([ohlc("1m", 60_000, 12, 16, 10, 14)], {
    generation: 1,
    revision: 1,
    previousRevision: 0,
    kind: "incremental",
  });
  assert.deepEqual(
    source.snapshot().candles.at(-1),
    ohlc("1m", 60_000, 11, 16, 10, 13),
  );

  liveSink.onCandles([ohlc("1m", 60_000, 12, 18, 9, 16)], {
    generation: 1,
    revision: 2,
    previousRevision: 1,
    kind: "incremental",
  });
  assert.deepEqual(
    source.snapshot().candles.at(-1),
    ohlc("1m", 60_000, 11, 18, 9, 13.75),
  );

  await source.release();
  await engine.dispose();
});

test("Heikin Ashi keeps recursive state when the bounded source window advances", async () => {
  let liveSink;
  const history = Array.from({ length: 100_000 }, (_value, index) =>
    ohlc(
      "1m",
      index * 60_000,
      100 + index,
      102 + index,
      99 + index,
      101 + index,
    ),
  );
  const dataService = {
    async requestHistory() {
      return history;
    },
    async subscribe(_providerProfileId, _request, sink) {
      liveSink = sink;
      return { unsubscribe: async () => undefined };
    },
  };
  const engine = createIndicatorSourceEngine(dataService);
  const source = await engine.acquire({
    providerProfileId: "profile-a",
    instrumentId: "EURUSD",
    timeframeId: "1m",
    candleType: "heikin-ashi",
  });
  const retainedBeforeAdvance = source.snapshot().candles[1];

  liveSink.onCandles(
    [ohlc("1m", 100_000 * 60_000, 100_100, 100_102, 100_099, 100_101)],
    {
      generation: 1,
      revision: 1,
      previousRevision: 0,
      kind: "incremental",
    },
  );

  const snapshot = source.snapshot();
  assert.equal(snapshot.candles.length, 100_000);
  assert.deepEqual(snapshot.candles[0], retainedBeforeAdvance);

  await source.release();
  await engine.dispose();
});

test("derived timeframe candles are aggregated before Heikin Ashi transformation", async () => {
  const upstream = {
    async getCapabilities() {
      return {
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
      };
    },
    async getInstruments() {
      return [{ id: "EURUSD", symbol: "EURUSD", name: "EUR / USD" }];
    },
    async requestHistory() {
      return [0, 1, 2, 3, 4, 5].map((index) =>
        ohlc(
          "1m",
          index * 60_000,
          10 + index,
          12 + index,
          9 + index,
          11 + index,
        ),
      );
    },
    async subscribe() {
      return { unsubscribe: async () => undefined };
    },
  };
  const dataService = createProviderDataService(upstream, {
    now: () => 390_000,
  });
  const engine = createIndicatorSourceEngine(dataService);
  const source = await engine.acquire({
    providerProfileId: "profile-a",
    instrumentId: "EURUSD",
    timeframeId: "3m",
    candleType: "heikin-ashi",
  });

  assert.deepEqual(
    source.snapshot().candles.map(({ openTimeMs, open, high, low, close }) => ({
      openTimeMs,
      open,
      high,
      low,
      close,
    })),
    [
      { openTimeMs: 0, open: 11.5, high: 14, low: 9, close: 11.5 },
      { openTimeMs: 180_000, open: 11.5, high: 17, low: 11.5, close: 14.5 },
    ],
  );

  await source.release();
  await engine.dispose();
  await dataService.shutdown();
});

test("standard and Heikin Ashi sources stay distinct while equal HA leases share acquisition", async () => {
  let historyCount = 0;
  let subscriptionCount = 0;
  const dataService = {
    async requestHistory() {
      historyCount += 1;
      return [ohlc("1m", 0, 10, 14, 8, 12)];
    },
    async subscribe() {
      subscriptionCount += 1;
      return { unsubscribe: async () => undefined };
    },
  };
  const engine = createIndicatorSourceEngine(dataService);
  const base = {
    providerProfileId: "profile-a",
    instrumentId: "EURUSD",
    timeframeId: "1m",
  };
  const standard = await engine.acquire({ ...base, candleType: "standard" });
  const firstHa = await engine.acquire({ ...base, candleType: "heikin-ashi" });
  const secondHa = await engine.acquire({ ...base, candleType: "heikin-ashi" });

  assert.equal(historyCount, 2);
  assert.equal(subscriptionCount, 2);
  assert.equal(standard.snapshot().candles[0].open, 10);
  assert.equal(firstHa.snapshot().candles[0].open, 11);
  assert.deepEqual(firstHa.snapshot(), secondHa.snapshot());

  await standard.release();
  await firstHa.release();
  await secondHa.release();
  await engine.dispose();
});

test("live source revisions replace provisional candles without accepting stale updates", async () => {
  let liveSink;
  const dataService = {
    async requestHistory() {
      return [candle("1m", 0, 100)];
    },
    async subscribe(_providerProfileId, _request, sink) {
      liveSink = sink;
      return { unsubscribe: async () => undefined };
    },
  };
  const engine = createIndicatorSourceEngine(dataService);
  const source = await engine.acquire({
    providerProfileId: "profile-a",
    instrumentId: "EURUSD",
    timeframeId: "1m",
    candleType: "standard",
  });

  assert.equal(source.snapshot().generation, 0);
  assert.equal(source.snapshot().revision, 0);

  liveSink.onCandles([candle("1m", 60_000, 103)], {
    generation: 1,
    revision: 1,
    previousRevision: 0,
    kind: "incremental",
  });
  assert.equal(source.snapshot().generation, 1);
  assert.equal(source.snapshot().revision, 1);
  assert.deepEqual(
    source.snapshot().candles.map(({ openTimeMs, close }) => ({
      openTimeMs,
      close,
    })),
    [
      { openTimeMs: 0, close: 100 },
      { openTimeMs: 60_000, close: 103 },
    ],
  );

  liveSink.onCandles([candle("1m", 60_000, 104)], {
    generation: 1,
    revision: 2,
    previousRevision: 1,
    kind: "incremental",
  });
  assert.equal(source.snapshot().revision, 2);
  assert.equal(source.snapshot().candles.length, 2);
  assert.equal(source.snapshot().candles.at(-1).close, 104);

  liveSink.onCandles([candle("1m", 60_000, 999)], {
    generation: 1,
    revision: 1,
    previousRevision: 0,
    kind: "incremental",
  });
  assert.equal(source.snapshot().revision, 2);
  assert.equal(source.snapshot().candles.at(-1).close, 104);

  liveSink.onCandles([candle("1m", 60_000, 998)], {
    generation: 0,
    revision: 999,
    previousRevision: 2,
    kind: "incremental",
  });
  assert.equal(source.snapshot().generation, 1);
  assert.equal(source.snapshot().revision, 2);
  assert.equal(source.snapshot().candles.at(-1).close, 104);

  await source.release();
  await engine.dispose();
});

test("one indicator can hold chart and higher-timeframe sources without cross-contamination", async () => {
  const historyRequests = [];
  const subscriptions = [];
  const dataService = {
    async requestHistory(providerProfileId, request) {
      historyRequests.push({ providerProfileId, request });
      return [
        candle(
          request.timeframeId,
          0,
          request.timeframeId === "15m" ? 115 : 160,
        ),
      ];
    },
    async subscribe(providerProfileId, request) {
      subscriptions.push({ providerProfileId, request });
      return { unsubscribe: async () => undefined };
    },
  };
  const engine = createIndicatorSourceEngine(dataService);

  const chartSource = await engine.acquire({
    providerProfileId: "profile-a",
    instrumentId: "EURUSD",
    timeframeId: "15m",
    candleType: "standard",
  });
  const higherSource = await engine.acquire({
    providerProfileId: "profile-a",
    instrumentId: "EURUSD",
    timeframeId: "1h",
    candleType: "standard",
  });

  assert.deepEqual(
    historyRequests.map(({ providerProfileId, request }) => ({
      providerProfileId,
      timeframeId: request.timeframeId,
    })),
    [
      { providerProfileId: "profile-a", timeframeId: "15m" },
      { providerProfileId: "profile-a", timeframeId: "1h" },
    ],
  );
  assert.deepEqual(
    subscriptions.map(({ providerProfileId, request }) => ({
      providerProfileId,
      timeframeId: request.timeframeId,
    })),
    [
      { providerProfileId: "profile-a", timeframeId: "15m" },
      { providerProfileId: "profile-a", timeframeId: "1h" },
    ],
  );
  assert.equal(chartSource.snapshot().candles[0].close, 115);
  assert.equal(higherSource.snapshot().candles[0].close, 160);

  await chartSource.release();
  await higherSource.release();
  await engine.dispose();
});

test("provider switches reacquire the source without retaining stale provider data", async () => {
  const historyProviders = [];
  const subscriptionProviders = [];
  const unsubscribedProviders = [];
  const dataService = {
    async requestHistory(providerProfileId, request) {
      historyProviders.push(providerProfileId);
      return [
        candle(
          request.timeframeId,
          0,
          providerProfileId === "profile-a" ? 101 : 202,
        ),
      ];
    },
    async subscribe(providerProfileId) {
      subscriptionProviders.push(providerProfileId);
      return {
        async unsubscribe() {
          unsubscribedProviders.push(providerProfileId);
        },
      };
    },
  };
  const engine = createIndicatorSourceEngine(dataService);

  const first = await engine.acquire({
    providerProfileId: "profile-a",
    instrumentId: "EURUSD",
    timeframeId: "1m",
    candleType: "standard",
  });
  assert.equal(first.snapshot().candles[0].close, 101);
  await first.release();

  const switched = await engine.acquire({
    providerProfileId: "profile-b",
    instrumentId: "EURUSD",
    timeframeId: "1m",
    candleType: "standard",
  });

  assert.deepEqual(historyProviders, ["profile-a", "profile-b"]);
  assert.deepEqual(subscriptionProviders, ["profile-a", "profile-b"]);
  assert.deepEqual(unsubscribedProviders, ["profile-a"]);
  assert.equal(switched.snapshot().key.providerProfileId, "profile-b");
  assert.equal(switched.snapshot().candles[0].close, 202);

  await switched.release();
  assert.deepEqual(unsubscribedProviders, ["profile-a", "profile-b"]);
  await engine.dispose();
});

test("source snapshots expose the count of actually finalized candles", async () => {
  let liveSink;
  const dataService = {
    async requestHistory() {
      return [candle("1h", 0, 100)];
    },
    async subscribe(_providerProfileId, _request, sink) {
      liveSink = sink;
      return { unsubscribe: async () => undefined };
    },
  };
  const engine = createIndicatorSourceEngine(dataService);
  const source = await engine.acquire({
    providerProfileId: "profile-a",
    instrumentId: "EURUSD",
    timeframeId: "1h",
    candleType: "standard",
  });
  try {
    assert.equal(source.snapshot().finalizedCount, 0);
    liveSink.onCandles([candle("1h", 60 * 60_000, 200)], {
      generation: 1,
      revision: 1,
      previousRevision: 0,
      kind: "incremental",
    });
    assert.equal(source.snapshot().finalizedCount, 1);
  } finally {
    await source.release();
    await engine.dispose();
  }
});
