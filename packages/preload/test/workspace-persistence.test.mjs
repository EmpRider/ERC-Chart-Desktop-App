import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { createErcChartBridge } from "../dist/index.js";

const workspace = {
  schemaVersion: 1,
  id: "last-workspace",
  name: "Last workspace",
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

test("loads and saves only validated workspace payloads on fixed channels", async () => {
  const calls = [];
  const bridge = createErcChartBridge(async (...args) => {
    calls.push(args);
    if (args[0] === "erc-chart:workspace-load") return workspace;
    if (args[0] === "erc-chart:workspace-save") return true;
    return { ipcContractVersion, applicationName: "ERC Chart" };
  });

  assert.deepEqual(await bridge.loadWorkspace(), workspace);
  await bridge.saveWorkspace(workspace);
  assert.deepEqual(calls, [
    ["erc-chart:workspace-load"],
    ["erc-chart:workspace-save", workspace],
  ]);
});

test("serializes saves and flushes the latest request", async () => {
  const releases = [];
  const calls = [];
  const bridge = createErcChartBridge(async (channel, payload) => {
    if (channel !== "erc-chart:workspace-save") return null;
    calls.push(payload.savedAtMs);
    await new Promise((resolve) => releases.push(resolve));
    return true;
  });

  const first = bridge.saveWorkspace(workspace);
  const second = bridge.saveWorkspace({ ...workspace, savedAtMs: 2 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [1]);
  releases.shift()();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [1, 2]);
  releases.shift()();
  await bridge.flushWorkspace();
  await second;
});

test("fails closed for malformed workspace load and save responses", async () => {
  const malformedLoad = createErcChartBridge(async () => ({
    private: "value",
  }));
  await assert.rejects(
    malformedLoad.loadWorkspace(),
    new Error("Workspace unavailable."),
  );

  const malformedSave = createErcChartBridge(async () => false);
  await assert.rejects(
    malformedSave.saveWorkspace(workspace),
    new Error("Workspace could not be saved."),
  );
});

test("rejects malformed renderer workspace state before invoking IPC", async () => {
  let invoked = false;
  const bridge = createErcChartBridge(async () => {
    invoked = true;
    return true;
  });

  await assert.rejects(
    bridge.saveWorkspace({ ...workspace, activeTabId: "missing" }),
    new Error("Workspace could not be saved."),
  );
  assert.equal(invoked, false);
});
