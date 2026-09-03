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
      ],
    ],
  ]);
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
