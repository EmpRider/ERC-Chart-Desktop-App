import assert from "node:assert/strict";
import test from "node:test";

import { createIndicatorWorkerCandleSnapshot } from "@erc-chart/contracts";

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
            providerProfileId: "profile-a",
            instrumentId: "SOURCE",
            timeframeId: "1h",
            activeTimeframeId: "1h",
            snapshot: createIndicatorWorkerCandleSnapshot([
              candle("1h", 0, 100),
              candle("1h", 3_600_000, 101),
            ]),
            provenance: { kind: "synthetic", candleType: "heikin-ashi" },
            generation: 7,
            revision: 11,
            finalizedCount: 1,
          },
        ],
        data: {
          kind: "snapshot",
          snapshot: createIndicatorWorkerCandleSnapshot([candle("5m", 0)]),
        },
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
            providerProfileId: "profile-a",
            instrumentId: "SOURCE",
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

test("worker passes bound indicator outputs through the private runtime context", async () => {
  const originalPostMessage = globalThis.postMessage;
  const originalOnMessage = globalThis.onmessage;
  let resolveResponse;
  const response = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  globalThis.postMessage = (message) => resolveResponse(message);

  try {
    await import(`../dist/worker-entry.js?dependency-input=${Date.now()}`);
    const runtimeEntryUrl = new URL(
      "./fixtures/dependency-aware-indicator.mjs",
      import.meta.url,
    ).href;
    globalThis.onmessage({
      data: {
        type: "sync",
        instanceId: "worker-dependency-instance",
        sequence: 1,
        runtimeEntryUrl,
        pluginId: "erc.indicator.worker-dependency",
        definitionId: "erc.indicator.worker-dependency.main",
        instrumentId: "TEST",
        timeframeId: "1m",
        parameters: {},
        dependencies: [
          {
            inputKey: "source",
            instanceId: "upstream-instance",
            outputKey: "line",
            sourceGeneration: 2,
            sourceRevision: 7,
            configGeneration: 4,
            outputRevision: 1,
            points: [{ openTimeMs: 0, values: { line: 42 } }],
          },
        ],
        data: {
          kind: "snapshot",
          snapshot: createIndicatorWorkerCandleSnapshot([candle("1m", 0)]),
        },
        dataRevision: 7,
        configGeneration: 1,
      },
    });

    const result = await response;
    assert.equal(result.type, "result");
    assert.deepEqual(result.result.snapshot.points, [
      { openTimeMs: 0, values: { line: 43 } },
    ]);
  } finally {
    globalThis.postMessage = originalPostMessage;
    globalThis.onmessage = originalOnMessage;
  }
});

test("worker applies live dependency deltas without recreating history", async () => {
  const originalPostMessage = globalThis.postMessage;
  const originalOnMessage = globalThis.onmessage;
  const pendingResponses = [];
  globalThis.postMessage = (message) => pendingResponses.shift()?.(message);
  const responseFor = (message) =>
    new Promise((resolve) => {
      pendingResponses.push(resolve);
      globalThis.onmessage({ data: message });
    });

  try {
    await import(`../dist/worker-entry.js?dependency-delta=${Date.now()}`);
    const runtimeEntryUrl = new URL(
      "./fixtures/dependency-aware-indicator.mjs",
      import.meta.url,
    ).href;
    const base = {
      type: "sync",
      instanceId: "worker-dependency-delta-instance",
      runtimeEntryUrl,
      pluginId: "erc.indicator.worker-dependency",
      definitionId: "erc.indicator.worker-dependency.main",
      instrumentId: "TEST",
      timeframeId: "1m",
      parameters: {},
      configGeneration: 1,
    };
    const initial = await responseFor({
      ...base,
      sequence: 1,
      dependencies: [
        {
          inputKey: "source",
          instanceId: "upstream-instance",
          outputKey: "line",
          sourceGeneration: 0,
          sourceRevision: 1,
          configGeneration: 1,
          outputRevision: 1,
          points: [
            { openTimeMs: 0, values: { line: 42 } },
            { openTimeMs: 60_000, values: { line: 43 } },
          ],
        },
      ],
      data: {
        kind: "snapshot",
        snapshot: createIndicatorWorkerCandleSnapshot([
          candle("1m", 0),
          candle("1m", 60_000),
        ]),
      },
      dataRevision: 1,
    });
    assert.equal(initial.type, "result");

    const updated = await responseFor({
      ...base,
      sequence: 2,
      dependencies: [
        {
          inputKey: "source",
          instanceId: "upstream-instance",
          outputKey: "line",
          sourceGeneration: 0,
          sourceRevision: 2,
          configGeneration: 1,
          outputRevision: 2,
          points: [{ openTimeMs: 60_000, values: { line: 99 } }],
        },
      ],
      data: { kind: "building", candle: candle("1m", 60_000) },
      dataRevision: 2,
    });

    assert.equal(updated.type, "result");
    assert.equal(updated.result.kind, "building");
    assert.deepEqual(updated.result.points, [
      { openTimeMs: 60_000, values: { line: 100 } },
    ]);
  } finally {
    globalThis.postMessage = originalPostMessage;
    globalThis.onmessage = originalOnMessage;
  }
});

test("worker rejects snapshots whose drawing handles exceed the overlay cap", async () => {
  const originalPostMessage = globalThis.postMessage;
  const originalOnMessage = globalThis.onmessage;
  let resolveResponse;
  const response = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  globalThis.postMessage = (message) => resolveResponse(message);

  try {
    await import(`../dist/worker-entry.js?output-cap=${Date.now()}`);
    const runtimeEntryUrl = new URL(
      "./fixtures/oversized-output-indicator.mjs",
      import.meta.url,
    ).href;
    globalThis.onmessage({
      data: {
        type: "sync",
        instanceId: "oversized-output-instance",
        sequence: 1,
        runtimeEntryUrl,
        pluginId: "erc.indicator.oversized-output",
        definitionId: "erc.indicator.oversized-output.main",
        instrumentId: "TEST",
        timeframeId: "1m",
        parameters: {},
        data: {
          kind: "snapshot",
          snapshot: createIndicatorWorkerCandleSnapshot([candle("1m", 0)]),
        },
        dataRevision: 1,
        configGeneration: 1,
      },
    });

    const result = await response;
    assert.equal(result.type, "error");
    assert.equal(result.code, "INDICATOR_WORKER_EXECUTION_FAILED");
    assert.match(result.message, /invalid or oversized snapshot/u);
  } finally {
    globalThis.postMessage = originalPostMessage;
    globalThis.onmessage = originalOnMessage;
  }
});
