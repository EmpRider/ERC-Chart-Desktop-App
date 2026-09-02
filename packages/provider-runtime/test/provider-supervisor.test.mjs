import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { createProviderUtilitySupervisor } from "../dist/index.js";

function createScheduler() {
  const timers = [];
  return {
    scheduler: {
      setTimeout(callback) {
        const timer = { active: true, callback };
        timers.push(timer);
        return timer;
      },
      clearTimeout(timer) {
        timer.active = false;
      },
    },
    runNext() {
      const timer = timers.find((candidate) => candidate.active);
      assert.ok(timer, "expected an active timer");
      timer.active = false;
      timer.callback();
    },
  };
}

function createChild() {
  const messages = new Set();
  const exits = new Set();
  const posted = [];
  let killCount = 0;
  return {
    child: {
      postMessage(message) {
        posted.push(message);
      },
      kill() {
        killCount += 1;
      },
      onMessage(listener) {
        messages.add(listener);
        return () => messages.delete(listener);
      },
      onExit(listener) {
        exits.add(listener);
        return () => exits.delete(listener);
      },
    },
    emitMessage(message) {
      for (const listener of messages) listener(message);
    },
    emitExit(code = 1) {
      for (const listener of exits) listener(code);
    },
    posted,
    getKillCount: () => killCount,
  };
}

function createFixture(options = {}) {
  const scheduler = createScheduler();
  const children = [];
  const spawnCalls = [];
  const unavailable = [];
  const supervisor = createProviderUtilitySupervisor({
    spawn(entryPath, args) {
      const fixture = createChild();
      children.push(fixture);
      spawnCalls.push({ entryPath, args });
      return fixture.child;
    },
    scheduler: scheduler.scheduler,
    startupTimeoutMs: 5_000,
    shutdownTimeoutMs: 2_000,
    onUnavailable(providerProfileId, code) {
      unavailable.push({ providerProfileId, code });
    },
    ...(options.hostBroker === undefined
      ? {}
      : { hostBroker: options.hostBroker }),
  });
  return { ...scheduler, children, spawnCalls, unavailable, supervisor };
}

function createLaunch(overrides = {}) {
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
    ...overrides,
  };
}

test("returns the single startup rejection when spawning fails", async () => {
  const scheduler = createScheduler();
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const supervisor = createProviderUtilitySupervisor({
      spawn() {
        throw new Error("spawn failed");
      },
      scheduler: scheduler.scheduler,
      startupTimeoutMs: 5_000,
      shutdownTimeoutMs: 2_000,
      onUnavailable() {
        return undefined;
      },
    });

    await assert.rejects(
      supervisor.start("profile-a", "/runtime/provider.js"),
      new Error("Provider utility process could not start."),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("initializes a provider utility and brokers host requests without argv secrets", async () => {
  const calls = {
    network: [],
    credentials: [],
    logs: [],
    statuses: [],
  };
  const fixture = createFixture({
    hostBroker: {
      async requestNetwork(providerProfileId, request) {
        calls.network.push({ providerProfileId, request });
        return { status: 204, headers: {}, body: new Uint8Array() };
      },
      async getCredential(providerProfileId, credentialKey) {
        calls.credentials.push({ providerProfileId, credentialKey });
        return "credential-value";
      },
      log(providerProfileId, level, code, metadata) {
        calls.logs.push({ providerProfileId, level, code, metadata });
      },
      reportStatus(providerProfileId, status) {
        calls.statuses.push({ providerProfileId, status });
      },
    },
  });
  const launch = {
    installationPath: "C:/erc/plugins/com.example.provider/1.0.0",
    entry: "dist/index.js",
    pluginId: "com.example.provider",
    version: "1.0.0",
    permissions: {
      network: ["https://api.example.com/"],
      credentials: ["auth_token"],
      storage: [],
    },
    settings: { endpoint: "https://api.example.com/" },
  };

  const started = fixture.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    launch,
  );
  assert.deepEqual(fixture.spawnCalls, [
    {
      entryPath: "/runtime/provider.js",
      args: ["profile-a"],
    },
  ]);
  assert.deepEqual(fixture.children[0].posted, [
    {
      type: "provider-initialize",
      contractVersion: ipcContractVersion,
      launch,
    },
  ]);

  fixture.children[0].emitMessage({
    type: "provider-host-credential-request",
    contractVersion: ipcContractVersion,
    requestId: "profile-a.1",
    credentialKey: "auth_token",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.credentials, [
    { providerProfileId: "profile-a", credentialKey: "auth_token" },
  ]);
  assert.deepEqual(fixture.children[0].posted.at(-1), {
    type: "provider-host-credential-response",
    contractVersion: ipcContractVersion,
    requestId: "profile-a.1",
    ok: true,
    credential: "credential-value",
  });

  fixture.children[0].emitMessage({
    type: "provider-host-network-request",
    contractVersion: ipcContractVersion,
    requestId: "profile-a.2",
    request: { url: "https://api.example.com/status" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.network, [
    {
      providerProfileId: "profile-a",
      request: { url: "https://api.example.com/status" },
    },
  ]);
  assert.deepEqual(fixture.children[0].posted.at(-1), {
    type: "provider-host-network-response",
    contractVersion: ipcContractVersion,
    requestId: "profile-a.2",
    ok: true,
    response: { status: 204, headers: {}, body: new Uint8Array() },
  });

  fixture.children[0].emitMessage({
    type: "provider-host-log",
    contractVersion: ipcContractVersion,
    level: "info",
    code: "PROVIDER_READY",
    metadata: { phase: "startup" },
  });
  fixture.children[0].emitMessage({
    type: "provider-host-status",
    contractVersion: ipcContractVersion,
    status: "connected",
  });
  assert.deepEqual(calls.logs, [
    {
      providerProfileId: "profile-a",
      level: "info",
      code: "PROVIDER_READY",
      metadata: { phase: "startup" },
    },
  ]);
  assert.deepEqual(calls.statuses, [
    { providerProfileId: "profile-a", status: "connected" },
  ]);

  fixture.children[0].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await started;
  assert.equal(fixture.supervisor.getStatus("profile-a"), "ready");
});

test("supervises provider profiles independently and passes only the profile id", async () => {
  const fixture = createFixture();
  const first = fixture.supervisor.start("profile-a", "/runtime/provider.js");
  const second = fixture.supervisor.start("profile-b", "/runtime/provider.js");
  fixture.children[0].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  fixture.children[1].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await Promise.all([first, second]);

  assert.deepEqual(fixture.spawnCalls, [
    { entryPath: "/runtime/provider.js", args: ["profile-a"] },
    { entryPath: "/runtime/provider.js", args: ["profile-b"] },
  ]);
  assert.equal(fixture.supervisor.getStatus("profile-a"), "ready");
  assert.equal(fixture.supervisor.getStatus("profile-b"), "ready");

  fixture.children[0].emitExit(7);
  assert.equal(fixture.supervisor.getStatus("profile-a"), "failed");
  assert.equal(fixture.supervisor.getStatus("profile-b"), "ready");
  assert.deepEqual(fixture.unavailable, [
    {
      providerProfileId: "profile-a",
      code: "PROVIDER_UTILITY_EXITED",
    },
  ]);
});

test("fails closed on malformed or out-of-sequence provider messages", async () => {
  const fixture = createFixture();
  const started = fixture.supervisor.start("profile-a", "/runtime/provider.js");

  fixture.children[0].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion + 1,
  });

  await assert.rejects(
    started,
    new Error("Provider utility protocol violation."),
  );
  assert.equal(fixture.supervisor.getStatus("profile-a"), "failed");
  assert.equal(fixture.children[0].getKillCount(), 1);
  assert.deepEqual(fixture.unavailable, [
    {
      providerProfileId: "profile-a",
      code: "PROVIDER_UTILITY_PROTOCOL_VIOLATION",
    },
  ]);

  const restarted = fixture.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
  );
  fixture.children[1].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await restarted;
  fixture.children[1].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  assert.equal(fixture.supervisor.getStatus("profile-a"), "failed");
  assert.equal(fixture.children[1].getKillCount(), 1);
});

test("bounds startup and shutdown and supports restart after failure", async () => {
  const fixture = createFixture();
  const started = fixture.supervisor.start("profile-a", "/runtime/provider.js");
  fixture.runNext();
  await assert.rejects(
    started,
    new Error("Provider utility failed to become ready."),
  );
  assert.equal(fixture.children[0].getKillCount(), 1);

  const restarted = fixture.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
  );
  fixture.children[1].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await restarted;
  const stopped = fixture.supervisor.shutdown("profile-a");
  assert.deepEqual(fixture.children[1].posted, [
    { type: "shutdown", contractVersion: ipcContractVersion },
  ]);
  fixture.runNext();
  await stopped;
  assert.equal(fixture.children[1].getKillCount(), 1);
  assert.equal(fixture.supervisor.getStatus("profile-a"), "stopped");
});

test("shutdownAll stops each active provider without cross-profile corruption", async () => {
  const fixture = createFixture();
  const first = fixture.supervisor.start("profile-a", "/runtime/provider.js");
  const second = fixture.supervisor.start("profile-b", "/runtime/provider.js");
  for (const child of fixture.children) {
    child.emitMessage({ type: "ready", contractVersion: ipcContractVersion });
  }
  await Promise.all([first, second]);

  const stopped = fixture.supervisor.shutdownAll();
  for (const child of fixture.children) {
    assert.deepEqual(child.posted, [
      { type: "shutdown", contractVersion: ipcContractVersion },
    ]);
    child.emitMessage({
      type: "stopped",
      contractVersion: ipcContractVersion,
    });
  }
  await stopped;
  await fixture.supervisor.shutdownAll();

  assert.equal(fixture.supervisor.getStatus("profile-a"), "stopped");
  assert.equal(fixture.supervisor.getStatus("profile-b"), "stopped");
});

test("enforces launch permissions before forwarding host requests", async () => {
  const calls = { network: 0, credentials: 0 };
  const fixture = createFixture({
    hostBroker: {
      async requestNetwork() {
        calls.network += 1;
        return { status: 200, headers: {}, body: new Uint8Array() };
      },
      async getCredential() {
        calls.credentials += 1;
        return "secret";
      },
      log() {
        return undefined;
      },
      reportStatus() {
        return undefined;
      },
    },
  });
  const started = fixture.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    createLaunch(),
  );

  fixture.children[0].emitMessage({
    type: "provider-host-network-request",
    contractVersion: ipcContractVersion,
    requestId: "profile-a.1",
    request: { url: "https://api.example.com/v1private" },
  });
  fixture.children[0].emitMessage({
    type: "provider-host-credential-request",
    contractVersion: ipcContractVersion,
    requestId: "profile-a.2",
    credentialKey: "undeclared",
  });

  assert.equal(calls.network, 0);
  assert.equal(calls.credentials, 0);
  assert.deepEqual(fixture.children[0].posted.slice(-2), [
    {
      type: "provider-host-network-response",
      contractVersion: ipcContractVersion,
      requestId: "profile-a.1",
      ok: false,
      code: "PROVIDER_PERMISSION_DENIED",
    },
    {
      type: "provider-host-credential-response",
      contractVersion: ipcContractVersion,
      requestId: "profile-a.2",
      ok: false,
      code: "PROVIDER_PERMISSION_DENIED",
    },
  ]);

  fixture.children[0].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await started;
});

test("reports stable host failures when the broker is absent or rejects", async () => {
  const absent = createFixture();
  const absentStarted = absent.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    createLaunch(),
  );
  absent.children[0].emitMessage({
    type: "provider-host-network-request",
    contractVersion: ipcContractVersion,
    requestId: "profile-a.1",
    request: { url: "https://api.example.com/v1/status" },
  });
  absent.children[0].emitMessage({
    type: "provider-host-credential-request",
    contractVersion: ipcContractVersion,
    requestId: "profile-a.2",
    credentialKey: "auth_token",
  });
  assert.deepEqual(absent.children[0].posted.slice(-2), [
    {
      type: "provider-host-network-response",
      contractVersion: ipcContractVersion,
      requestId: "profile-a.1",
      ok: false,
      code: "PROVIDER_HOST_UNAVAILABLE",
    },
    {
      type: "provider-host-credential-response",
      contractVersion: ipcContractVersion,
      requestId: "profile-a.2",
      ok: false,
      code: "PROVIDER_HOST_UNAVAILABLE",
    },
  ]);
  absent.children[0].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await absentStarted;

  const rejected = createFixture({
    hostBroker: {
      async requestNetwork() {
        throw new Error("private network failure");
      },
      async getCredential() {
        throw new Error("private credential failure");
      },
      log() {
        return undefined;
      },
      reportStatus() {
        return undefined;
      },
    },
  });
  const rejectedStarted = rejected.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    createLaunch(),
  );
  rejected.children[0].emitMessage({
    type: "provider-host-network-request",
    contractVersion: ipcContractVersion,
    requestId: "profile-a.1",
    request: { url: "https://api.example.com/v1/status" },
  });
  rejected.children[0].emitMessage({
    type: "provider-host-credential-request",
    contractVersion: ipcContractVersion,
    requestId: "profile-a.2",
    credentialKey: "auth_token",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(rejected.children[0].posted.slice(-2), [
    {
      type: "provider-host-network-response",
      contractVersion: ipcContractVersion,
      requestId: "profile-a.1",
      ok: false,
      code: "PROVIDER_HOST_NETWORK_FAILED",
    },
    {
      type: "provider-host-credential-response",
      contractVersion: ipcContractVersion,
      requestId: "profile-a.2",
      ok: false,
      code: "PROVIDER_HOST_CREDENTIAL_FAILED",
    },
  ]);
  rejected.children[0].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await rejectedStarted;
});

test("fails the provider when a host response cannot be posted", async () => {
  const scheduler = createScheduler();
  const messages = new Set();
  let killCount = 0;
  const unavailable = [];
  const supervisor = createProviderUtilitySupervisor({
    spawn() {
      return {
        postMessage(message) {
          if (message.type === "provider-host-network-response") {
            throw new Error("post failed");
          }
        },
        kill() {
          killCount += 1;
        },
        onMessage(listener) {
          messages.add(listener);
          return () => messages.delete(listener);
        },
        onExit() {
          return () => undefined;
        },
      };
    },
    scheduler: scheduler.scheduler,
    startupTimeoutMs: 5_000,
    shutdownTimeoutMs: 2_000,
    onUnavailable(providerProfileId, code) {
      unavailable.push({ providerProfileId, code });
    },
    hostBroker: {
      async requestNetwork() {
        return { status: 200, headers: {}, body: new Uint8Array() };
      },
      async getCredential() {
        return null;
      },
      log() {
        return undefined;
      },
      reportStatus() {
        return undefined;
      },
    },
  });
  const started = supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    createLaunch(),
  );
  const rejectedStart = assert.rejects(
    started,
    new Error("Provider host response could not be delivered."),
  );
  for (const listener of messages) {
    listener({
      type: "provider-host-network-request",
      contractVersion: ipcContractVersion,
      requestId: "profile-a.1",
      request: { url: "https://api.example.com/v1/status" },
    });
  }
  await new Promise((resolve) => setImmediate(resolve));

  await rejectedStart;
  assert.equal(supervisor.getStatus("profile-a"), "failed");
  assert.equal(killCount, 1);
  assert.deepEqual(unavailable, [
    {
      providerProfileId: "profile-a",
      code: "PROVIDER_UTILITY_PROTOCOL_VIOLATION",
    },
  ]);
});

test("resolves shutdown when an out-of-sequence host message fails the provider", async () => {
  const fixture = createFixture();
  const started = fixture.supervisor.start("profile-a", "/runtime/provider.js");
  fixture.children[0].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await started;

  const stopped = fixture.supervisor.shutdown("profile-a");
  fixture.children[0].emitMessage({
    type: "provider-host-log",
    contractVersion: ipcContractVersion,
    level: "info",
    code: "LATE_MESSAGE",
  });
  await stopped;

  assert.equal(fixture.supervisor.getStatus("profile-a"), "failed");
  assert.equal(fixture.children[0].getKillCount(), 1);
});
