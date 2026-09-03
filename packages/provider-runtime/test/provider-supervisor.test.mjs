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
    ...(options.onProfileInvalidated === undefined
      ? {}
      : { onProfileInvalidated: options.onProfileInvalidated }),
    ...(options.onProfileRestored === undefined
      ? {}
      : { onProfileRestored: options.onProfileRestored }),
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

async function flushTasks() {
  await new Promise((resolve) => setImmediate(resolve));
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
      supervisor.start("profile-a", "/runtime/provider.js", createLaunch()),
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
  const first = fixture.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    createLaunch(),
  );
  const second = fixture.supervisor.start(
    "profile-b",
    "/runtime/provider.js",
    createLaunch(),
  );
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

test("reconfigures only the affected profile and runs invalidation/restoration hooks", async () => {
  const lifecycle = [];
  const fixture = createFixture({
    onProfileInvalidated(providerProfileId, impact) {
      lifecycle.push({ phase: "invalidated", providerProfileId, impact });
    },
    onProfileRestored(providerProfileId, impact) {
      lifecycle.push({ phase: "restored", providerProfileId, impact });
    },
  });
  const firstLaunch = createLaunch({
    settings: { endpoint: "https://api.example.com/v1" },
  });
  const secondLaunch = createLaunch({ settings: { region: "us" } });
  const first = fixture.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    firstLaunch,
  );
  const second = fixture.supervisor.start(
    "profile-b",
    "/runtime/provider.js",
    secondLaunch,
  );
  fixture.children[0].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  fixture.children[1].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await Promise.all([first, second]);

  const changed = fixture.supervisor.reconfigure("profile-a", {
    endpoint: "https://api.example.com/v2",
  });
  const validationRequest = fixture.children[0].posted.at(-1);
  assert.equal(validationRequest.type, "provider-config-validation-request");
  fixture.children[0].emitMessage({
    type: "provider-config-validation-response",
    contractVersion: ipcContractVersion,
    requestId: validationRequest.requestId,
    ok: true,
    impact: "reconnect",
    settings: { endpoint: "https://api.example.com/v2" },
    changedKeys: ["endpoint"],
  });
  await flushTasks();

  assert.deepEqual(lifecycle, [
    {
      phase: "invalidated",
      providerProfileId: "profile-a",
      impact: "reconnect",
    },
  ]);
  assert.deepEqual(fixture.children[0].posted.at(-1), {
    type: "shutdown",
    contractVersion: ipcContractVersion,
  });
  assert.notDeepEqual(fixture.children[1].posted.at(-1), {
    type: "shutdown",
    contractVersion: ipcContractVersion,
  });

  fixture.children[0].emitMessage({
    type: "stopped",
    contractVersion: ipcContractVersion,
  });
  await flushTasks();
  assert.equal(fixture.children.length, 3);
  assert.deepEqual(fixture.children[2].posted[0], {
    type: "provider-initialize",
    contractVersion: ipcContractVersion,
    launch: {
      ...firstLaunch,
      settings: { endpoint: "https://api.example.com/v2" },
    },
  });
  fixture.children[2].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });

  assert.deepEqual(await changed, {
    impact: "reconnect",
    settings: { endpoint: "https://api.example.com/v2" },
    changedKeys: ["endpoint"],
  });
  assert.deepEqual(lifecycle, [
    {
      phase: "invalidated",
      providerProfileId: "profile-a",
      impact: "reconnect",
    },
    {
      phase: "restored",
      providerProfileId: "profile-a",
      impact: "reconnect",
    },
  ]);
  assert.equal(fixture.supervisor.getStatus("profile-a"), "ready");
  assert.equal(fixture.supervisor.getStatus("profile-b"), "ready");
  assert.equal(fixture.children.length, 3);
});

test("rejects invalid configuration before stopping the current provider", async () => {
  const fixture = createFixture();
  const started = fixture.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    createLaunch({ settings: { region: "us" } }),
  );
  fixture.children[0].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await started;

  const changed = fixture.supervisor.reconfigure("profile-a", {
    region: "bad",
  });
  const validationRequest = fixture.children[0].posted.at(-1);
  fixture.children[0].emitMessage({
    type: "provider-config-validation-response",
    contractVersion: ipcContractVersion,
    requestId: validationRequest.requestId,
    ok: false,
    code: "PROVIDER_CONFIG_INVALID",
  });

  await assert.rejects(changed, (error) => {
    assert.equal(error.code, "PROVIDER_PROFILE_CONFIG_INVALID");
    return true;
  });
  assert.equal(fixture.children.length, 1);
  assert.equal(fixture.supervisor.getStatus("profile-a"), "ready");
  assert.equal(
    fixture.children[0].posted.some((message) => message.type === "shutdown"),
    false,
  );
});

test("rolls back the previous launch when a configuration restart fails", async () => {
  const lifecycle = [];
  const fixture = createFixture({
    onProfileInvalidated(providerProfileId, impact) {
      lifecycle.push({ phase: "invalidated", providerProfileId, impact });
    },
    onProfileRestored(providerProfileId, impact) {
      lifecycle.push({ phase: "restored", providerProfileId, impact });
    },
  });
  const previousLaunch = createLaunch({ settings: { region: "us" } });
  const started = fixture.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    previousLaunch,
  );
  fixture.children[0].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await started;

  const changed = fixture.supervisor.reconfigure("profile-a", { region: "eu" });
  const validationRequest = fixture.children[0].posted.at(-1);
  fixture.children[0].emitMessage({
    type: "provider-config-validation-response",
    contractVersion: ipcContractVersion,
    requestId: validationRequest.requestId,
    ok: true,
    impact: "restart",
    settings: { region: "eu" },
    changedKeys: ["region"],
  });
  await flushTasks();
  fixture.children[0].emitMessage({
    type: "stopped",
    contractVersion: ipcContractVersion,
  });
  await flushTasks();

  assert.deepEqual(fixture.children[1].posted[0], {
    type: "provider-initialize",
    contractVersion: ipcContractVersion,
    launch: { ...previousLaunch, settings: { region: "eu" } },
  });
  fixture.children[1].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion + 1,
  });
  await flushTasks();

  assert.equal(fixture.children.length, 3);
  assert.deepEqual(fixture.children[2].posted[0], {
    type: "provider-initialize",
    contractVersion: ipcContractVersion,
    launch: previousLaunch,
  });
  fixture.children[2].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });

  await assert.rejects(changed, (error) => {
    assert.equal(error.code, "PROVIDER_PROFILE_RESTART_FAILED");
    return true;
  });
  assert.equal(fixture.supervisor.getStatus("profile-a"), "ready");
  assert.deepEqual(lifecycle, [
    {
      phase: "invalidated",
      providerProfileId: "profile-a",
      impact: "restart",
    },
    {
      phase: "restored",
      providerProfileId: "profile-a",
      impact: "restart",
    },
  ]);
});

test("fails closed on malformed or out-of-sequence provider messages", async () => {
  const fixture = createFixture();
  const started = fixture.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    createLaunch(),
  );

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
    createLaunch(),
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
  const started = fixture.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    createLaunch(),
  );
  fixture.runNext();
  await assert.rejects(
    started,
    new Error("Provider utility failed to become ready."),
  );
  assert.equal(fixture.children[0].getKillCount(), 1);

  const restarted = fixture.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    createLaunch(),
  );
  fixture.children[1].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await restarted;
  const stopped = fixture.supervisor.shutdown("profile-a");
  assert.deepEqual(fixture.children[1].posted.at(-1), {
    type: "shutdown",
    contractVersion: ipcContractVersion,
  });
  fixture.runNext();
  await stopped;
  assert.equal(fixture.children[1].getKillCount(), 1);
  assert.equal(fixture.supervisor.getStatus("profile-a"), "stopped");
});

test("shutdownAll stops each active provider without cross-profile corruption", async () => {
  const fixture = createFixture();
  const first = fixture.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    createLaunch(),
  );
  const second = fixture.supervisor.start(
    "profile-b",
    "/runtime/provider.js",
    createLaunch(),
  );
  for (const child of fixture.children) {
    child.emitMessage({ type: "ready", contractVersion: ipcContractVersion });
  }
  await Promise.all([first, second]);

  const stopped = fixture.supervisor.shutdownAll();
  for (const child of fixture.children) {
    assert.deepEqual(child.posted.at(-1), {
      type: "shutdown",
      contractVersion: ipcContractVersion,
    });
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

test("bounds and cancels in-flight provider network requests", async () => {
  const signals = [];
  const fixture = createFixture({
    hostBroker: {
      requestNetwork(_providerProfileId, _request, signal) {
        signals.push(signal);
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
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
  const started = fixture.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    createLaunch(),
  );
  fixture.children[0].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await started;

  for (let index = 1; index <= 9; index += 1) {
    fixture.children[0].emitMessage({
      type: "provider-host-network-request",
      contractVersion: ipcContractVersion,
      requestId: `profile-a.${index}`,
      request: { url: "https://api.example.com/v1/status" },
    });
  }
  assert.equal(signals.length, 8);
  assert.deepEqual(fixture.children[0].posted.at(-1), {
    type: "provider-host-network-response",
    contractVersion: ipcContractVersion,
    requestId: "profile-a.9",
    ok: false,
    code: "PROVIDER_HOST_NETWORK_FAILED",
  });

  const stopped = fixture.supervisor.shutdown("profile-a");
  assert.equal(
    signals.every((signal) => signal.aborted),
    true,
  );
  fixture.children[0].emitMessage({
    type: "stopped",
    contractVersion: ipcContractVersion,
  });
  await stopped;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.supervisor.getStatus("profile-a"), "stopped");
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
  const started = fixture.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    createLaunch(),
  );
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

test("bridges provider discovery, history, live data, and unsubscribe through the supervised child", async () => {
  const fixture = createFixture();
  const started = fixture.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    createLaunch(),
  );
  const child = fixture.children[0];
  child.emitMessage({ type: "ready", contractVersion: ipcContractVersion });
  await started;

  const capabilitiesPromise = fixture.supervisor.getCapabilities("profile-a");
  const capabilitiesRequest = child.posted.at(-1);
  assert.equal(capabilitiesRequest.type, "provider-capabilities-request");
  child.emitMessage({
    type: "provider-capabilities-response",
    contractVersion: ipcContractVersion,
    requestId: capabilitiesRequest.requestId,
    ok: true,
    capabilities: {
      instruments: true,
      nativeTimeframes: ["1m"],
      liveData: true,
      derivedTimeframes: true,
    },
  });
  assert.equal((await capabilitiesPromise).liveData, true);

  const instrumentsPromise = fixture.supervisor.getInstruments("profile-a");
  const instrumentsRequest = child.posted.at(-1);
  child.emitMessage({
    type: "provider-instruments-response",
    contractVersion: ipcContractVersion,
    requestId: instrumentsRequest.requestId,
    ok: true,
    instruments: [{ id: "BTCUSD", symbol: "BTCUSD", name: "Bitcoin / USD" }],
  });
  assert.equal((await instrumentsPromise)[0].symbol, "BTCUSD");

  const historyPromise = fixture.supervisor.requestHistory("profile-a", {
    instrumentId: "BTCUSD",
    timeframeId: "1m",
    limit: 100,
  });
  const historyRequest = child.posted.at(-1);
  child.emitMessage({
    type: "provider-history-response",
    contractVersion: ipcContractVersion,
    requestId: historyRequest.requestId,
    ok: true,
    candles: [
      {
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        openTimeMs: 1_000,
        open: 10,
        high: 12,
        low: 9,
        close: 11,
      },
    ],
  });
  assert.equal((await historyPromise)[0].close, 11);

  const received = { ticks: [], candles: [], errors: [] };
  const subscriptionPromise = fixture.supervisor.subscribe(
    "profile-a",
    { instrumentId: "BTCUSD", timeframeId: "1m" },
    {
      onTicks(ticks) {
        received.ticks.push(...ticks);
      },
      onCandles(candles) {
        received.candles.push(...candles);
      },
      onError(code) {
        received.errors.push(code);
      },
    },
  );
  const subscribeRequest = child.posted.at(-1);
  assert.equal(subscribeRequest.type, "provider-subscribe-request");
  child.emitMessage({
    type: "provider-subscribe-response",
    contractVersion: ipcContractVersion,
    requestId: subscribeRequest.requestId,
    ok: true,
  });
  const subscription = await subscriptionPromise;

  child.emitMessage({
    type: "provider-subscription-ticks",
    contractVersion: ipcContractVersion,
    subscriptionId: subscribeRequest.subscriptionId,
    ticks: [{ instrumentId: "BTCUSD", timestampMs: 2_000, price: 12 }],
  });
  child.emitMessage({
    type: "provider-subscription-candles",
    contractVersion: ipcContractVersion,
    subscriptionId: subscribeRequest.subscriptionId,
    candles: [
      {
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        openTimeMs: 1_000,
        open: 10,
        high: 13,
        low: 9,
        close: 12,
      },
    ],
  });
  child.emitMessage({
    type: "provider-subscription-error",
    contractVersion: ipcContractVersion,
    subscriptionId: subscribeRequest.subscriptionId,
    code: "PROVIDER_DEGRADED",
  });
  assert.equal(received.ticks[0].price, 12);
  assert.equal(received.candles[0].close, 12);
  assert.deepEqual(received.errors, ["PROVIDER_DEGRADED"]);

  const unsubscribed = subscription.unsubscribe();
  const unsubscribeRequest = child.posted.at(-1);
  assert.equal(unsubscribeRequest.type, "provider-unsubscribe-request");
  assert.equal(
    unsubscribeRequest.subscriptionId,
    subscribeRequest.subscriptionId,
  );
  child.emitMessage({
    type: "provider-unsubscribe-response",
    contractVersion: ipcContractVersion,
    requestId: unsubscribeRequest.requestId,
    ok: true,
  });
  await unsubscribed;
  await subscription.unsubscribe();
  assert.equal(
    child.posted.filter(
      (message) => message.type === "provider-unsubscribe-request",
    ).length,
    1,
  );
});

test("rejects outstanding provider data work and invalidates live sinks when the child exits", async () => {
  const fixture = createFixture();
  const started = fixture.supervisor.start(
    "profile-a",
    "/runtime/provider.js",
    createLaunch(),
  );
  const child = fixture.children[0];
  child.emitMessage({ type: "ready", contractVersion: ipcContractVersion });
  await started;

  const errors = [];
  const subscriptionPromise = fixture.supervisor.subscribe(
    "profile-a",
    { instrumentId: "BTCUSD", timeframeId: "1m" },
    {
      onCandles() {
        return undefined;
      },
      onTicks() {
        return undefined;
      },
      onError(code) {
        errors.push(code);
      },
    },
  );
  const subscribeRequest = child.posted.at(-1);
  child.emitMessage({
    type: "provider-subscribe-response",
    contractVersion: ipcContractVersion,
    requestId: subscribeRequest.requestId,
    ok: true,
  });
  await subscriptionPromise;

  const pendingHistory = fixture.supervisor.requestHistory("profile-a", {
    instrumentId: "BTCUSD",
    timeframeId: "1m",
  });
  child.emitExit();

  await assert.rejects(
    pendingHistory,
    new Error("Provider utility became unavailable."),
  );
  assert.deepEqual(errors, ["PROVIDER_UTILITY_UNAVAILABLE"]);
  assert.equal(fixture.supervisor.getStatus("profile-a"), "failed");
});
