import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { createErcChartBridge, installBridge } from "../dist/index.js";

test("exposes only the allowlisted application bridge methods", async () => {
  const calls = [];
  const bridge = createErcChartBridge(async (...args) => {
    calls.push(args);
    return {
      ipcContractVersion,
      applicationName: "ERC Chart",
    };
  });

  assert.deepEqual(Object.keys(bridge), [
    "getRuntimeInfo",
    "loadWorkspace",
    "saveWorkspace",
    "flushWorkspace",
    "previewProviderImport",
    "approveProviderImport",
    "cancelProviderImport",
    "listProviderProfiles",
    "createProviderProfile",
    "updateProviderProfile",
    "startProviderProfile",
    "loadProviderSession",
    "stopProviderProfile",
    "deleteProviderProfile",
    "subscribeProviderData",
  ]);
  assert.deepEqual(await bridge.getRuntimeInfo(), {
    ipcContractVersion,
    applicationName: "ERC Chart",
  });
  assert.deepEqual(calls, [["erc-chart:runtime-info"]]);
});

test("rejects malformed runtime information with a safe error", async () => {
  const bridge = createErcChartBridge(async () => ({
    ipcContractVersion: 2,
    applicationName: "ERC Chart",
  }));

  await assert.rejects(
    bridge.getRuntimeInfo(),
    new Error("Runtime information unavailable."),
  );
});

test("redacts rejected IPC errors before they reach the renderer", async () => {
  const bridge = createErcChartBridge(async () => {
    throw new Error("private path C:\\Users\\fixture\\runtime.json");
  });

  await assert.rejects(
    bridge.getRuntimeInfo(),
    new Error("Runtime information unavailable."),
  );
});

test("installs one application-specific global", () => {
  const exposures = [];
  installBridge(
    (key, value) => exposures.push([key, Object.keys(value)]),
    async () => ({
      ipcContractVersion,
      applicationName: "ERC Chart",
    }),
  );

  assert.deepEqual(exposures, [
    [
      "ercChart",
      [
        "getRuntimeInfo",
        "loadWorkspace",
        "saveWorkspace",
        "flushWorkspace",
        "previewProviderImport",
        "approveProviderImport",
        "cancelProviderImport",
        "listProviderProfiles",
        "createProviderProfile",
        "updateProviderProfile",
        "startProviderProfile",
        "loadProviderSession",
        "stopProviderProfile",
        "deleteProviderProfile",
        "subscribeProviderData",
      ],
    ],
  ]);
});

test("validates provider management commands across the preload boundary", async () => {
  const calls = [];
  const session = {
    profileId: "profile-a",
    providerId: "erc.provider.fixture",
    providerName: "Fixture",
    instrument: { id: "BTCUSD", symbol: "BTCUSD", name: "Bitcoin" },
    timeframeId: "1m",
    candles: [],
  };
  const profile = {
    profileId: "profile-a",
    providerId: "erc.provider.fixture",
    providerName: "Fixture",
    version: "1.0.0",
    displayName: "Primary",
    status: "ready",
    settings: { region: "eu" },
    credentialKeys: ["auth_token"],
  };
  const snapshot = {
    installedProviders: [
      {
        providerId: "erc.provider.fixture",
        providerName: "Fixture",
        version: "1.0.0",
        credentialKeys: ["auth_token"],
      },
    ],
    profiles: [profile],
  };
  const bridge = createErcChartBridge(async (...args) => {
    calls.push(args);
    if (args[0] === "erc-chart:provider-profiles-list") return snapshot;
    if (args[0] === "erc-chart:provider-profile-update") return profile;
    if (
      args[0] === "erc-chart:provider-profile-create" ||
      args[0] === "erc-chart:provider-profile-start" ||
      args[0] === "erc-chart:provider-session-load"
    )
      return session;
    return true;
  });

  assert.deepEqual(await bridge.listProviderProfiles(), snapshot);
  assert.deepEqual(
    await bridge.createProviderProfile({
      providerId: "erc.provider.fixture",
      displayName: "Primary",
      settings: { region: "eu" },
      credentials: { auth_token: "secret" },
    }),
    session,
  );
  assert.deepEqual(
    await bridge.updateProviderProfile({
      profileId: "profile-a",
      displayName: "Primary",
      settings: { region: "us" },
    }),
    profile,
  );
  assert.deepEqual(await bridge.startProviderProfile("profile-a"), session);
  assert.deepEqual(
    await bridge.loadProviderSession({
      profileId: "profile-a",
      instrumentId: "BTCUSD",
      timeframeId: "3m",
    }),
    session,
  );
  await bridge.stopProviderProfile("profile-a");
  await bridge.deleteProviderProfile("profile-a");
  assert.deepEqual(
    calls.map(([channel]) => channel),
    [
      "erc-chart:provider-profiles-list",
      "erc-chart:provider-profile-create",
      "erc-chart:provider-profile-update",
      "erc-chart:provider-profile-start",
      "erc-chart:provider-session-load",
      "erc-chart:provider-profile-stop",
      "erc-chart:provider-profile-delete",
    ],
  );
});

test("starts, filters, and stops provider live subscriptions", async () => {
  const calls = [];
  const listeners = new Map();
  const events = [];
  const bridge = createErcChartBridge(
    async (...args) => {
      calls.push(args);
      return true;
    },
    (channel, listener) => {
      listeners.set(channel, listener);
      return () => listeners.delete(channel);
    },
  );

  const unsubscribe = await bridge.subscribeProviderData(
    {
      profileId: "profile-a",
      instrumentId: "BTCUSD",
      timeframeId: "1m",
    },
    (event) => events.push(event),
  );
  assert.equal(calls[0][0], "erc-chart:provider-live-subscribe");
  const subscriptionId = calls[0][1].subscriptionId;
  assert.match(subscriptionId, /^provider-live-/u);
  const listener = listeners.get("erc-chart:provider-live-event");
  assert.equal(typeof listener, "function");
  listener({
    subscriptionId: "another-subscription",
    type: "error",
    code: "IGNORED",
  });
  listener({
    subscriptionId,
    type: "candles",
    candles: [
      {
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        openTimeMs: 1_800_000_000_000,
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
      },
    ],
  });
  assert.equal(events.length, 1);

  await unsubscribe();
  await unsubscribe();
  assert.equal(listeners.size, 0);
  assert.deepEqual(calls.at(-1), [
    "erc-chart:provider-live-unsubscribe",
    subscriptionId,
  ]);
  assert.equal(
    calls.filter(
      ([channel]) => channel === "erc-chart:provider-live-unsubscribe",
    ).length,
    1,
  );
});

test("validates provider import IPC results without exposing local paths", async () => {
  const calls = [];
  const preview = {
    requestId: "request-1",
    pluginId: "erc.provider.binomo",
    pluginName: "Binomo",
    pluginVersion: "0.1.0",
    mode: "developer",
    trust: "unsigned",
    permissions: {
      network: ["https://api.binomo.com/*"],
      credentials: [],
      storage: [],
    },
  };
  const session = {
    profileId: "erc.provider.binomo.default",
    providerId: "erc.provider.binomo",
    providerName: "Binomo",
    instrument: {
      id: "Z-CRY/IDX",
      symbol: "Z-CRY/IDX",
      name: "Z-CRY/IDX",
    },
    timeframeId: "1m",
    candles: [],
  };
  const bridge = createErcChartBridge(async (...args) => {
    calls.push(args);
    if (args[0] === "erc-chart:provider-import-preview") return preview;
    if (args[0] === "erc-chart:provider-import-approve") return session;
    if (args[0] === "erc-chart:provider-import-cancel") return true;
    throw new Error("unexpected");
  });

  assert.deepEqual(await bridge.previewProviderImport(), preview);
  assert.deepEqual(
    await bridge.approveProviderImport("request-1", {
      binomo_cookie: "fixture-cookie",
    }),
    session,
  );
  await bridge.cancelProviderImport("request-1");
  assert.deepEqual(calls, [
    ["erc-chart:provider-import-preview"],
    [
      "erc-chart:provider-import-approve",
      "request-1",
      { binomo_cookie: "fixture-cookie" },
    ],
    ["erc-chart:provider-import-cancel", "request-1"],
  ]);
});
