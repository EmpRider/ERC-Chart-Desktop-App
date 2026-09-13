import assert from "node:assert/strict";
import test from "node:test";

function candle(timeframeId, openTimeMs, close = 10) {
  return {
    instrumentId: "TEST",
    timeframeId,
    openTimeMs,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
  };
}

test("worker passes source metadata into the SDK instance and preserves source-aware signals", async () => {
  const originalPostMessage = globalThis.postMessage;
  const originalOnMessage = globalThis.onmessage;
  let resolveResponse;
  const response = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  globalThis.postMessage = (message) => resolveResponse(message);

  try {
    await import(`../dist/worker-entry.js?source-metadata=${Date.now()}`);
    assert.equal(typeof globalThis.onmessage, "function");
    const runtimeEntryUrl = new URL(
      "./fixtures/source-aware-indicator.mjs",
      import.meta.url,
    ).href;
    globalThis.onmessage({
      data: {
        type: "sync",
        instanceId: "worker-source-instance",
        sequence: 1,
        runtimeEntryUrl,
        pluginId: "erc.indicator.worker-source",
        definitionId: "erc.indicator.worker-source.main",
        instrumentId: "TEST",
        timeframeId: "5m",
        parameters: {},
        sources: [
          {
            timeframeId: "1h",
            activeTimeframeId: "1h",
            candles: [candle("1h", 0, 100), candle("1h", 3_600_000, 101)],
            provenance: { kind: "synthetic", candleType: "heikin-ashi" },
            generation: 7,
            revision: 11,
            finalizedCount: 1,
          },
        ],
        data: { kind: "snapshot", candles: [candle("5m", 0)] },
        dataRevision: 3,
        configGeneration: 4,
      },
    });

    const result = await response;
    assert.equal(result.type, "result");
    assert.deepEqual(result.result.snapshot.signals, [
      {
        id: "source-aware",
        occurredAtMs: 0,
        direction: "long",
        finalized: true,
        sources: [
          {
            timeframeId: "1h",
            activeTimeframeId: "1h",
            openTimeMs: 0,
            generation: 7,
            revision: 11,
            provenance: { kind: "synthetic", candleType: "heikin-ashi" },
          },
        ],
      },
    ]);
  } finally {
    globalThis.postMessage = originalPostMessage;
    globalThis.onmessage = originalOnMessage;
  }
});
