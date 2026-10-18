import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { createDataUtilityClient } from "../dist/index.js";

function fixture(overrides = {}) {
  const listeners = new Set();
  const posted = [];
  const starts = [];
  const timers = new Map();
  let timerId = 0;
  const upstreamCalls = [];
  const transport = {
    async start(entryPath, args, initialMessages) {
      starts.push({ entryPath, args, initialMessages });
    },
    postMessage(message) {
      posted.push(message);
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async shutdown() {
      /* No child process in this fixture. */
    },
  };
  const scheduler = {
    setTimeout(callback) {
      timerId += 1;
      timers.set(timerId, callback);
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const upstream = {
    async getCapabilities(profileId) {
      upstreamCalls.push(["capabilities", profileId]);
      return {
        instruments: true,
        nativeTimeframes: ["1m"],
        liveData: true,
        derivedTimeframes: false,
      };
    },
    async getInstruments(profileId) {
      upstreamCalls.push(["instruments", profileId]);
      return [];
    },
    async requestHistory(profileId, request) {
      upstreamCalls.push(["history", profileId, request]);
      return [];
    },
    async subscribe(profileId, request, sink) {
      upstreamCalls.push(["subscribe", profileId, request]);
      return {
        unsubscribe: async () => upstreamCalls.push(["unsubscribe", profileId]),
        sink,
      };
    },
  };
  const client = createDataUtilityClient({
    transport,
    upstream,
    scheduler,
    requestTimeoutMs: 5_000,
    databasePath: "C:/tmp/erc.sqlite",
    instanceId: "instance:test",
    legacyWorkspaceId: "last-workspace",
    ...overrides,
  });
  return {
    client,
    timers,
    listeners,
    upstream,
    posted,
    starts,
    upstreamCalls,
    emit(message) {
      for (const listener of [...listeners]) listener(message);
    },
    fireTimers() {
      for (const callback of [...timers.values()]) callback();
      timers.clear();
    },
  };
}

test("unsubscribe fences a still-pending upstream acquisition and releases its late handle", async () => {
  let resolveSubscribe;
  let releases = 0;
  let lateSink;
  const target = fixture();
  target.upstream.subscribe = async (_profile, _request, sink) => {
    lateSink = sink;
    return new Promise((resolve) => {
      resolveSubscribe = resolve;
    });
  };
  await target.client.start("/runtime/data.js");
  const acquire = {
    type: "data-upstream-request",
    contractVersion: ipcContractVersion,
    requestId: "acquire:1",
    generation: 1,
    operation: "subscribe",
    providerProfileId: "profile-a",
    payload: {
      subscriptionId: "pending:1",
      request: { instrumentId: "BTCUSD", timeframeId: "1m" },
    },
  };
  target.emit(acquire);
  target.emit({
    ...acquire,
    requestId: "release:1",
    operation: "unsubscribe",
    payload: { subscriptionId: "pending:1" },
  });
  await new Promise(setImmediate);
  const before = target.posted.length;
  lateSink.onError("UPSTREAM_FAILED");
  resolveSubscribe({
    unsubscribe: async () => {
      releases += 1;
    },
  });
  await new Promise(setImmediate);
  assert.equal(
    releases,
    1,
    "cancelled pending upstream must release its late handle",
  );
  assert.equal(
    target.posted.length,
    before,
    "late events and acquisition replies must be fenced",
  );
  await target.client.shutdown();
  assert.equal(releases, 1);
  assert.equal(target.timers.size, 0);
});

test("expired client subscribe requests cancellation in the still-running utility", async () => {
  const target = fixture();
  await target.client.start("/runtime/data.js");
  const pending = target.client.subscribe(
    "profile-a",
    { instrumentId: "BTCUSD", timeframeId: "1m" },
    { onCandles: assert.fail, onTicks: assert.fail, onError: assert.fail },
  );
  const rejected = assert.rejects(pending, /timed out/u);
  const acquire = target.posted.at(-1);
  target.fireTimers();
  await rejected;
  const release = target.posted.at(-1);
  assert.equal(release.operation, "provider-unsubscribe");
  assert.equal(release.payload.subscriptionId, acquire.payload.subscriptionId);
  target.emit(resultFor(release, true));
  await target.client.shutdown();
  assert.equal(target.timers.size, 0);
});

function resultFor(command, payload) {
  return {
    type: "data-result",
    contractVersion: ipcContractVersion,
    requestId: command.requestId,
    generation: command.generation,
    ok: true,
    payload,
  };
}

test("correlates commands within one utility generation", async () => {
  const target = fixture();
  await target.client.start("/runtime/data.js");
  assert.equal(target.starts.length, 1);
  assert.deepEqual(target.starts[0].initialMessages, [
    {
      type: "data-init",
      contractVersion: ipcContractVersion,
      generation: 1,
      databasePath: "C:/tmp/erc.sqlite",
      instanceId: "instance:test",
      legacyWorkspaceId: "last-workspace",
    },
  ]);

  const pending = target.client.getCapabilities("profile-a");
  const command = target.posted.at(-1);
  assert.equal(command.operation, "provider-capabilities");
  target.emit(
    resultFor(command, {
      instruments: true,
      nativeTimeframes: [],
      liveData: false,
      derivedTimeframes: false,
    }),
  );
  assert.equal((await pending).instruments, true);
});

test("bridges utility upstream requests without exposing errors", async () => {
  const target = fixture();
  await target.client.start("/runtime/data.js");
  target.emit({
    type: "data-upstream-request",
    contractVersion: ipcContractVersion,
    requestId: "upstream:1:1",
    generation: 1,
    operation: "request-history",
    providerProfileId: "profile-a",
    payload: { instrumentId: "BTCUSD", timeframeId: "1m", limit: 10 },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(target.upstreamCalls, [
    [
      "history",
      "profile-a",
      { instrumentId: "BTCUSD", timeframeId: "1m", limit: 10 },
    ],
  ]);
  assert.deepEqual(target.posted.at(-1), {
    type: "data-upstream-result",
    contractVersion: ipcContractVersion,
    requestId: "upstream:1:1",
    generation: 1,
    ok: true,
    payload: [],
  });
});

test("rejects pending work on utility failure and ignores old generation replies", async () => {
  const target = fixture();
  await target.client.start("/runtime/data.js");
  const first = target.client.getInstruments("profile-a");
  const oldCommand = target.posted.at(-1);
  target.client.markUnavailable();
  await assert.rejects(first, new Error("Data utility unavailable."));

  await target.client.start("/runtime/data.js");
  const second = target.client.getInstruments("profile-a");
  const newCommand = target.posted.at(-1);
  target.emit(resultFor(oldCommand, [{ id: "OLD" }]));
  target.emit(resultFor(newCommand, [{ id: "BTCUSD" }]));
  assert.deepEqual(await second, [{ id: "BTCUSD" }]);
});

test("times out bounded pending commands with a sanitized error", async () => {
  const target = fixture();
  await target.client.start("/runtime/data.js");
  const pending = target.client.processInfo();
  target.fireTimers();
  await assert.rejects(
    pending,
    new Error("Data utility request timed out (process-info)."),
  );
});

test("crash rejects pending write and subscribe, fences live events and releases late upstream", async () => {
  const target = fixture();
  await target.client.start("/runtime/data.js");
  let release;
  let releases = 0;
  target.upstream.subscribe = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  target.emit({
    type: "data-upstream-request",
    contractVersion: ipcContractVersion,
    requestId: "upstream:pending",
    generation: 1,
    operation: "subscribe",
    providerProfileId: "profile-a",
    payload: {
      subscriptionId: "upstream:live",
      request: { instrumentId: "BTCUSD", timeframeId: "1m" },
    },
  });
  const events = [];
  const sink = {
    onCandles: () => events.push("candles"),
    onTicks: () => events.push("ticks"),
    onError: (code) => events.push(code),
  };
  const write = target.client.saveWorkspace({ id: "last-workspace" });
  const writeCommand = target.posted.at(-1);
  const subscription = target.client.subscribe(
    "profile-a",
    { instrumentId: "BTCUSD", timeframeId: "1m" },
    sink,
  );
  const subscribeCommand = target.posted.at(-1);
  const rejected = Promise.all([
    assert.rejects(write, /Data utility unavailable/u),
    assert.rejects(subscription, /Data utility unavailable/u),
  ]);
  target.client.markUnavailable();
  await rejected;
  assert.equal(target.timers.size, 0);
  assert.deepEqual(events, ["DATA_UTILITY_UNAVAILABLE"]);
  await target.client.start("/runtime/data.js");
  const postedCount = target.posted.length;
  release({
    unsubscribe: async () => {
      releases += 1;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  target.emit(resultFor(writeCommand, true));
  target.emit(resultFor(subscribeCommand, true));
  target.emit({
    type: "data-event",
    contractVersion: ipcContractVersion,
    generation: 1,
    subscriptionId: subscribeCommand.payload.subscriptionId,
    event: "error",
    payload: "OLD_EVENT",
  });
  assert.equal(releases, 1);
  assert.equal(target.posted.length, postedCount);
  assert.deepEqual(events, ["DATA_UTILITY_UNAVAILABLE"]);
  await target.client.shutdown();
  assert.equal(target.listeners.size, 0);
});

test("full request queue rejects excess work and reclaims capacity after timeout", async () => {
  const target = fixture({ maximumPendingRequests: 2 });
  await target.client.start("/runtime/data.js");
  const first = target.client.processInfo();
  const firstCommand = target.posted.at(-1);
  const second = target.client.processInfo();
  const secondCommand = target.posted.at(-1);
  await assert.rejects(
    target.client.processInfo(),
    new Error("Data utility request capacity exceeded."),
  );
  assert.equal(target.posted.length, 2);
  assert.equal(target.timers.size, 2);
  target.emit(resultFor(firstCommand, { pid: 10 }));
  target.emit(resultFor(firstCommand, { pid: 999 }));
  assert.deepEqual(await first, { pid: 10 });
  const timeout = assert.rejects(second, /timed out/u);
  target.fireTimers();
  await timeout;
  target.emit(resultFor(secondCommand, { pid: 999 }));
  const next = target.client.processInfo();
  target.emit(resultFor(target.posted.at(-1), { pid: 20 }));
  assert.deepEqual(await next, { pid: 20 });
  assert.equal(target.timers.size, 0);
  await target.client.shutdown();
  assert.equal(target.listeners.size, 0);
});

test("late unsubscribe acknowledgement cannot settle restarted generation work", async () => {
  const target = fixture();
  await target.client.start("/runtime/data.js");
  const subscribed = target.client.subscribe(
    "profile-a",
    { instrumentId: "BTCUSD", timeframeId: "1m" },
    { onCandles: assert.fail, onTicks: assert.fail, onError: () => undefined },
  );
  target.emit(resultFor(target.posted.at(-1), true));
  const handle = await subscribed;
  const stopping = handle.unsubscribe();
  const old = target.posted.at(-1);
  const rejected = assert.rejects(stopping, /unavailable/u);
  target.client.markUnavailable();
  await rejected;
  await target.client.start("/runtime/data.js");
  const pending = target.client.processInfo();
  const current = target.posted.at(-1);
  target.emit(resultFor(old, true));
  assert.equal(target.timers.size, 1);
  target.emit(resultFor(current, { pid: 42 }));
  assert.deepEqual(await pending, { pid: 42 });
  await handle.unsubscribe();
  assert.equal(target.timers.size, 0);
  await target.client.shutdown();
});
