import assert from "node:assert/strict";
import test from "node:test";

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
