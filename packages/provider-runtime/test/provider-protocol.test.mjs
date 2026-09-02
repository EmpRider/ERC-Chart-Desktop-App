import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { isProviderUtilityChildMessage } from "../dist/index.js";

test("rejects undeclared nested network request IPC fields", () => {
  assert.equal(
    isProviderUtilityChildMessage({
      type: "provider-host-network-request",
      contractVersion: ipcContractVersion,
      requestId: "profile-a.1",
      request: {
        url: "https://api.example.com/v1/status",
        undeclared: "must-not-cross-ipc",
      },
    }),
    false,
  );
});
