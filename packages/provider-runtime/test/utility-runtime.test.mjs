import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { createProviderUtilityRuntime } from "../dist/index.js";

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
    getListenerCount: () => listeners.size,
  };
}

test("requires a provider profile before the provider utility becomes ready", () => {
  const fixture = createPort();

  assert.throws(
    () => createProviderUtilityRuntime(fixture.port, ""),
    new RangeError("Provider profile ID is required."),
  );
  assert.deepEqual(fixture.sent, []);
});

test("reports ready without connecting and stops idempotently", () => {
  const fixture = createPort();
  const runtime = createProviderUtilityRuntime(
    fixture.port,
    "fixture-provider-profile",
  );

  assert.equal(runtime.providerProfileId, "fixture-provider-profile");
  assert.deepEqual(fixture.sent, [
    { type: "ready", contractVersion: ipcContractVersion },
  ]);

  fixture.receive({
    type: "shutdown",
    contractVersion: ipcContractVersion,
  });
  runtime.shutdown();

  assert.deepEqual(fixture.sent, [
    { type: "ready", contractVersion: ipcContractVersion },
    { type: "stopped", contractVersion: ipcContractVersion },
  ]);
  assert.equal(fixture.getListenerCount(), 0);
});
