import assert from "node:assert/strict";
import test from "node:test";
import {
  createProviderContractFixture,
  instantiateProviderContractFixture,
  runProviderContractConformance,
} from "../dist/index.js";

test("accepts a provider using the complete v1 authoring contract", async () => {
  const fixture = createProviderContractFixture();
  const adapter = await instantiateProviderContractFixture(fixture);
  const report = await runProviderContractConformance({ ...fixture, adapter });
  assert.equal(report.ok, true, JSON.stringify(report.violations));
  assert.deepEqual(fixture.calls, [
    "create",
    "connect",
    "getCapabilities",
    "getInstruments",
    "requestHistory",
    "subscribe",
    "unsubscribe",
    "disconnect",
  ]);
});

test("rejects malformed instrument discovery", async () => {
  const fixture = createProviderContractFixture();
  const report = await runProviderContractConformance({
    ...fixture,
    adapter: { ...fixture.adapter, getInstruments: async () => [{ id: "" }] },
  });
  assert.equal(report.ok, false);
  assert.ok(
    report.violations.some((item) =>
      item.path.startsWith("adapter.getInstruments"),
    ),
  );
});

test("rejects history that does not match the requested series", async () => {
  const fixture = createProviderContractFixture({
    candles: [
      { ...createProviderContractFixture().candles[0], timeframeId: "wrong" },
    ],
  });
  const report = await runProviderContractConformance(fixture);
  assert.equal(report.ok, false);
  assert.ok(
    report.violations.some((item) =>
      item.path.startsWith("adapter.requestHistory"),
    ),
  );
});
