import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopProviderHostBroker } from "../dist/provider-host-broker.js";

function launch() {
  return {
    installationPath: "C:/erc/plugins/com.example.provider/1.0.0",
    entry: "dist/index.js",
    pluginId: "com.example.provider",
    version: "1.0.0",
    permissions: {
      network: ["https://api.example.com/v1"],
      credentials: ["auth_token"],
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
  assert.equal(await broker.getCredential("profile-a", "missing"), null);
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
  assert.deepEqual(response, {
    status: 201,
    headers: { "x-provider": "fixture" },
    body: new Uint8Array([1, 2, 3]),
  });
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
