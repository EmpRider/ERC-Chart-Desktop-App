import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { createUtilityRuntime } from "../dist/index.js";

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
      for (const listener of listeners) listener(message);
    },
  };
}

test("reports ready and stops exactly once on a valid shutdown", () => {
  const fixture = createPort();
  const runtime = createUtilityRuntime(fixture.port);

  assert.deepEqual(fixture.sent, [
    { type: "ready", contractVersion: ipcContractVersion },
  ]);

  fixture.receive({ type: "unknown", contractVersion: ipcContractVersion });
  assert.equal(fixture.sent.length, 1);

  fixture.receive({
    type: "shutdown",
    contractVersion: ipcContractVersion,
  });
  runtime.shutdown();

  assert.deepEqual(fixture.sent, [
    { type: "ready", contractVersion: ipcContractVersion },
    { type: "stopped", contractVersion: ipcContractVersion },
  ]);
});
