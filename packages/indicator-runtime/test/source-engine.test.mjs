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
