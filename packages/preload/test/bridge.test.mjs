import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { createErcChartBridge, installBridge } from "../dist/index.js";

test("exposes only getRuntimeInfo on the fixed IPC channel", async () => {
  const calls = [];
  const bridge = createErcChartBridge(async (...args) => {
    calls.push(args);
    return {
      ipcContractVersion,
      applicationName: "ERC Chart",
    };
  });

  assert.deepEqual(Object.keys(bridge), ["getRuntimeInfo"]);
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

test("installs one application-specific global", () => {
  const exposures = [];
  installBridge(
    (key, value) => exposures.push([key, Object.keys(value)]),
    async () => ({
      ipcContractVersion,
      applicationName: "ERC Chart",
    }),
  );

  assert.deepEqual(exposures, [["ercChart", ["getRuntimeInfo"]]]);
});
