import assert from "node:assert/strict";
import test from "node:test";
import {
  ipcContractVersion,
  isUtilityControlMessage,
  isUtilityStatusMessage,
} from "../dist/index.js";

test("accepts only the fixed utility shutdown command", () => {
  assert.equal(
    isUtilityControlMessage({
      type: "shutdown",
      contractVersion: ipcContractVersion,
    }),
    true,
  );
  assert.equal(
    isUtilityControlMessage({
      type: "restart",
      contractVersion: ipcContractVersion,
    }),
    false,
  );
  assert.equal(
    isUtilityControlMessage({
      type: "shutdown",
      contractVersion: ipcContractVersion,
      payload: "unexpected",
    }),
    false,
  );
});

test("accepts safe utility status messages and rejects malformed errors", () => {
  for (const valid of [
    { type: "ready", contractVersion: ipcContractVersion },
    { type: "stopped", contractVersion: ipcContractVersion },
    {
      type: "error",
      contractVersion: ipcContractVersion,
      code: "STARTUP_FAILED",
    },
  ]) {
    assert.equal(isUtilityStatusMessage(valid), true);
  }

  for (const invalid of [
    null,
    { type: "ready", contractVersion: 2 },
    {
      type: "error",
      contractVersion: ipcContractVersion,
      code: "contains a path /tmp/private",
    },
    {
      type: "error",
      contractVersion: ipcContractVersion,
      code: "STARTUP_FAILED",
      stack: "not allowed",
    },
  ]) {
    assert.equal(isUtilityStatusMessage(invalid), false);
  }
});
