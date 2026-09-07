import assert from "node:assert/strict";
import test from "node:test";

import { createIndicatorWorkerSupervisor } from "../dist/index.js";

const first = {
  instrumentId: "fixture.instrument",
  timeframeId: "1m",
  openTimeMs: 1_800_000_000_000,
  open: 100,
  high: 102,
  low: 99,
  close: 101,
  volume: 10,
};
const firstUpdate = { ...first, high: 103, close: 102 };
const second = {
  ...firstUpdate,
  openTimeMs: first.openTimeMs + 60_000,
  open: firstUpdate.close,
  high: firstUpdate.close + 2,
  low: firstUpdate.close - 1,
  close: firstUpdate.close + 1,
};

function request(revision, data) {
  return {
    instanceId: "incremental-instance",
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.fixture/1.0.0/dist/index.js",
    pluginId: "erc.indicator.fixture",
    definitionId: "erc.indicator.fixture.main",
    instrumentId: "fixture.instrument",
    timeframeId: "1m",
    parameters: {},
    data,
    dataRevision: revision,
    configGeneration: 1,
  };
}

function resultFor(message) {
  if (message.data.kind === "building") {
    return {
      kind: "building",
      points: [{ openTimeMs: message.data.candle.openTimeMs, values: {} }],
      overlays: [],
      signals: [],
    };
  }
  if (message.data.kind === "rollover") {
    return {
      kind: "rollover",
      points: [
        { openTimeMs: message.data.finalized.openTimeMs, values: {} },
        { openTimeMs: message.data.building.openTimeMs, values: {} },
      ],
      overlays: [],
      signals: [],
    };
  }
  return {
    kind: "snapshot",
    snapshot: { points: [], overlays: [], signals: [] },
  };
}

test("sequences consecutive data revisions through one persistent worker", async () => {
  const posted = [];
  let messageHandler = null;
  let terminations = 0;

  const supervisor = createIndicatorWorkerSupervisor({
    workerFactory() {
      return {
        get onmessage() {
          return messageHandler;
        },
        set onmessage(value) {
          messageHandler = value;
        },
        onerror: null,
        postMessage(message) {
          posted.push(message);
          if (message.type !== "sync") return;
          queueMicrotask(() => {
            messageHandler?.({
              data: {
                type: "result",
                instanceId: message.instanceId,
                sequence: message.sequence,
                dataRevision: message.dataRevision,
                configGeneration: message.configGeneration,
                result: resultFor(message),
              },
            });
          });
        },
        terminate() {
          terminations += 1;
        },
      };
    },
  });

  try {
    await supervisor.sync(request(1, { kind: "snapshot", candles: [first] }));
    await supervisor.sync(
      request(2, { kind: "building", candle: firstUpdate }),
    );
    await supervisor.sync(
      request(3, {
        kind: "rollover",
        finalized: firstUpdate,
        building: second,
      }),
    );
    const syncMessages = posted.filter((message) => message.type === "sync");
    assert.deepEqual(
      syncMessages.map((message) => message.dataRevision),
      [1, 2, 3],
    );
    assert.deepEqual(
      syncMessages.map((message) => message.sequence),
      [1, 2, 3],
    );
    assert.deepEqual(
      syncMessages.map((message) => message.data.kind),
      ["snapshot", "building", "rollover"],
    );
    assert.equal("candles" in syncMessages[1].data, false);
    assert.equal("candles" in syncMessages[2].data, false);
    assert.equal(terminations, 0);
  } finally {
    supervisor.dispose();
  }
});
