import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserIndicatorRuntime } from "../dist/indicator-worker-runtime.js";

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
