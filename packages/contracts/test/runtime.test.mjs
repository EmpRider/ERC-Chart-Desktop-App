import assert from "node:assert/strict";
import test from "node:test";
import {
  ipcContractVersion,
  isRuntimeInfo,
  runtimeInfoChannel,
} from "../dist/index.js";

test("accepts only the versioned ERC Chart runtime response", () => {
  assert.equal(runtimeInfoChannel, "erc-chart:runtime-info");
  assert.equal(
    isRuntimeInfo({
      ipcContractVersion,
      applicationName: "ERC Chart",
    }),
    true,
  );

  for (const invalid of [
    null,
    {},
    { ipcContractVersion, applicationName: "Other" },
    { ipcContractVersion: 2, applicationName: "ERC Chart" },
    {
      ipcContractVersion,
      applicationName: "ERC Chart",
      electronVersion: "secret",
    },
  ]) {
    assert.equal(isRuntimeInfo(invalid), false);
  }
});
