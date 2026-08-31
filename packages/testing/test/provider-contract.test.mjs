import assert from "node:assert/strict";
import test from "node:test";
import {
  contractVersion,
  hostApiVersion,
  providerContractVersion,
} from "@erc-chart/contracts";
import {
  createProviderContractFixture,
  createProviderEnvelopeCases,
  inspectProviderHistoryEnvelope,
  runProviderContractConformance,
} from "../dist/index.js";

test("runs a complete provider adapter conformance lifecycle", async () => {
  const fixture = createProviderContractFixture();

  const result = await runProviderContractConformance(fixture);

  assert.deepEqual(result, { ok: true, violations: [] });
  assert.deepEqual(fixture.calls, [
    "connect",
    "getCapabilities",
    "requestHistory",
    "subscribe",
    "unsubscribe",
    "disconnect",
  ]);
});

test("rejects an unknown provider contract before executing plugin code", async () => {
  const fixture = createProviderContractFixture({
    metadata: {
      ...createProviderContractFixture().metadata,
      providerContractVersion: contractVersion(providerContractVersion + 1),
    },
  });

  const result = await runProviderContractConformance(fixture);

  assert.equal(result.ok, false);
  assert.equal(result.violations[0]?.code, "UNSUPPORTED_PROVIDER_CONTRACT");
  assert.deepEqual(fixture.calls, []);
});

test("rejects a host-incompatible provider before executing plugin code", async () => {
  const fixture = createProviderContractFixture({
    metadata: {
      ...createProviderContractFixture().metadata,
      hostCompatibility: {
        minimumHostApiVersion: contractVersion(hostApiVersion + 1),
        maximumHostApiVersion: contractVersion(hostApiVersion + 1),
      },
    },
  });

  const result = await runProviderContractConformance(fixture);

  assert.equal(result.ok, false);
  assert.equal(result.violations[0]?.code, "INCOMPATIBLE_HOST_API");
  assert.deepEqual(fixture.calls, []);
});

test("reports malformed provider history and still disconnects", async () => {
  const valid = createProviderContractFixture();
  const fixture = createProviderContractFixture({
    candles: [{ ...valid.candles[0], low: 103 }],
  });

  const result = await runProviderContractConformance(fixture);

  assert.equal(result.ok, false);
  assert.equal(result.violations[0]?.code, "MALFORMED_PROVIDER_VALUE");
  assert.equal(fixture.calls.at(-1), "disconnect");
});

test("contains adapter failures and performs lifecycle cleanup", async () => {
  const fixture = createProviderContractFixture();
  const subject = {
    ...fixture,
    adapter: {
      ...fixture.adapter,
      requestHistory: async () => {
        throw new Error("fixture history failure");
      },
    },
  };

  const result = await runProviderContractConformance(subject);

  assert.equal(result.ok, false);
  assert.deepEqual(result.violations[0], {
    code: "PROVIDER_OPERATION_FAILED",
    path: "adapter",
    message: "Provider adapter operation failed during conformance.",
  });
  assert.equal(fixture.calls.at(-1), "disconnect");
});

test("provides current, malformed, unknown-version, and stale cases", () => {
  const expectedGeneration = 12;
  const cases = createProviderEnvelopeCases(expectedGeneration);

  assert.deepEqual(
    cases.map((fixtureCase) => fixtureCase.name),
    ["current", "malformed", "unknown-version", "stale-generation"],
  );

  for (const fixtureCase of cases) {
    const result = inspectProviderHistoryEnvelope(
      fixtureCase.value,
      expectedGeneration,
    );
    assert.equal(result.ok, fixtureCase.expectedAccepted, fixtureCase.name);
    if (fixtureCase.expectedViolation !== undefined) {
      assert.equal(
        result.violations[0]?.code,
        fixtureCase.expectedViolation,
        fixtureCase.name,
      );
    }
  }
});
