import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  RuntimeApplicationShell,
  createInitialWorkspace,
  mergeProviderSessionCandles,
  providerLiveRequestsForWorkspace,
  providerSessionRestoreRequests,
  toPersistedWorkspace,
  workspaceReducer,
} from "../dist/index.js";

async function mountRuntimeShell(t, bridge) {
  const { document, window } = parseHTML(
    '<!doctype html><html><body><main id="test-root"></main></body></html>',
  );
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.document = document;
  globalThis.window = window;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById("test-root"));
  t.after(async () => {
    await act(async () => root.unmount());
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });
  await act(async () =>
    root.render(createElement(RuntimeApplicationShell, { bridge })),
  );
  return document;
}

test("hydrates before showing workspace UI", async (t) => {
  let resolveLoad;
  const loaded = new Promise((resolve) => {
    resolveLoad = resolve;
  });
  const bridge = {
    getRuntimeInfo: async () => ({
      ipcContractVersion: 1,
      applicationName: "ERC Chart",
    }),
    loadWorkspace: async () => loaded,
    saveWorkspace: async () => undefined,
    flushWorkspace: async () => undefined,
  };
  const document = await mountRuntimeShell(t, bridge);

  assert.equal(document.querySelector(".workspace"), null);
  assert.match(document.body.textContent, /Restoring workspace/);

  const restored = workspaceReducer(createInitialWorkspace(), {
    type: "add-workspace",
    tabId: "tab-1",
  });
  await act(async () => resolveLoad(toPersistedWorkspace(restored, 1)));

  assert.equal(document.querySelectorAll("[data-chart-slot]").length, 2);
});

test("persists each real workspace mutation", async (t) => {
  const saves = [];
  const bridge = {
    getRuntimeInfo: async () => ({
      ipcContractVersion: 1,
      applicationName: "ERC Chart",
    }),
    loadWorkspace: async () => null,
    saveWorkspace: async (workspace) => saves.push(workspace),
    flushWorkspace: async () => undefined,
  };
  const document = await mountRuntimeShell(t, bridge);
  await act(async () => undefined);
  const add = document.querySelector(".workspace-add");
  assert.ok(add);

  await act(async () => add.click());
  assert.equal(saves.length, 1);
  assert.equal(saves[0].tabs[0].chartSlots.length, 2);
});

test("restarts each provider profile referenced by restored chart tabs", async (t) => {
  const starts = [];
  let restored = workspaceReducer(createInitialWorkspace(), {
    type: "configure-tab-provider",
    tabId: "tab-1",
    providerProfileId: "profile-a",
    instrumentId: "EURUSD",
    timeframeSeconds: 60,
  });
  restored = workspaceReducer(restored, { type: "add-tab" });
  restored = workspaceReducer(restored, {
    type: "configure-tab-provider",
    tabId: "tab-2",
    providerProfileId: "profile-b",
    instrumentId: "BTCUSD",
    timeframeSeconds: 300,
  });
  restored = workspaceReducer(restored, { type: "add-tab" });
  restored = workspaceReducer(restored, {
    type: "configure-tab-provider",
    tabId: "tab-3",
    providerProfileId: "profile-a",
    instrumentId: "EURUSD",
    timeframeSeconds: 60,
  });
  const bridge = {
    getRuntimeInfo: async () => ({
      ipcContractVersion: 1,
      applicationName: "ERC Chart",
    }),
    loadWorkspace: async () => toPersistedWorkspace(restored, 1),
    saveWorkspace: async () => undefined,
    flushWorkspace: async () => undefined,
    startProviderProfile: async (profileId) => {
      starts.push(profileId);
      return new Promise(() => undefined);
    },
  };

  await mountRuntimeShell(t, bridge);
  await act(async () => Promise.resolve());

  assert.deepEqual(starts.sort(), ["profile-a", "profile-b"]);
});

test("derives saved timeframe restore requests independently per workspace", () => {
  let restored = workspaceReducer(createInitialWorkspace(), {
    type: "add-workspace",
    tabId: "tab-1",
  });
  restored = workspaceReducer(restored, {
    type: "configure-tab-provider",
    tabId: "tab-1",
    providerProfileId: "profile-a",
    instrumentId: "Z-CRY/IDX",
    timeframeSeconds: 60,
  });
  restored = workspaceReducer(restored, {
    type: "configure-workspace",
    tabId: "tab-1",
    workspaceId: "tab-1-chart-2",
    persisted: {
      ...restored.tabs[0].slots[1].persisted,
      timeframeSeconds: 180,
    },
  });
  const baseSession = {
    profileId: "profile-a",
    providerId: "erc.provider.binomo",
    providerName: "Binomo",
    instrument: {
      id: "Z-CRY/IDX",
      symbol: "Z-CRY/IDX",
      name: "Z-CRY/IDX",
    },
    availableTimeframeIds: ["1m", "2m", "3m", "5m"],
    timeframeId: "1m",
    candles: [],
  };

  assert.deepEqual(
    providerSessionRestoreRequests(restored, "profile-a", baseSession),
    [
      {
        profileId: "profile-a",
        instrumentId: "Z-CRY/IDX",
        timeframeId: "3m",
      },
    ],
  );
  assert.deepEqual(
    providerSessionRestoreRequests(restored, "profile-a", {
      ...baseSession,
      availableTimeframeIds: ["1m", "5m"],
    }),
    [],
  );
});

test("derives live provider demand from every chart tab, independent of focus", () => {
  let workspace = workspaceReducer(createInitialWorkspace(), {
    type: "configure-tab-provider",
    tabId: "tab-1",
    providerProfileId: "profile-a",
    instrumentId: "Z-CRY/IDX",
    timeframeSeconds: 5,
  });
  workspace = workspaceReducer(workspace, { type: "add-tab" });
  workspace = workspaceReducer(workspace, {
    type: "configure-tab-provider",
    tabId: "tab-2",
    providerProfileId: "profile-a",
    instrumentId: "Z-CRY/IDX",
    timeframeSeconds: 120,
  });

  const focusedOnChartTwo = providerLiveRequestsForWorkspace(workspace);
  const focusedOnChartOne = providerLiveRequestsForWorkspace(
    workspaceReducer(workspace, { type: "select-tab", tabId: "tab-1" }),
  );

  assert.deepEqual(focusedOnChartTwo, [
    {
      profileId: "profile-a",
      instrumentId: "Z-CRY/IDX",
      timeframeId: "5s",
    },
    {
      profileId: "profile-a",
      instrumentId: "Z-CRY/IDX",
      timeframeId: "2m",
    },
  ]);
  assert.deepEqual(focusedOnChartOne, focusedOnChartTwo);
});

test("merges background live candles into the provider session cache", () => {
  const sessions = [
    {
      profileId: "profile-a",
      providerId: "erc.provider.binomo",
      providerName: "Binomo",
      instrument: {
        id: "Z-CRY/IDX",
        symbol: "Z-CRY/IDX",
        name: "Z-CRY/IDX",
      },
      timeframeId: "5s",
      candles: [
        {
          instrumentId: "Z-CRY/IDX",
          timeframeId: "5s",
          openTimeMs: 1_000,
          open: 100,
          high: 101,
          low: 99,
          close: 100,
        },
      ],
    },
  ];
  const updated = mergeProviderSessionCandles(
    sessions,
    {
      profileId: "profile-a",
      instrumentId: "Z-CRY/IDX",
      timeframeId: "5s",
    },
    [
      {
        instrumentId: "Z-CRY/IDX",
        timeframeId: "5s",
        openTimeMs: 1_000,
        open: 100,
        high: 102,
        low: 99,
        close: 101,
      },
      {
        instrumentId: "Z-CRY/IDX",
        timeframeId: "5s",
        openTimeMs: 6_000,
        open: 101,
        high: 103,
        low: 100,
        close: 102,
      },
    ],
  );

  assert.equal(updated[0].candles.length, 2);
  assert.equal(updated[0].candles[0].close, 101);
  assert.equal(updated[0].candles[1].openTimeMs, 6_000);
});

test("does not overwrite invalid persisted data", async (t) => {
  const saves = [];
  const bridge = {
    getRuntimeInfo: async () => ({
      ipcContractVersion: 1,
      applicationName: "ERC Chart",
    }),
    loadWorkspace: async () => ({ schemaVersion: 1, private: "invalid" }),
    saveWorkspace: async (workspace) => saves.push(workspace),
    flushWorkspace: async () => undefined,
  };
  const document = await mountRuntimeShell(t, bridge);
  await act(async () => undefined);

  assert.equal(document.querySelector(".workspace"), null);
  assert.match(document.body.textContent, /Workspace unavailable/);
  assert.equal(saves.length, 0);
});
