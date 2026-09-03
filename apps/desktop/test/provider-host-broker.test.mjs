import assert from "node:assert/strict";
import test from "node:test";
import {
  createDesktopProviderHostBroker,
  maximumProviderNetworkResponseBytes,
  resolveProviderNetworkTimeoutMs,
} from "../dist/provider-host-broker.js";

function launch() {
  return {
    installationPath: "C:/erc/plugins/com.example.provider/1.0.0",
    entry: "dist/index.js",
    pluginId: "com.example.provider",
    version: "1.0.0",
    permissions: {
      network: ["https://api.example.com/v1", "wss://stream.example.com/"],
      credentials: ["auth_token", "optional_token"],
      storage: [],
    },
    settings: {},
  };
}

test("brokers provider network responses and reads named credentials from one profile bundle", async () => {
  const reads = [];
  const fetches = [];
  const broker = createDesktopProviderHostBroker({
    launches: new Map([["profile-a", launch()]]),
    credentialManager: {
      async write() {
        return undefined;
      },
      async read(target) {
        reads.push(target);
        return JSON.stringify({ auth_token: "secret", device_id: "device" });
      },
      async delete() {
        return true;
      },
    },
    async fetch(url, init) {
      fetches.push({ url, init });
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 201,
        headers: { "x-provider": "fixture" },
      });
    },
    log() {
      return undefined;
    },
    reportStatus() {
      return undefined;
    },
    now: () => 1234,
  });

  assert.equal(await broker.getCredential("profile-a", "auth_token"), "secret");
  assert.equal(await broker.getCredential("profile-a", "optional_token"), null);
  assert.deepEqual(reads, [
    "ERC-chart/provider/com.example.provider/profile-a",
    "ERC-chart/provider/com.example.provider/profile-a",
  ]);

  const response = await broker.requestNetwork("profile-a", {
    url: "https://api.example.com/v1/status",
    method: "POST",
    headers: { accept: "application/json" },
    body: "{}",
  });
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].url, "https://api.example.com/v1/status");
  assert.equal(fetches[0].init.method, "POST");
  assert.equal(fetches[0].init.cache, "no-store");
  assert.equal(fetches[0].init.redirect, "error");
  assert.deepEqual(response, {
    status: 201,
    headers: { "x-provider": "fixture" },
    body: new Uint8Array([1, 2, 3]),
  });
});

test("enforces provider permissions again at the desktop broker boundary", async () => {
  let reads = 0;
  let fetches = 0;
  const broker = createDesktopProviderHostBroker({
    launches: new Map([["profile-a", launch()]]),
    credentialManager: {
      async write() {
        return undefined;
      },
      async read() {
        reads += 1;
        return JSON.stringify({ auth_token: "secret" });
      },
      async delete() {
        return true;
      },
    },
    async fetch() {
      fetches += 1;
      return new Response(null, { status: 204 });
    },
    log() {
      return undefined;
    },
    reportStatus() {
      return undefined;
    },
    now: () => 1234,
  });

  assert.throws(
    () =>
      broker.requestNetwork("profile-a", {
        url: "https://api.example.com/v1private",
      }),
    new Error("Provider network request is not permitted."),
  );
  await assert.rejects(
    broker.getCredential("profile-a", "device_id"),
    new Error("Provider credential access is not permitted."),
  );
  assert.equal(fetches, 0);
  assert.equal(reads, 0);
});

test("defaults and clamps provider network timeouts", () => {
  assert.equal(resolveProviderNetworkTimeoutMs(undefined), 30_000);
  assert.equal(resolveProviderNetworkTimeoutMs(Number.NaN), 30_000);
  assert.equal(resolveProviderNetworkTimeoutMs(0), 1);
  assert.equal(resolveProviderNetworkTimeoutMs(180_000), 120_000);
  assert.equal(resolveProviderNetworkTimeoutMs(2_500.9), 2_500);
});

test("aborts brokered requests when their timeout expires", async () => {
  let observedSignal;
  const broker = createDesktopProviderHostBroker({
    launches: new Map([["profile-a", launch()]]),
    credentialManager: {
      async write() {
        return undefined;
      },
      async read() {
        return undefined;
      },
      async delete() {
        return true;
      },
    },
    fetch(_url, init) {
      observedSignal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    },
    log() {
      return undefined;
    },
    reportStatus() {
      return undefined;
    },
    now: () => 1234,
  });

  await assert.rejects(
    broker.requestNetwork("profile-a", {
      url: "https://api.example.com/v1/status",
      timeoutMs: 1,
    }),
    { name: "AbortError" },
  );
  assert.ok(observedSignal instanceof AbortSignal);
  assert.equal(observedSignal.aborted, true);
});

test("bounds brokered response bodies before returning them", async () => {
  const allowedBody = new Uint8Array(maximumProviderNetworkResponseBytes);
  let response = new Response(allowedBody, {
    status: 200,
    headers: { "content-length": String(allowedBody.byteLength) },
  });
  const broker = createDesktopProviderHostBroker({
    launches: new Map([["profile-a", launch()]]),
    credentialManager: {
      async write() {
        return undefined;
      },
      async read() {
        return undefined;
      },
      async delete() {
        return true;
      },
    },
    async fetch() {
      return response;
    },
    log() {
      return undefined;
    },
    reportStatus() {
      return undefined;
    },
    now: () => 1234,
  });

  const allowed = await broker.requestNetwork("profile-a", {
    url: "https://api.example.com/v1/history",
  });
  assert.equal(allowed.body.byteLength, maximumProviderNetworkResponseBytes);

  response = new Response(null, {
    status: 200,
    headers: {
      "content-length": String(maximumProviderNetworkResponseBytes + 1),
    },
  });
  await assert.rejects(
    broker.requestNetwork("profile-a", {
      url: "https://api.example.com/v1/history",
    }),
    new Error("Provider network response exceeds the allowed size."),
  );
});

test("rejects websocket URLs from the one-shot HTTP request broker", () => {
  let fetches = 0;
  const broker = createDesktopProviderHostBroker({
    launches: new Map([["profile-a", launch()]]),
    credentialManager: {
      async write() {
        return undefined;
      },
      async read() {
        return undefined;
      },
      async delete() {
        return true;
      },
    },
    async fetch() {
      fetches += 1;
      return new Response(null, { status: 204 });
    },
    log() {
      return undefined;
    },
    reportStatus() {
      return undefined;
    },
    now: () => 1234,
  });

  assert.throws(
    () =>
      broker.requestNetwork("profile-a", {
        url: "wss://stream.example.com/socket",
      }),
    new Error("Provider network request protocol is not supported."),
  );
  assert.equal(fetches, 0);
});

test("enforces websocket permissions and host-managed handshake headers", async () => {
  const broker = createDesktopProviderHostBroker({
    launches: new Map([["profile-a", launch()]]),
    credentialManager: {
      async write() {
        return undefined;
      },
      async read() {
        return undefined;
      },
      async delete() {
        return true;
      },
    },
    async fetch() {
      throw new Error("unused");
    },
    log() {
      return undefined;
    },
    reportStatus() {
      return undefined;
    },
    now: () => 1234,
  });
  const handlers = {
    onMessage() {
      return undefined;
    },
    onClose() {
      return undefined;
    },
    onError() {
      return undefined;
    },
  };

  await assert.rejects(
    broker.openWebSocket(
      "profile-a",
      { url: "wss://evil.example.com/live" },
      handlers,
    ),
    new Error("Provider websocket request is not permitted."),
  );
  await assert.rejects(
    broker.openWebSocket(
      "profile-a",
      {
        url: "wss://stream.example.com/live",
        headers: { Host: "attacker.example" },
      },
      handlers,
    ),
    new Error("Provider websocket header is managed by the host."),
  );
});

test("fails closed for missing profiles and malformed credential bundles", async () => {
  const launches = new Map([["profile-a", launch()]]);
  let stored = "not-json";
  const broker = createDesktopProviderHostBroker({
    launches,
    credentialManager: {
      async write() {
        return undefined;
      },
      async read() {
        return stored;
      },
      async delete() {
        return true;
      },
    },
    async fetch() {
      throw new Error("unused");
    },
    log() {
      return undefined;
    },
    reportStatus() {
      return undefined;
    },
    now: () => 1234,
  });

  await assert.rejects(
    broker.getCredential("profile-missing", "auth_token"),
    new Error("Provider profile is not active."),
  );
  await assert.rejects(
    broker.getCredential("profile-a", "auth_token"),
    new Error("Provider credential bundle is invalid."),
  );
  stored = JSON.stringify({ auth_token: 42 });
  await assert.rejects(
    broker.getCredential("profile-a", "auth_token"),
    new Error("Provider credential bundle is invalid."),
  );
});
