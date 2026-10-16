import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app, BrowserWindow, ipcMain, utilityProcess } from "electron";
import { createProviderLiveSubscriptionManager } from "../apps/desktop/dist/provider-live-subscriptions.js";
import {
  createDataUtilityClient,
  createUtilitySupervisor,
} from "../packages/electron-main/dist/index.js";

const root = path.resolve(import.meta.dirname, "..");
const entryPath = path.join(
  root,
  "packages/data-service/dist/utility-entry.js",
);
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "erc-data-utility-smoke-"));
const databasePath = path.join(tempRoot, "erc-chart.sqlite");
let activeChild;
let client;
let window;
let rendererSubscriptions;
let historyMode = "normal";
let releaseDelayedHistory;
let releaseDelayedSubscription;
let writeBlocker;
const liveSinks = new Set();
// Keep the smoke main alive while the renderer closes and the utility restarts.
app.on("window-all-closed", () => undefined);

function adaptUtilityChild(child) {
  activeChild = child;
  return {
    postMessage(message) {
      child.postMessage(message);
    },
    kill() {
      child.kill();
    },
    onMessage(listener) {
      child.on("message", listener);
      return () => child.off("message", listener);
    },
    onExit(listener) {
      child.on("exit", listener);
      return () => child.off("exit", listener);
    },
  };
}

const supervisor = createUtilitySupervisor({
  spawn(entry, args) {
    return adaptUtilityChild(
      utilityProcess.fork(entry, [...args], {
        serviceName: "ERC Chart Data Utility Smoke",
        stdio: "ignore",
      }),
    );
  },
  scheduler: {
    setTimeout(callback, delayMs) {
      return setTimeout(callback, delayMs);
    },
    clearTimeout(timer) {
      clearTimeout(timer);
    },
  },
  startupTimeoutMs: 5_000,
  shutdownTimeoutMs: 2_000,
  onUnavailable() {
    client?.markUnavailable();
  },
});

const upstream = {
  async getCapabilities() {
    return {
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
    };
  },
  async getInstruments() {
    return [{ id: "BTCUSD", symbol: "BTCUSD", name: "Bitcoin" }];
  },
  async requestHistory(_profileId, request) {
    if (historyMode === "delayed") {
      return new Promise((resolve) => {
        releaseDelayedHistory = () =>
          resolve([
            {
              instrumentId: request.instrumentId,
              timeframeId: request.timeframeId,
              openTimeMs: 0,
              open: 90,
              high: 91,
              low: 89,
              close: 90,
            },
          ]);
      });
    }
    return [
      {
        instrumentId: request.instrumentId,
        timeframeId: request.timeframeId,
        openTimeMs: 0,
        open: 100,
        high: 102,
        low: 99,
        close: 101,
      },
    ];
  },
  async subscribe(profileId, _request, sink) {
    liveSinks.add(sink);
    const handle = {
      async unsubscribe() {
        liveSinks.delete(sink);
      },
    };
    if (profileId === "profile-pending") {
      return new Promise((resolve) => {
        releaseDelayedSubscription = () => resolve(handle);
      });
    }
    return handle;
  },
};

client = createDataUtilityClient({
  transport: supervisor,
  upstream,
  scheduler: {
    setTimeout(callback, delayMs) {
      return setTimeout(callback, delayMs);
    },
    clearTimeout(timer) {
      clearTimeout(timer);
    },
  },
  requestTimeoutMs: 5_000,
  databasePath,
  instanceId: "instance:utility-smoke",
  legacyWorkspaceId: "last-workspace",
});

async function waitFor(predicate, label = "utility condition") {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Data utility smoke condition was not reached: ${label}`);
}

async function openLiveRenderer() {
  // Trusted synthetic entry: real renderer/preload/live manager, no production IPC changes.
  const workspace = {
    schemaVersion: 1,
    id: "last-workspace",
    name: "Crash fixture",
    activeTabId: "tab-1",
    savedAtMs: 1,
    tabs: [
      {
        id: "tab-1",
        title: "Chart",
        providerProfileId: "profile-a",
        layout: "grid-1",
        chartSlots: [
          {
            id: "chart-1",
            providerProfileId: "profile-a",
            instrumentId: "BTCUSD",
            timeframeSeconds: 60,
            chartType: "candlestick",
            indicators: [],
          },
        ],
      },
    ],
  };
  await client.saveWorkspace(workspace);
  const session = {
    profileId: "profile-a",
    providerId: "erc.provider.fixture",
    providerName: "Fixture",
    instrument: { id: "BTCUSD", symbol: "BTCUSD", name: "Bitcoin" },
    timeframeId: "1m",
    availableTimeframeIds: ["1m"],
    candles: await client.requestHistory("profile-a", {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      limit: 2,
    }),
  };
  rendererSubscriptions = createProviderLiveSubscriptionManager({
    subscribeProviderData: client.subscribe,
  });
  const handlers = {
    "erc-chart:runtime-info": () => ({
      ipcContractVersion: 1,
      applicationName: "ERC Chart",
    }),
    "erc-chart:workspace-load": () => client.loadWorkspace(),
    "erc-chart:workspace-save": async (_event, value) => {
      await client.saveWorkspace(value);
      return true;
    },
    "erc-chart:indicators-list": () => [],
    "erc-chart:provider-profile-start": () => session,
    "erc-chart:provider-session-load": () => session,
    "erc-chart:provider-history-load": (_event, request) =>
      client.requestHistory(request.profileId, request),
    "erc-chart:provider-live-subscribe": async (event, request) => {
      await rendererSubscriptions.start(request, {
        ownerId: event.sender.id,
        isClosed: () => event.sender.isDestroyed(),
        send: (value) =>
          event.sender.send("erc-chart:provider-live-event", value),
        onClosed: (listener) => {
          event.sender.on("destroyed", listener);
          return () => event.sender.off("destroyed", listener);
        },
      });
      return true;
    },
    "erc-chart:provider-live-unsubscribe": (event, subscriptionId) =>
      rendererSubscriptions.stop(subscriptionId, event.sender.id),
  };
  for (const [channel, handler] of Object.entries(handlers))
    ipcMain.handle(channel, handler);
  window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(root, "apps/desktop/dist/runtime/preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadFile(
    path.join(root, "apps/desktop/dist/runtime/index.html"),
  );
  await waitFor(() =>
    window.webContents.executeJavaScript(
      "document.querySelector('.provider-chart') !== null",
    ),
  );
  assert.deepEqual(
    await window.webContents.executeJavaScript(
      "[typeof process, typeof require]",
    ),
    ["undefined", "undefined"],
  );
}

async function run() {
  try {
    await app.whenReady();
    await client.start(entryPath);
    const processInfo = await client.processInfo();
    assert.notEqual(processInfo.pid, process.pid);

    const first = await client.requestHistory("profile-a", {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      fromMs: 0,
      toMs: 60_000,
      limit: 2,
    });
    assert.equal(first[0]?.close, 101);

    const liveEvents = [];
    const subscription = await client.subscribe(
      "profile-a",
      { instrumentId: "BTCUSD", timeframeId: "1m" },
      {
        onCandles(candles, series) {
          liveEvents.push({ candles, series });
        },
        onTicks() {
          /* This scenario checks candle delivery. */
        },
        onError(code) {
          liveEvents.push({ code });
        },
      },
    );
    assert.equal(liveSinks.size, 1);
    for (const sink of liveSinks) {
      sink.onCandles([
        {
          instrumentId: "BTCUSD",
          timeframeId: "1m",
          openTimeMs: 60_000,
          open: 101,
          high: 103,
          low: 100,
          close: 102,
        },
      ]);
    }
    await waitFor(() =>
      liveEvents.some((event) => event.candles?.length === 1),
    );
    await openLiveRenderer();
    const savedWorkspace = await client.loadWorkspace();
    const pendingSubscribe = client.subscribe(
      "profile-pending",
      { instrumentId: "BTCUSD", timeframeId: "1m" },
      {
        onCandles: assert.fail,
        onTicks: assert.fail,
        onError: () => undefined,
      },
    );
    const subscribeRejected = assert.rejects(pendingSubscribe, /unavailable/u);
    await waitFor(
      () => releaseDelayedSubscription !== undefined,
      "pending upstream subscribe",
    );

    historyMode = "delayed";
    const pending = client.requestHistory("profile-a", {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      fromMs: 0,
      toMs: 60_000,
      limit: 2,
    });
    await waitFor(() => typeof releaseDelayedHistory === "function");
    writeBlocker = new DatabaseSync(databasePath);
    writeBlocker.exec("BEGIN IMMEDIATE");
    const pendingWrite = client.saveWorkspace({
      ...savedWorkspace,
      name: "Unacknowledged write",
    });
    const writeRejected = assert.rejects(pendingWrite, /unavailable/u);
    activeChild.kill();
    await Promise.all([
      assert.rejects(pending, /unavailable/u),
      writeRejected,
      subscribeRejected,
    ]);
    writeBlocker.exec("ROLLBACK");
    writeBlocker.close();
    writeBlocker = undefined;
    await waitFor(() => supervisor.getStatus() === "failed");
    assert.ok(
      liveEvents.some(({ code }) => code === "DATA_UTILITY_UNAVAILABLE"),
    );
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          "document.querySelector('[data-live-status]')?.textContent === 'Live data stale'",
        ),
      "active renderer stale label",
    );
    const slotsBefore = await window.webContents.executeJavaScript(
      "document.querySelectorAll('[data-chart-slot]').length",
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('.workspace-add').click()",
    );
    await waitFor(
      async () =>
        (await window.webContents.executeJavaScript(
          "document.querySelectorAll('[data-chart-slot]').length",
        )) ===
        slotsBefore + 1,
    );
    await subscription.unsubscribe();
    await rendererSubscriptions.shutdown();
    window.destroy();
    window = undefined;

    historyMode = "normal";
    await client.start(entryPath);
    const restarted = await client.processInfo();
    assert.notEqual(restarted.pid, process.pid);
    assert.notEqual(restarted.pid, processInfo.pid);
    releaseDelayedHistory?.();
    releaseDelayedSubscription?.();
    await waitFor(
      () => liveSinks.size === 0,
      "release old generation subscriptions",
    );
    assert.deepEqual(await client.loadWorkspace(), savedWorkspace);
    const afterRestart = await client.requestHistory("profile-a", {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      fromMs: 0,
      toMs: 60_000,
      limit: 2,
    });
    assert.equal(afterRestart[0]?.close, 101);

    console.log("ERC_CHART_DATA_UTILITY_SMOKE_READY");
  } finally {
    if (writeBlocker?.isTransaction) writeBlocker.exec("ROLLBACK");
    writeBlocker?.close();
    releaseDelayedSubscription?.();
    window?.destroy();
    await rendererSubscriptions?.shutdown().catch(() => undefined);
    await client.shutdown().catch(() => undefined);
    rmSync(tempRoot, { recursive: true, force: true });
    app.quit();
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  app.quit();
});
