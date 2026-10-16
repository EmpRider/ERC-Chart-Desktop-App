import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ipcContractVersion } from "@erc-chart/contracts";
import { createUtilityRuntime } from "../dist/index.js";
import { createDataUtilityClient } from "../../electron-main/dist/index.js";

function createPort() {
  const listeners = new Set();
  const sent = [];
  return {
    sent,
    port: {
      postMessage(message) {
        sent.push(message);
      },
      onMessage(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    receive(message) {
      for (const listener of [...listeners]) listener(message);
    },
    getListenerCount: () => listeners.size,
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Condition was not reached.");
}

test("data utility becomes ready only after storage/service initialization", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-data-utility-"));
  const fixture = createPort();
  const runtime = createUtilityRuntime(fixture.port);
  try {
    assert.deepEqual(fixture.sent, []);
    fixture.receive({
      type: "data-init",
      contractVersion: ipcContractVersion,
      generation: 3,
      databasePath: path.join(root, "erc-chart.sqlite"),
      instanceId: "instance:test",
      legacyWorkspaceId: "last-workspace",
    });
    await waitFor(() => fixture.sent.some(({ type }) => type === "ready"));
    assert.deepEqual(fixture.sent, [
      { type: "ready", contractVersion: ipcContractVersion },
    ]);

    fixture.receive({ type: "unknown", contractVersion: ipcContractVersion });
    assert.equal(fixture.sent.length, 1);

    fixture.receive({
      type: "shutdown",
      contractVersion: ipcContractVersion,
    });
    await waitFor(() => fixture.sent.some(({ type }) => type === "stopped"));
    await runtime.shutdown();

    assert.deepEqual(fixture.sent, [
      { type: "ready", contractVersion: ipcContractVersion },
      { type: "stopped", contractVersion: ipcContractVersion },
    ]);
    assert.equal(fixture.getListenerCount(), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace saves overwrite one canonical row and restart restores it automatically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-data-workspace-"));
  const databasePath = path.join(root, "data.sqlite");
  const first = createPort();
  const firstRuntime = createUtilityRuntime(first.port);
  const workspace = {
    schemaVersion: 1,
    id: "last-workspace",
    name: "First",
    activeTabId: "tab-1",
    tabs: [
      {
        id: "tab-1",
        title: "Chart 1",
        layout: "grid-1",
        chartSlots: [
          {
            id: "tab-1-chart-1",
            providerProfileId: "local-default",
            instrumentId: "UNCONFIGURED",
            timeframeSeconds: 60,
            chartType: "candlestick",
            indicators: [],
          },
        ],
      },
    ],
    savedAtMs: 1,
  };
  try {
    first.receive({
      type: "data-init",
      contractVersion: ipcContractVersion,
      generation: 1,
      databasePath,
      instanceId: "instance:first",
      legacyWorkspaceId: "last-workspace",
    });
    await waitFor(() => first.sent.some(({ type }) => type === "ready"));
    for (const [requestId, payload] of [
      ["workspace:first", workspace],
      ["workspace:second", { ...workspace, name: "Second", savedAtMs: 2 }],
    ]) {
      first.receive({
        type: "data-command",
        contractVersion: ipcContractVersion,
        requestId,
        generation: 1,
        operation: "workspace-save",
        payload,
      });
      await waitFor(() =>
        first.sent.some(
          (message) =>
            message.type === "data-result" && message.requestId === requestId,
        ),
      );
      assert.equal(
        first.sent.find(
          (message) =>
            message.type === "data-result" && message.requestId === requestId,
        ).ok,
        true,
      );
    }
    await firstRuntime.shutdown();

    const second = createPort();
    const secondRuntime = createUtilityRuntime(second.port);
    try {
      second.receive({
        type: "data-init",
        contractVersion: ipcContractVersion,
        generation: 2,
        databasePath,
        instanceId: "instance:second",
        legacyWorkspaceId: "last-workspace",
      });
      await waitFor(() => second.sent.some(({ type }) => type === "ready"));
      second.receive({
        type: "data-command",
        contractVersion: ipcContractVersion,
        requestId: "workspace:load",
        generation: 2,
        operation: "workspace-load",
        payload: null,
      });
      await waitFor(() =>
        second.sent.some(
          (message) =>
            message.type === "data-result" &&
            message.requestId === "workspace:load",
        ),
      );
      const loaded = second.sent.find(
        (message) =>
          message.type === "data-result" &&
          message.requestId === "workspace:load",
      );
      assert.equal(loaded.ok, true);
      assert.equal(loaded.payload.name, "Second");

      second.receive({
        type: "data-command",
        contractVersion: ipcContractVersion,
        requestId: "workspace:third",
        generation: 2,
        operation: "workspace-save",
        payload: { ...workspace, name: "Third", savedAtMs: 3 },
      });
      await waitFor(() =>
        second.sent.some(
          (message) =>
            message.type === "data-result" &&
            message.requestId === "workspace:third",
        ),
      );
      assert.equal(
        second.sent.find(
          (message) =>
            message.type === "data-result" &&
            message.requestId === "workspace:third",
        ).ok,
        true,
      );
    } finally {
      await secondRuntime.shutdown();
    }

    const database = new DatabaseSync(databasePath);
    try {
      const rows = database
        .prepare("SELECT id, document_json FROM workspaces ORDER BY id")
        .all();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, "last-workspace");
      assert.equal(JSON.parse(rows[0].document_json).name, "Third");
    } finally {
      database.close();
    }
  } finally {
    await firstRuntime.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

test("utility rejects malformed envelopes, bounds upstream work and drains pending requests on shutdown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-data-capacity-"));
  const fixture = createPort();
  const runtime = createUtilityRuntime(fixture.port);
  try {
    fixture.receive({
      type: "data-init",
      contractVersion: ipcContractVersion,
      generation: 1,
      databasePath: path.join(root, "data.sqlite"),
      instanceId: "instance:test",
      legacyWorkspaceId: "last-workspace",
    });
    await waitFor(() => fixture.sent.some(({ type }) => type === "ready"));
    const command = {
      type: "data-command",
      contractVersion: ipcContractVersion,
      generation: 1,
      requestId: "capacity:0",
      operation: "provider-instruments",
      payload: { profileId: "profile-a" },
    };
    for (const invalid of [
      { ...command, extra: true },
      { ...command, contractVersion: 999 },
      { ...command, payload: Array(100_001).fill(null) },
    ])
      fixture.receive(invalid);
    assert.equal(fixture.sent.length, 1);
    for (let index = 0; index < 257; index += 1)
      fixture.receive({ ...command, requestId: `capacity:${index}` });
    await waitFor(() =>
      fixture.sent.some(
        ({ type, requestId }) =>
          type === "data-result" && requestId === "capacity:256",
      ),
    );
    const requests = fixture.sent.filter(
      ({ type }) => type === "data-upstream-request",
    );
    assert.equal(requests.length, 256);
    assert.deepEqual(
      fixture.sent.find(({ requestId }) => requestId === "capacity:256"),
      {
        type: "data-result",
        contractVersion: ipcContractVersion,
        generation: 1,
        requestId: "capacity:256",
        ok: false,
        code: "DATA_OPERATION_FAILED",
      },
    );
    fixture.receive({
      type: "data-upstream-result",
      contractVersion: ipcContractVersion,
      generation: 0,
      requestId: requests[0].requestId,
      ok: true,
      payload: [],
    });
    fixture.receive({
      type: "data-upstream-result",
      contractVersion: ipcContractVersion,
      generation: 1,
      requestId: requests[0].requestId,
      ok: true,
      payload: Array(100_001).fill(null),
    });
    await runtime.shutdown();
    await waitFor(
      () =>
        fixture.sent.filter(({ type }) => type === "data-result").length ===
        257,
    );
    assert.ok(
      fixture.sent
        .filter(({ type }) => type === "data-result")
        .every(({ ok, code }) => !ok && code === "DATA_OPERATION_FAILED"),
    );
    assert.equal(fixture.getListenerCount(), 0);
    assert.equal(
      fixture.sent.filter(({ type }) => type === "stopped").length,
      1,
    );
  } finally {
    await runtime.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

test("utility expiry reclaims its full upstream queue before shutdown and ignores late results", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-data-expiry-"));
  const fixture = createPort();
  const timers = new Map();
  let sequence = 0;
  const runtime = createUtilityRuntime(fixture.port, {
    setTimeout(callback) {
      timers.set(++sequence, callback);
      return sequence;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  try {
    fixture.receive({
      type: "data-init",
      contractVersion: ipcContractVersion,
      generation: 1,
      databasePath: path.join(root, "data.sqlite"),
      instanceId: "instance:test",
      legacyWorkspaceId: "last-workspace",
    });
    await waitFor(() => fixture.sent.some(({ type }) => type === "ready"));
    const command = {
      type: "data-command",
      contractVersion: ipcContractVersion,
      generation: 1,
      requestId: "expiry:0",
      operation: "provider-instruments",
      payload: { profileId: "profile-a" },
    };
    for (let index = 0; index < 256; index += 1)
      fixture.receive({ ...command, requestId: `expiry:${index}` });
    assert.equal(
      timers.size,
      256,
      "the utility must own upstream deadlines, independent of the client",
    );
    const expired = fixture.sent.filter(
      ({ type }) => type === "data-upstream-request",
    );
    for (const [id, callback] of [...timers]) {
      timers.delete(id);
      callback();
    }
    await waitFor(
      () =>
        fixture.sent.filter(({ type }) => type === "data-result").length ===
        256,
    );
    assert.ok(
      fixture.sent
        .filter(({ type }) => type === "data-result")
        .every(({ ok, code }) => !ok && code === "DATA_UPSTREAM_TIMEOUT"),
    );
    fixture.receive({ ...command, requestId: "after-expiry" });
    const fresh = fixture.sent.at(-1);
    assert.equal(fresh.type, "data-upstream-request");
    const reply = (request) =>
      fixture.receive({
        type: "data-upstream-result",
        contractVersion: ipcContractVersion,
        generation: 1,
        requestId: request.requestId,
        ok: true,
        payload: [],
      });
    for (const request of expired) reply(request);
    assert.equal(timers.size, 1);
    reply(fresh);
    await waitFor(() =>
      fixture.sent.some(
        ({ requestId, ok }) => requestId === "after-expiry" && ok,
      ),
    );
    assert.equal(timers.size, 0);
    await runtime.shutdown();
    assert.equal(fixture.getListenerCount(), 0);
  } finally {
    await runtime.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

test("connected client and utility reclaim expired subscriptions without restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-data-cancel-"));
  const runtimeListeners = new Set();
  const clientListeners = new Set();
  let ready = false;
  const scheduler = () => {
    const timers = new Map();
    let sequence = 0;
    return {
      timers,
      setTimeout(callback, delayMs) {
        timers.set(++sequence, { callback, delayMs });
        return sequence;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
      expire() {
        for (const [id, { callback }] of [...timers]) {
          timers.delete(id);
          callback();
        }
      },
      advance(milliseconds) {
        for (const [id, timer] of [...timers]) {
          timer.delayMs -= milliseconds;
          if (timer.delayMs <= 0) {
            timers.delete(id);
            timer.callback();
          }
        }
      },
    };
  };
  const runtimeClock = scheduler();
  const clientClock = scheduler();
  const runtime = createUtilityRuntime(
    {
      postMessage(message) {
        if (message.type === "ready") ready = true;
        for (const listener of [...clientListeners]) listener(message);
      },
      onMessage(listener) {
        runtimeListeners.add(listener);
        return () => runtimeListeners.delete(listener);
      },
    },
    runtimeClock,
  );
  const acquisitions = [];
  const historyRequests = [];
  let releases = 0;
  const client = createDataUtilityClient({
    transport: {
      async start(_entry, _args, messages) {
        for (const message of messages)
          for (const listener of runtimeListeners) listener(message);
        await waitFor(() => ready);
      },
      postMessage(message) {
        for (const listener of [...runtimeListeners]) listener(message);
      },
      onMessage(listener) {
        clientListeners.add(listener);
        return () => clientListeners.delete(listener);
      },
      shutdown: () => runtime.shutdown(),
    },
    scheduler: clientClock,
    requestTimeoutMs: 5_000,
    databasePath: path.join(root, "data.sqlite"),
    instanceId: "instance:test",
    legacyWorkspaceId: "last-workspace",
    upstream: {
      getCapabilities: async () => ({
        instruments: true,
        nativeTimeframes: ["1m"],
        liveData: true,
        derivedTimeframes: false,
      }),
      getInstruments: async () => [],
      requestHistory: async () =>
        new Promise((resolve) => historyRequests.push(resolve)),
      subscribe: async (_profile, _request, sink) =>
        new Promise((resolve) =>
          acquisitions.push({
            sink,
            resolve: () =>
              resolve({
                unsubscribe: async () => {
                  releases += 1;
                },
              }),
          }),
        ),
    },
  });
  try {
    await client.start("synthetic-entry");
    const history = client.requestHistory("profile-history", {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      fromMs: 0,
      toMs: 60_000,
      limit: 1,
    });
    let historySettled = false;
    void history.then(
      () => {
        historySettled = true;
      },
      () => {
        historySettled = true;
      },
    );
    await waitFor(() => historyRequests.length === 1);
    clientClock.advance(6_000);
    runtimeClock.advance(6_000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      historySettled,
      false,
      "a six-second history load must remain active",
    );
    historyRequests[0]([]);
    assert.deepEqual(await history, []);

    const stalledHistory = client.requestHistory("profile-timeout", {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      fromMs: 0,
      toMs: 60_000,
      limit: 1,
    });
    const timeoutResult = assert.rejects(
      stalledHistory,
      /DATA_UPSTREAM_TIMEOUT/u,
    );
    await waitFor(() => historyRequests.length === 2);
    runtimeClock.advance(120_000);
    await timeoutResult;
    historyRequests[1]([]);
    await waitFor(
      () => clientClock.timers.size === 0 && runtimeClock.timers.size === 0,
    );

    const sink = {
      onCandles: assert.fail,
      onTicks: assert.fail,
      onError: assert.fail,
    };
    for (const [index, clock] of [clientClock, runtimeClock].entries()) {
      const pending = client.subscribe(
        `profile-${index}`,
        { instrumentId: "BTCUSD", timeframeId: "1m" },
        sink,
      );
      const rejected = assert.rejects(
        pending,
        /timed out|DATA_OPERATION_FAILED|DATA_UPSTREAM_TIMEOUT/u,
      );
      await waitFor(() => acquisitions.length === index + 1);
      clock.expire();
      await rejected;
      if (clock === clientClock) runtimeClock.expire();
      await waitFor(
        () => clientClock.timers.size === 0 && runtimeClock.timers.size === 0,
      );
      acquisitions[index].sink.onError("UPSTREAM_FAILED");
      acquisitions[index].resolve();
      await waitFor(() => releases === index + 1);
      await waitFor(
        () => clientClock.timers.size === 0 && runtimeClock.timers.size === 0,
      );
    }
    const pending = client.subscribe(
      "profile-fresh",
      { instrumentId: "BTCUSD", timeframeId: "1m" },
      sink,
    );
    await waitFor(() => acquisitions.length === 3);
    acquisitions[2].resolve();
    const subscription = await pending;
    await subscription.unsubscribe();
    await subscription.unsubscribe();
    assert.equal(releases, 3);
    assert.equal(runtimeClock.timers.size, 0);
    assert.equal(clientClock.timers.size, 0);
    await client.shutdown();
    assert.equal(runtimeListeners.size, 0);
    assert.equal(clientListeners.size, 0);
  } finally {
    await client.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

test("data utility routes provider history through the parent upstream bridge", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-data-history-"));
  const fixture = createPort();
  const runtime = createUtilityRuntime(fixture.port);
  try {
    fixture.receive({
      type: "data-init",
      contractVersion: ipcContractVersion,
      generation: 7,
      databasePath: path.join(root, "erc-chart.sqlite"),
      instanceId: "instance:test",
      legacyWorkspaceId: "last-workspace",
    });
    await waitFor(() => fixture.sent.some(({ type }) => type === "ready"));
    fixture.sent.length = 0;

    fixture.receive({
      type: "data-command",
      contractVersion: ipcContractVersion,
      requestId: "request:history",
      generation: 7,
      operation: "provider-history",
      payload: {
        profileId: "profile-a",
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        fromMs: 0,
        toMs: 60_000,
        limit: 2,
      },
    });

    await waitFor(() =>
      fixture.sent.some(({ type }) => type === "data-upstream-request"),
    );
    const capabilities = fixture.sent.find(
      (message) =>
        message.type === "data-upstream-request" &&
        message.operation === "get-capabilities",
    );
    assert.ok(capabilities);
    fixture.receive({
      type: "data-upstream-result",
      contractVersion: ipcContractVersion,
      requestId: capabilities.requestId,
      generation: 7,
      ok: true,
      payload: {
        instruments: true,
        nativeTimeframes: ["1m"],
        liveData: true,
        derivedTimeframes: false,
        timeframes: [
          {
            id: "1m",
            seconds: 60,
            historical: true,
            live: true,
            native: true,
            alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
          },
        ],
      },
    });

    await waitFor(() =>
      fixture.sent.some(
        ({ type, operation }) =>
          type === "data-upstream-request" && operation === "request-history",
      ),
    );
    const history = fixture.sent.find(
      (message) =>
        message.type === "data-upstream-request" &&
        message.operation === "request-history",
    );
    assert.ok(history);
    fixture.receive({
      type: "data-upstream-result",
      contractVersion: ipcContractVersion,
      requestId: history.requestId,
      generation: 7,
      ok: true,
      payload: [
        {
          instrumentId: "BTCUSD",
          timeframeId: "1m",
          openTimeMs: 0,
          open: 10,
          high: 12,
          low: 9,
          close: 11,
        },
      ],
    });

    await waitFor(() =>
      fixture.sent.some(
        ({ type, requestId }) =>
          type === "data-result" && requestId === "request:history",
      ),
    );
    const result = fixture.sent.find(
      (message) =>
        message.type === "data-result" &&
        message.requestId === "request:history",
    );
    assert.equal(result.ok, true);
    assert.equal(result.payload[0].close, 11);
  } finally {
    await runtime.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
