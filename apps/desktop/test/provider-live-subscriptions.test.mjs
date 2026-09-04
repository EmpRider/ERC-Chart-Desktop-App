import assert from "node:assert/strict";
import test from "node:test";
import { createProviderLiveSubscriptionManager } from "../dist/provider-live-subscriptions.js";

function createRendererSink(ownerId = 7) {
  const events = [];
  let closed = false;
  let closeListener;
  return {
    events,
    sink: {
      ownerId,
      isClosed: () => closed,
      send: (event) => events.push(event),
      onClosed: (listener) => {
        closeListener = listener;
        return () => {
          if (closeListener === listener) closeListener = undefined;
        };
      },
    },
    close() {
      closed = true;
      closeListener?.();
    },
  };
}

test("owns provider subscriptions per renderer and relays only candles/errors", async () => {
  let providerSink;
  let unsubscribeCount = 0;
  const calls = [];
  const manager = createProviderLiveSubscriptionManager({
    async subscribeProviderData(profileId, request, sink) {
      calls.push({ profileId, request });
      providerSink = sink;
      return {
        async unsubscribe() {
          unsubscribeCount += 1;
        },
      };
    },
  });
  const renderer = createRendererSink();
  const request = {
    subscriptionId: "provider-live-test-1",
    profileId: "profile-a",
    instrumentId: "BTCUSD",
    timeframeId: "1m",
  };

  await manager.start(request, renderer.sink);
  assert.deepEqual(calls, [
    {
      profileId: "profile-a",
      request: { instrumentId: "BTCUSD", timeframeId: "1m" },
    },
  ]);
  providerSink.onTicks([]);
  providerSink.onCandles([
    {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: 1_800_000_000_000,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
    },
  ]);
  providerSink.onError("LIVE_FAILED");
  assert.deepEqual(
    renderer.events.map(({ type }) => type),
    ["candles", "error"],
  );
  assert.equal(await manager.stop(request.subscriptionId, 99), false);
  assert.equal(unsubscribeCount, 0);
  assert.equal(await manager.stop(request.subscriptionId, 7), true);
  assert.equal(unsubscribeCount, 1);
  assert.equal(await manager.stop(request.subscriptionId, 7), false);
});

test("unsubscribes automatically when the owning renderer closes", async () => {
  let unsubscribeCount = 0;
  const manager = createProviderLiveSubscriptionManager({
    async subscribeProviderData() {
      return {
        async unsubscribe() {
          unsubscribeCount += 1;
        },
      };
    },
  });
  const renderer = createRendererSink(12);

  await manager.start(
    {
      subscriptionId: "provider-live-test-2",
      profileId: "profile-a",
      instrumentId: "BTCUSD",
      timeframeId: "1m",
    },
    renderer.sink,
  );
  renderer.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(unsubscribeCount, 1);
  await manager.shutdown();
  assert.equal(unsubscribeCount, 1);
});
