import assert from "node:assert/strict";
import test from "node:test";

import { createIndicatorWorkerCandleSnapshot } from "@erc-chart/contracts";
import {
  IndicatorWorkerRuntimeError,
  createIndicatorWorkerSupervisor,
} from "../dist/index.js";

const emptySnapshot = { points: [], overlays: [], signals: [] };

function request(instanceId, overrides = {}) {
  return {
    instanceId,
    runtimeEntryUrl:
      "erc-plugin://plugin/erc.indicator.fixture/1.0.0/dist/index.js",
    pluginId: "erc.indicator.fixture",
    definitionId: "erc.indicator.fixture.main",
    instrumentId: "fixture.instrument",
    timeframeId: "1m",
    parameters: {},
    data: {
      kind: "snapshot",
      snapshot: createIndicatorWorkerCandleSnapshot([]),
    },
    dataRevision: 1,
    configGeneration: 1,
    ...overrides,
  };
}

function success(message, overrides = {}) {
  return {
    type: "result",
    instanceId: message.instanceId,
    sequence: message.sequence,
    dataRevision: message.dataRevision,
    configGeneration: message.configGeneration,
    result: { kind: "snapshot", snapshot: emptySnapshot },
    ...overrides,
  };
}

class FakeWorker {
  constructor(instanceId) {
    this.instanceId = instanceId;
    this.onmessage = null;
    this.onerror = null;
    this.messages = [];
    this.terminated = false;
    this.autoRespond = true;
  }

  postMessage(message) {
    this.messages.push(message);
    if (message.type === "sync" && this.autoRespond) {
      queueMicrotask(() => this.respond(success(message)));
    }
  }

  respond(data) {
    this.onmessage?.({ data });
  }

  crash(message = "fixture crash") {
    this.onerror?.({ message });
  }

  terminate() {
    this.terminated = true;
  }
}

function harness({ autoRespond = true, ...options } = {}) {
  const workers = [];
  const supervisor = createIndicatorWorkerSupervisor({
    workerFactory(instanceId) {
      const worker = new FakeWorker(instanceId);
      worker.autoRespond = autoRespond;
      workers.push(worker);
      return worker;
    },
    startupTimeoutMs: 30,
    updateTimeoutMs: 20,
    ...options,
  });
  return { supervisor, workers };
}

test("owns exactly one worker per active indicator instance", async () => {
  const { supervisor, workers } = harness();
  try {
    await supervisor.sync(request("one"));
    await supervisor.sync(request("one", { dataRevision: 2 }));
    await supervisor.sync(request("two"));

    assert.deepEqual(
      workers.map((worker) => worker.instanceId),
      ["one", "two"],
    );
    assert.equal(
      workers[0].messages.filter((message) => message.type === "sync").length,
      2,
    );
  } finally {
    supervisor.dispose();
  }
});

test("returns the newest generation when an older async result settles last", async () => {
  const { supervisor, workers } = harness({ autoRespond: false });
  try {
    const firstPromise = supervisor.sync(request("one", { dataRevision: 1 }));
    const firstMessage = workers[0].messages[0];

    const secondPromise = supervisor.sync(request("one", { dataRevision: 2 }));
    const secondMessage = workers[0].messages[1];
    workers[0].respond(success(secondMessage));
    const secondResult = await secondPromise;
    workers[0].respond(success(firstMessage));
    const firstResult = await firstPromise;

    assert.equal(secondResult.dataRevision, 2);
    assert.equal(firstResult.dataRevision, 2);
    assert.equal(firstResult.sequence, secondResult.sequence);
  } finally {
    supervisor.dispose();
  }
});

for (const [label, override] of [
  ["data revision", { dataRevision: 99 }],
  ["configuration generation", { configGeneration: 99 }],
]) {
  test(`rejects a response with a mismatched ${label}`, async () => {
    const { supervisor, workers } = harness({ autoRespond: false });
    try {
      const pending = supervisor.sync(request("one"));
      const message = workers[0].messages[0];
      workers[0].respond(success(message, override));

      await assert.rejects(
        pending,
        (error) =>
          error instanceof IndicatorWorkerRuntimeError &&
          error.code === "INDICATOR_WORKER_PROTOCOL_INVALID",
      );
      assert.equal(workers[0].terminated, true);
    } finally {
      supervisor.dispose();
    }
  });
}

test("rejects malformed history snapshots before creating a worker", async () => {
  const { supervisor, workers } = harness();
  try {
    await assert.rejects(
      supervisor.sync(
        request("invalid-snapshot", {
          data: {
            kind: "snapshot",
            snapshot: {
              openTimeMs: new Float64Array([60_000]),
              open: new Float64Array([10]),
              high: new Float64Array([12]),
              low: new Float64Array([9]),
              close: new Float64Array(),
              volume: new Float64Array([1]),
            },
          },
        }),
      ),
      (error) =>
        error instanceof IndicatorWorkerRuntimeError &&
        error.code === "INDICATOR_WORKER_PROTOCOL_INVALID",
    );
    assert.equal(workers.length, 0);
  } finally {
    supervisor.dispose();
  }
});

test("rejects malformed source provenance before creating a worker", async () => {
  const { supervisor, workers } = harness();
  try {
    await assert.rejects(
      supervisor.sync(
        request("invalid-source", {
          sources: [
            {
              instrumentId: "fixture.instrument",
              timeframeId: "1h",
              snapshot: createIndicatorWorkerCandleSnapshot([]),
              provenance: { kind: "market", candleType: "standard" },
              generation: 1,
              revision: 1,
              finalizedCount: 0,
            },
          ],
        }),
      ),
      (error) =>
        error instanceof IndicatorWorkerRuntimeError &&
        error.code === "INDICATOR_WORKER_PROTOCOL_INVALID",
    );
    assert.equal(workers.length, 0);
  } finally {
    supervisor.dispose();
  }
});

test("rejects null active source timeframe before creating a worker", async () => {
  const { supervisor, workers } = harness();
  try {
    await assert.rejects(
      supervisor.sync(
        request("invalid-active-source-timeframe", {
          sources: [
            {
              providerProfileId: "fixture.provider",
              instrumentId: "fixture.instrument",
              timeframeId: "1h",
              activeTimeframeId: null,
              snapshot: createIndicatorWorkerCandleSnapshot([]),
              provenance: { kind: "market", candleType: "standard" },
              generation: 1,
              revision: 1,
              finalizedCount: 0,
            },
          ],
        }),
      ),
      (error) =>
        error instanceof IndicatorWorkerRuntimeError &&
        error.code === "INDICATOR_WORKER_PROTOCOL_INVALID",
    );
    assert.equal(workers.length, 0);
  } finally {
    supervisor.dispose();
  }
});

test("terminates a worker that exceeds the startup budget", async () => {
  const { supervisor, workers } = harness({ autoRespond: false });
  const pending = supervisor.sync(request("slow"));

  await assert.rejects(
    pending,
    (error) =>
      error instanceof IndicatorWorkerRuntimeError &&
      error.code === "INDICATOR_WORKER_TIMEOUT",
  );
  assert.equal(workers[0].terminated, true);
});

test("uses the tighter update budget for incremental work after the first successful calculation", async () => {
  const { supervisor, workers } = harness({
    startupTimeoutMs: 100,
    updateTimeoutMs: 10,
  });
  try {
    await supervisor.sync(request("one"));
    workers[0].autoRespond = false;

    await assert.rejects(
      supervisor.sync(
        request("one", {
          data: {
            kind: "building",
            candle: {
              instrumentId: "fixture.instrument",
              timeframeId: "1m",
              openTimeMs: 60_000,
              open: 10,
              high: 12,
              low: 9,
              close: 11,
            },
          },
          dataRevision: 2,
        }),
      ),
      (error) =>
        error instanceof IndicatorWorkerRuntimeError &&
        error.code === "INDICATOR_WORKER_TIMEOUT",
    );
    assert.equal(workers[0].terminated, true);
  } finally {
    supervisor.dispose();
  }
});

for (const [bars, expectedBudget] of [
  [10, 70],
  [100_000, 60_000],
]) {
  test(`history budget for ${bars} bars expires at ${expectedBudget} ms`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { supervisor, workers } = harness({
      startupTimeoutMs: 20,
      updateTimeoutMs: 10,
    });
    try {
      await supervisor.sync(request("one"));
      workers[0].autoRespond = false;
      const pending = supervisor.sync(
        request("one", {
          data: {
            kind: "rebuild",
            snapshot: createIndicatorWorkerCandleSnapshot(
              Array.from({ length: bars }, (_, index) => ({
                instrumentId: "fixture.instrument",
                timeframeId: "1m",
                openTimeMs: index * 60_000,
                open: 10,
                high: 12,
                low: 9,
                close: 11,
              })),
            ),
          },
          dataRevision: 2,
        }),
      );
      const rejected = assert.rejects(
        pending,
        (error) => error.code === "INDICATOR_WORKER_TIMEOUT",
      );
      t.mock.timers.tick(expectedBudget - 1);
      assert.equal(workers[0].terminated, false);
      t.mock.timers.tick(1);
      await rejected;
      assert.equal(workers[0].terminated, true);
    } finally {
      supervisor.dispose();
    }
  });
}

test("gives paginated history rebuilds the full history calculation budget", async () => {
  const { supervisor, workers } = harness({
    startupTimeoutMs: 20,
    updateTimeoutMs: 10,
  });
  try {
    await supervisor.sync(request("one"));
    workers[0].autoRespond = false;

    const pending = supervisor.sync(
      request("one", {
        data: {
          kind: "rebuild",
          snapshot: createIndicatorWorkerCandleSnapshot(
            Array.from({ length: 10 }, (_, index) => ({
              instrumentId: "fixture.instrument",
              timeframeId: "1m",
              openTimeMs: index * 60_000,
              open: 10,
              high: 12,
              low: 9,
              close: 11,
            })),
          ),
        },
        dataRevision: 2,
      }),
    );
    const message = workers[0].messages.at(-1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    workers[0].respond(success(message));

    assert.equal((await pending).dataRevision, 2);
    assert.equal(workers[0].terminated, false);
  } finally {
    supervisor.dispose();
  }
});

test("contains a crash to one instance and recreates only that instance", async () => {
  const { supervisor, workers } = harness();
  try {
    await supervisor.sync(request("healthy"));
    const failedPromise = supervisor.sync(request("failed"));
    workers[1].autoRespond = false;
    workers[1].crash();

    await assert.rejects(
      failedPromise,
      (error) =>
        error instanceof IndicatorWorkerRuntimeError &&
        error.code === "INDICATOR_WORKER_CRASHED",
    );
    assert.equal(workers[0].terminated, false);
    assert.equal(workers[1].terminated, true);

    await supervisor.sync(request("failed", { dataRevision: 2 }));
    assert.equal(workers.length, 3);
    assert.equal(workers[2].instanceId, "failed");
  } finally {
    supervisor.dispose();
  }
});

test("dispose rejects pending work, terminates the worker and permits restart", async () => {
  const { supervisor, workers } = harness({ autoRespond: false });
  try {
    const pending = supervisor.sync(request("one"));
    supervisor.disposeInstance("one");

    await assert.rejects(
      pending,
      (error) =>
        error instanceof IndicatorWorkerRuntimeError &&
        error.code === "INDICATOR_WORKER_DISPOSED",
    );
    assert.equal(workers[0].terminated, true);

    workers[0].autoRespond = true;
    const restarted = supervisor.sync(request("one", { dataRevision: 2 }));
    const restartMessage = workers[1].messages[0];
    workers[1].respond(success(restartMessage));
    await restarted;
    assert.equal(workers.length, 2);
  } finally {
    supervisor.dispose();
  }
});

test("rejects stale request revisions while allowing a new configuration generation to reset revision", async () => {
  const { supervisor, workers } = harness();
  try {
    await supervisor.sync(
      request("one", { dataRevision: 5, configGeneration: 2 }),
    );

    await assert.rejects(
      supervisor.sync(request("one", { dataRevision: 4, configGeneration: 2 })),
      (error) =>
        error instanceof IndicatorWorkerRuntimeError &&
        error.code === "INDICATOR_WORKER_STALE_REQUEST",
    );
    await assert.rejects(
      supervisor.sync(
        request("one", { dataRevision: 99, configGeneration: 1 }),
      ),
      (error) =>
        error instanceof IndicatorWorkerRuntimeError &&
        error.code === "INDICATOR_WORKER_STALE_REQUEST",
    );

    await supervisor.sync(
      request("one", { dataRevision: 1, configGeneration: 3 }),
    );
    assert.deepEqual(
      workers[0].messages
        .filter((message) => message.type === "sync")
        .map(({ dataRevision, configGeneration }) => ({
          dataRevision,
          configGeneration,
        })),
      [
        { dataRevision: 5, configGeneration: 2 },
        { dataRevision: 1, configGeneration: 3 },
      ],
    );
  } finally {
    supervisor.dispose();
  }
});

test("caps active workers at the configured supervisor capacity", async () => {
  const { supervisor, workers } = harness({
    autoRespond: false,
    maxActiveWorkers: 2,
  });
  const first = supervisor.sync(request("one"));
  const second = supervisor.sync(request("two"));
  try {
    await assert.rejects(
      supervisor.sync(request("three")),
      (error) =>
        error instanceof IndicatorWorkerRuntimeError &&
        error.code === "INDICATOR_WORKER_CAPACITY_EXCEEDED",
    );
    assert.equal(workers.length, 2);
  } finally {
    supervisor.dispose();
    await Promise.allSettled([first, second]);
  }
});

test("caps pending requests per indicator instance", async () => {
  const { supervisor, workers } = harness({
    autoRespond: false,
    maxPendingRequestsPerInstance: 2,
  });
  try {
    const first = supervisor.sync(request("one", { dataRevision: 1 }));
    const second = supervisor.sync(request("one", { dataRevision: 2 }));

    await assert.rejects(
      supervisor.sync(request("one", { dataRevision: 3 })),
      (error) =>
        error instanceof IndicatorWorkerRuntimeError &&
        error.code === "INDICATOR_WORKER_QUEUE_FULL",
    );
    assert.equal(
      workers[0].messages.filter((message) => message.type === "sync").length,
      2,
    );

    const firstMessage = workers[0].messages[0];
    const secondMessage = workers[0].messages[1];
    workers[0].respond(success(secondMessage));
    workers[0].respond(success(firstMessage));
    await Promise.all([first, second]);
  } finally {
    supervisor.dispose();
  }
});

test("bounds consecutive worker restarts until explicit disposal resets the instance", async () => {
  const { supervisor, workers } = harness({
    autoRespond: false,
    maxConsecutiveFailures: 2,
  });
  try {
    const first = supervisor.sync(request("one", { dataRevision: 1 }));
    workers[0].crash("first crash");
    await assert.rejects(
      first,
      (error) => error.code === "INDICATOR_WORKER_CRASHED",
    );

    const second = supervisor.sync(request("one", { dataRevision: 2 }));
    workers[1].crash("second crash");
    await assert.rejects(
      second,
      (error) => error.code === "INDICATOR_WORKER_CRASHED",
    );

    await assert.rejects(
      supervisor.sync(request("one", { dataRevision: 3 })),
      (error) =>
        error instanceof IndicatorWorkerRuntimeError &&
        error.code === "INDICATOR_WORKER_RESTART_LIMIT",
    );
    assert.equal(workers.length, 2);

    supervisor.disposeInstance("one");
    const recovered = supervisor.sync(
      request("one", { dataRevision: 1, configGeneration: 1 }),
    );
    const recoveryMessage = workers[2].messages[0];
    workers[2].respond(success(recoveryMessage));
    await recovered;
    assert.equal(workers.length, 3);
  } finally {
    supervisor.dispose();
  }
});

test("turns postMessage failures into a settled runtime error and terminates the worker", async () => {
  const workers = [];
  const supervisor = createIndicatorWorkerSupervisor({
    workerFactory(instanceId) {
      const worker = new FakeWorker(instanceId);
      worker.autoRespond = false;
      worker.postMessage = () => {
        throw new Error("post failed");
      };
      workers.push(worker);
      return worker;
    },
    startupTimeoutMs: 30,
    updateTimeoutMs: 20,
  });
  try {
    await assert.rejects(
      supervisor.sync(request("one")),
      (error) =>
        error instanceof IndicatorWorkerRuntimeError &&
        error.code === "INDICATOR_WORKER_POST_FAILED",
    );
    assert.equal(workers[0].terminated, true);
  } finally {
    supervisor.dispose();
  }
});

test("settles disposal even when worker termination throws", async () => {
  const workers = [];
  const supervisor = createIndicatorWorkerSupervisor({
    workerFactory(instanceId) {
      const worker = new FakeWorker(instanceId);
      worker.autoRespond = false;
      worker.terminate = () => {
        worker.terminated = true;
        throw new Error("terminate failed");
      };
      workers.push(worker);
      return worker;
    },
    startupTimeoutMs: 30,
    updateTimeoutMs: 20,
  });
  const pending = supervisor.sync(request("one"));
  assert.doesNotThrow(() => supervisor.disposeInstance("one"));
  await assert.rejects(
    pending,
    (error) =>
      error instanceof IndicatorWorkerRuntimeError &&
      error.code === "INDICATOR_WORKER_DISPOSED",
  );
  assert.equal(workers[0].terminated, true);
});
