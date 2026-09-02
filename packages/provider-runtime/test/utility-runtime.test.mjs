import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { createProviderUtilityRuntime } from "../dist/index.js";

function createPort() {
  const listeners = new Set();
  const postedListeners = new Set();
  const sent = [];
  return {
    sent,
    port: {
      postMessage(message) {
        sent.push(message);
        for (const listener of postedListeners) listener(message);
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
    waitForMessage(type) {
      const existing = sent.find((message) => message.type === type);
      if (existing !== undefined) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          postedListeners.delete(onMessage);
          reject(new Error(`Timed out waiting for ${type}.`));
        }, 2_000);
        const onMessage = (message) => {
          if (message.type !== type) return;
          clearTimeout(timer);
          postedListeners.delete(onMessage);
          resolve(message);
        };
        postedListeners.add(onMessage);
      });
    },
  };
}

async function flushTasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function withProviderEntry(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-utility-"));
  const installationPath = path.join(root, "com.example.utility", "1.0.0");
  await mkdir(path.join(installationPath, "dist"), { recursive: true });
  await writeFile(
    path.join(installationPath, "dist", "index.js"),
    `export default {
      metadata: {
        id: "com.example.utility",
        name: "Utility Fixture",
        providerContractVersion: 1,
        hostCompatibility: { minimumHostApiVersion: 1, maximumHostApiVersion: 1 }
      },
      version: "1.0.0",
      config: {
        endpoint: {
          type: "string",
          defaultValue: "https://api.example.com/",
          requiresReconnect: true
        },
        retries: { type: "number", defaultValue: 2, minimum: 0, maximum: 5 },
        token: { type: "secret", credentialKey: "auth_token", required: true }
      },
      async create(host, settings) {
        const token = await host.credentials.get("auth_token");
        await host.network.request({
          url: settings.endpoint + "status",
          headers: token === null ? {} : { authorization: "Bearer " + token }
        });
        host.logger.info("UTILITY_CREATED", { token });
        host.reportStatus("connected");
        return {
          connect: async () => undefined,
          disconnect: async () => undefined,
          getCapabilities: async () => ({
            instruments: true,
            nativeTimeframes: ["1m"],
            liveData: true,
            derivedTimeframes: true
          }),
          getInstruments: async () => [
            { id: "BTCUSD", symbol: "BTCUSD", name: "Bitcoin / USD" }
          ],
          requestHistory: async (request) => [{
            instrumentId: request.instrumentId,
            timeframeId: request.timeframeId,
            openTimeMs: 1000,
            open: 10,
            high: 12,
            low: 9,
            close: 11
          }],
          subscribe: async (request, sink) => {
            sink.onTicks([{ instrumentId: request.instrumentId, timestampMs: 2000, price: 12 }]);
            sink.onCandles([{
              instrumentId: request.instrumentId,
              timeframeId: request.timeframeId,
              openTimeMs: 1000,
              open: 10,
              high: 13,
              low: 9,
              close: 12
            }]);
            return {
              unsubscribe: async () => host.logger.info("SUBSCRIPTION_UNSUBSCRIBED")
            };
          }
        };
      }
    };\n`,
  );
  try {
    await callback(installationPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function initialize(installationPath) {
  return {
    type: "provider-initialize",
    contractVersion: ipcContractVersion,
    launch: {
      installationPath,
      entry: "dist/index.js",
      pluginId: "com.example.utility",
      version: "1.0.0",
      permissions: {
        network: ["https://api.example.com/"],
        credentials: ["auth_token"],
        storage: [],
      },
      settings: {},
    },
  };
}

async function initializeReady(fixture, runtime, installationPath) {
  fixture.receive(initialize(installationPath));
  const credentialRequest = await fixture.waitForMessage(
    "provider-host-credential-request",
  );
  fixture.receive({
    type: "provider-host-credential-response",
    contractVersion: ipcContractVersion,
    requestId: credentialRequest.requestId,
    ok: true,
    credential: "fixture-secret",
  });
  const networkRequest = await fixture.waitForMessage(
    "provider-host-network-request",
  );
  fixture.receive({
    type: "provider-host-network-response",
    contractVersion: ipcContractVersion,
    requestId: networkRequest.requestId,
    ok: true,
    response: { status: 200, headers: {}, body: new Uint8Array() },
  });
  await runtime.ready;
  await flushTasks();
}

test("requires a provider profile before accepting initialization", () => {
  const fixture = createPort();

  assert.throws(
    () => createProviderUtilityRuntime(fixture.port, ""),
    new RangeError("Provider profile ID is required."),
  );
  assert.deepEqual(fixture.sent, []);
});

test("becomes ready only after installed-provider creation and broker round trips", async () => {
  await withProviderEntry(async (installationPath) => {
    const fixture = createPort();
    const runtime = createProviderUtilityRuntime(fixture.port, "profile-a");

    assert.equal(runtime.providerProfileId, "profile-a");
    assert.deepEqual(fixture.sent, []);
    fixture.receive(initialize(installationPath));

    const credentialRequest = await fixture.waitForMessage(
      "provider-host-credential-request",
    );
    assert.equal(credentialRequest.type, "provider-host-credential-request");
    assert.equal(credentialRequest.credentialKey, "auth_token");
    fixture.receive({
      type: "provider-host-credential-response",
      contractVersion: ipcContractVersion,
      requestId: credentialRequest.requestId,
      ok: true,
      credential: "fixture-secret",
    });
    const networkRequest = await fixture.waitForMessage(
      "provider-host-network-request",
    );
    assert.equal(networkRequest.type, "provider-host-network-request");
    assert.equal(networkRequest.request.url, "https://api.example.com/status");
    fixture.receive({
      type: "provider-host-network-response",
      contractVersion: ipcContractVersion,
      requestId: networkRequest.requestId,
      ok: true,
      response: { status: 200, headers: {}, body: new Uint8Array() },
    });

    const instance = await runtime.ready;
    await flushTasks();
    assert.equal(instance.definition.metadata.id, "com.example.utility");
    assert.deepEqual(
      fixture.sent.map((message) => message.type),
      [
        "provider-host-credential-request",
        "provider-host-network-request",
        "provider-host-log",
        "provider-host-status",
        "ready",
      ],
    );
    const log = fixture.sent.find(
      (message) => message.type === "provider-host-log",
    );
    assert.equal(log.metadata.token, "[REDACTED]");

    fixture.receive({
      type: "provider-config-validation-request",
      contractVersion: ipcContractVersion,
      requestId: "cfg.1",
      settings: { endpoint: "https://sandbox.example.com/", retries: 2 },
    });
    const validated = await fixture.waitForMessage(
      "provider-config-validation-response",
    );
    assert.deepEqual(validated, {
      type: "provider-config-validation-response",
      contractVersion: ipcContractVersion,
      requestId: "cfg.1",
      ok: true,
      impact: "reconnect",
      settings: { endpoint: "https://sandbox.example.com/", retries: 2 },
      changedKeys: ["endpoint"],
    });

    fixture.receive({
      type: "provider-config-validation-request",
      contractVersion: ipcContractVersion,
      requestId: "cfg.2",
      settings: { token: "must-not-persist" },
    });
    await flushTasks();
    assert.deepEqual(fixture.sent.at(-1), {
      type: "provider-config-validation-response",
      contractVersion: ipcContractVersion,
      requestId: "cfg.2",
      ok: false,
      code: "PROVIDER_CONFIG_INVALID",
    });

    fixture.receive({ type: "shutdown", contractVersion: ipcContractVersion });
    await flushTasks();
    assert.equal(fixture.sent.at(-1).type, "stopped");
    assert.equal(fixture.getListenerCount(), 0);
  });
});

test("fails closed on invalid initialization without exposing exception text", async () => {
  const fixture = createPort();
  const runtime = createProviderUtilityRuntime(fixture.port, "profile-a");
  fixture.receive({
    type: "provider-initialize",
    contractVersion: ipcContractVersion,
    launch: {
      installationPath: "C:/missing-provider",
      entry: "dist/index.js",
      pluginId: "com.example.utility",
      version: "1.0.0",
      permissions: { network: [], credentials: [], storage: [] },
      settings: {},
    },
  });

  await assert.rejects(runtime.ready);
  await flushTasks();
  assert.deepEqual(fixture.sent, [
    {
      type: "error",
      contractVersion: ipcContractVersion,
      code: "PROVIDER_ENTRY_INVALID",
    },
  ]);
});

test("reports protocol violation for malformed parent messages", async () => {
  const fixture = createPort();
  const runtime = createProviderUtilityRuntime(fixture.port, "profile-a");
  fixture.receive({
    type: "shutdown",
    contractVersion: ipcContractVersion + 1,
  });
  await assert.rejects(runtime.ready);
  assert.deepEqual(fixture.sent, [
    {
      type: "error",
      contractVersion: ipcContractVersion,
      code: "PROVIDER_UTILITY_PROTOCOL_VIOLATION",
    },
  ]);
});

test("fails closed on unknown host response ids", async () => {
  await withProviderEntry(async (installationPath) => {
    const fixture = createPort();
    const runtime = createProviderUtilityRuntime(fixture.port, "profile-a");
    fixture.receive(initialize(installationPath));
    await fixture.waitForMessage("provider-host-credential-request");

    fixture.receive({
      type: "provider-host-credential-response",
      contractVersion: ipcContractVersion,
      requestId: "profile-a.999",
      ok: true,
      credential: "fixture-secret",
    });

    await assert.rejects(
      runtime.ready,
      new Error("PROVIDER_UTILITY_PROTOCOL_VIOLATION"),
    );
    assert.equal(fixture.sent.at(-1).type, "error");
    assert.equal(
      fixture.sent.at(-1).code,
      "PROVIDER_UTILITY_PROTOCOL_VIOLATION",
    );
  });
});

test("fails closed when a host response type does not match its request", async () => {
  await withProviderEntry(async (installationPath) => {
    const fixture = createPort();
    const runtime = createProviderUtilityRuntime(fixture.port, "profile-a");
    fixture.receive(initialize(installationPath));
    const credentialRequest = await fixture.waitForMessage(
      "provider-host-credential-request",
    );

    fixture.receive({
      type: "provider-host-network-response",
      contractVersion: ipcContractVersion,
      requestId: credentialRequest.requestId,
      ok: true,
      response: { status: 200, headers: {}, body: new Uint8Array() },
    });

    await assert.rejects(
      runtime.ready,
      new Error("PROVIDER_UTILITY_PROTOCOL_VIOLATION"),
    );
    assert.equal(
      fixture.sent.at(-1).code,
      "PROVIDER_UTILITY_PROTOCOL_VIOLATION",
    );
  });
});

test("maps an explicit host failure to a stable provider load failure", async () => {
  await withProviderEntry(async (installationPath) => {
    const fixture = createPort();
    const runtime = createProviderUtilityRuntime(fixture.port, "profile-a");
    fixture.receive(initialize(installationPath));
    const credentialRequest = await fixture.waitForMessage(
      "provider-host-credential-request",
    );

    fixture.receive({
      type: "provider-host-credential-response",
      contractVersion: ipcContractVersion,
      requestId: credentialRequest.requestId,
      ok: false,
      code: "PROVIDER_HOST_CREDENTIAL_FAILED",
    });

    await assert.rejects(runtime.ready, new Error("PROVIDER_LOAD_FAILED"));
    await flushTasks();
    assert.deepEqual(fixture.sent.at(-1), {
      type: "error",
      contractVersion: ipcContractVersion,
      code: "PROVIDER_LOAD_FAILED",
    });
  });
});

test("rejects ready when shutdown arrives while provider initialization is in flight", async () => {
  await withProviderEntry(async (installationPath) => {
    const fixture = createPort();
    const runtime = createProviderUtilityRuntime(fixture.port, "profile-a");
    fixture.receive(initialize(installationPath));
    await fixture.waitForMessage("provider-host-credential-request");

    fixture.receive({ type: "shutdown", contractVersion: ipcContractVersion });

    await assert.rejects(
      runtime.ready,
      new Error("Provider utility stopped before initialization."),
    );
    assert.equal(fixture.sent.at(-1).type, "stopped");
    assert.equal(fixture.getListenerCount(), 0);
  });
});

test("shutdown is idempotent before initialization", async () => {
  const fixture = createPort();
  const runtime = createProviderUtilityRuntime(fixture.port, "profile-a");

  runtime.shutdown();
  runtime.shutdown();

  await assert.rejects(
    runtime.ready,
    new Error("Provider utility stopped before initialization."),
  );
  assert.deepEqual(fixture.sent, [
    { type: "stopped", contractVersion: ipcContractVersion },
  ]);
  assert.equal(fixture.getListenerCount(), 0);
});

test("executes provider discovery, history, live subscription, and disposal on the installed adapter", async () => {
  await withProviderEntry(async (installationPath) => {
    const fixture = createPort();
    const runtime = createProviderUtilityRuntime(fixture.port, "profile-a");
    await initializeReady(fixture, runtime, installationPath);

    fixture.receive({
      type: "provider-capabilities-request",
      contractVersion: ipcContractVersion,
      requestId: "data.1",
    });
    await flushTasks();
    assert.deepEqual(fixture.sent.at(-1), {
      type: "provider-capabilities-response",
      contractVersion: ipcContractVersion,
      requestId: "data.1",
      ok: true,
      capabilities: {
        instruments: true,
        nativeTimeframes: ["1m"],
        liveData: true,
        derivedTimeframes: true,
      },
    });

    fixture.receive({
      type: "provider-instruments-request",
      contractVersion: ipcContractVersion,
      requestId: "data.2",
    });
    await flushTasks();
    assert.equal(fixture.sent.at(-1).instruments[0].symbol, "BTCUSD");

    fixture.receive({
      type: "provider-history-request",
      contractVersion: ipcContractVersion,
      requestId: "data.3",
      request: { instrumentId: "BTCUSD", timeframeId: "1m", limit: 100 },
    });
    await flushTasks();
    assert.equal(fixture.sent.at(-1).candles[0].close, 11);

    fixture.receive({
      type: "provider-subscribe-request",
      contractVersion: ipcContractVersion,
      requestId: "data.4",
      subscriptionId: "sub.1",
      request: { instrumentId: "BTCUSD", timeframeId: "1m" },
    });
    await flushTasks();
    const liveTypes = fixture.sent.slice(-3).map((message) => message.type);
    assert.deepEqual(liveTypes, [
      "provider-subscription-ticks",
      "provider-subscription-candles",
      "provider-subscribe-response",
    ]);

    fixture.receive({
      type: "provider-unsubscribe-request",
      contractVersion: ipcContractVersion,
      requestId: "data.5",
      subscriptionId: "sub.1",
    });
    await flushTasks();
    assert.equal(
      fixture.sent.some(
        (message) =>
          message.type === "provider-host-log" &&
          message.code === "SUBSCRIPTION_UNSUBSCRIBED",
      ),
      true,
    );
    assert.deepEqual(fixture.sent.at(-1), {
      type: "provider-unsubscribe-response",
      contractVersion: ipcContractVersion,
      requestId: "data.5",
      ok: true,
    });

    fixture.receive({ type: "shutdown", contractVersion: ipcContractVersion });
    await flushTasks();
  });
});
