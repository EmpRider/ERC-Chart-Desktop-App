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

function createFixture() {
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
  });
  return { ...scheduler, children, spawnCalls, unavailable, supervisor };
}

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
