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
    path: "adapter.requestHistory",
    message: "Provider adapter operation failed during conformance.",
  });
  assert.equal(fixture.calls.at(-1), "disconnect");
});

test("reports the exact failing operation and continues later checks", async () => {
  const fixture = createProviderContractFixture();
  let subscribeCalls = 0;
  const subject = {
    ...fixture,
    adapter: {
      ...fixture.adapter,
      getCapabilities: async () => {
        throw new Error("capabilities failure");
      },
      subscribe: async (...args) => {
        subscribeCalls += 1;
        return fixture.adapter.subscribe(...args);
      },
    },
  };

  const result = await runProviderContractConformance(subject);

  assert.equal(result.ok, false);
  assert.deepEqual(result.violations[0], {
    code: "PROVIDER_OPERATION_FAILED",
    path: "adapter.getCapabilities",
    message: "Provider adapter operation failed during conformance.",
  });
  assert.equal(subscribeCalls, 1);
  assert.equal(fixture.calls.at(-1), "disconnect");
});

test("rejects undefined operation results as malformed values", async () => {
  const cases = [
    {
      operation: "getCapabilities",
      expectedPath: "capabilities",
    },
    {
      operation: "requestHistory",
      expectedPath: "history",
    },
    {
      operation: "subscribe",
      expectedPath: "subscription",
    },
  ];

  for (const { operation, expectedPath } of cases) {
    const fixture = createProviderContractFixture();
    const result = await runProviderContractConformance({
      ...fixture,
      adapter: {
        ...fixture.adapter,
        [operation]: async () => undefined,
      },
    });

    assert.equal(result.ok, false, operation);
    assert.ok(
      result.violations.some(
        ({ code, path }) =>
          code === "MALFORMED_PROVIDER_VALUE" && path === expectedPath,
      ),
      operation,
    );
    assert.equal(fixture.calls.at(-1), "disconnect", operation);
  }
});

test("rejects malformed stream batches without throwing and still unsubscribes", async () => {
  const fixture = createProviderContractFixture();
  const subject = {
    ...fixture,
    adapter: {
      ...fixture.adapter,
      subscribe: async (_request, sink) => {
        fixture.calls.push("subscribe");
        sink.onCandles(null);
        sink.onTicks({});
        return {
          unsubscribe: async () => {
            fixture.calls.push("unsubscribe");
          },
        };
      },
    },
  };

  const result = await runProviderContractConformance(subject);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.violations.slice(0, 2).map(({ code, path }) => ({ code, path })),
    [
      {
        code: "MALFORMED_PROVIDER_VALUE",
        path: "subscription.candles",
      },
      { code: "MALFORMED_PROVIDER_VALUE", path: "subscription.ticks" },
    ],
  );
  assert.deepEqual(fixture.calls.slice(-3), [
    "subscribe",
    "unsubscribe",
    "disconnect",
  ]);
});

test("reports unsubscribe and disconnect failures independently", async () => {
  const fixture = createProviderContractFixture();
  const subject = {
    ...fixture,
    adapter: {
      ...fixture.adapter,
      disconnect: async () => {
        fixture.calls.push("disconnect");
        throw new Error("disconnect failure");
      },
      subscribe: async (_request, sink) => {
        fixture.calls.push("subscribe");
        sink.onTicks(fixture.ticks);
        return {
          unsubscribe: async () => {
            fixture.calls.push("unsubscribe");
            throw new Error("unsubscribe failure");
          },
        };
      },
    },
  };

  const result = await runProviderContractConformance(subject);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.violations.map(({ code, path }) => ({ code, path })),
    [
      { code: "PROVIDER_OPERATION_FAILED", path: "adapter.unsubscribe" },
      { code: "PROVIDER_OPERATION_FAILED", path: "adapter.disconnect" },
    ],
  );
});

test("validates fixture options as untrusted runtime values", async () => {
  const fixture = createProviderContractFixture({
    capabilities: null,
    candles: null,
    metadata: null,
    ticks: null,
  });

  const result = await runProviderContractConformance(fixture);

  assert.equal(result.ok, false);
  assert.equal(result.violations[0]?.path, "metadata");
  assert.deepEqual(fixture.calls, []);
});

test("rejects malformed envelope version and generation fields precisely", () => {
  const expectedGeneration = 7;
  const current = createProviderEnvelopeCases(expectedGeneration)[0].value;
  const cases = [
    {
      value: { ...current, contractVersion: 1.5 },
      code: "MALFORMED_PROVIDER_VALUE",
      path: "envelope.contractVersion",
    },
    {
      value: { ...current, generation: 7.5 },
      code: "MALFORMED_PROVIDER_VALUE",
      path: "envelope.generation",
    },
  ];

  for (const fixtureCase of cases) {
    const result = inspectProviderHistoryEnvelope(
      fixtureCase.value,
      expectedGeneration,
    );
    assert.deepEqual(
      {
        code: result.violations[0]?.code,
        path: result.violations[0]?.path,
      },
      { code: fixtureCase.code, path: fixtureCase.path },
    );
  }
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
