import assert from "node:assert/strict";
import test from "node:test";

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
    data: { kind: "snapshot", candles: [] },
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

test("rejects mismatched revision or configuration generation", async () => {
  const { supervisor, workers } = harness({ autoRespond: false });
  try {
    const pending = supervisor.sync(request("one"));
    const message = workers[0].messages[0];
    workers[0].respond(success(message, { dataRevision: 99 }));

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
          candles: Array.from({ length: 10 }, (_, index) => ({
            instrumentId: "fixture.instrument",
            timeframeId: "1m",
            openTimeMs: index * 60_000,
            open: 10,
            high: 12,
            low: 9,
            close: 11,
          })),
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
