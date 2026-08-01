import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { createUtilitySupervisor } from "../dist/index.js";

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
  const messageListeners = new Set();
  const exitListeners = new Set();
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
        messageListeners.add(listener);
        return () => messageListeners.delete(listener);
      },
      onExit(listener) {
        exitListeners.add(listener);
        return () => exitListeners.delete(listener);
      },
    },
    emitMessage(message) {
      for (const listener of messageListeners) listener(message);
    },
    emitExit(code) {
      for (const listener of exitListeners) listener(code);
    },
    getKillCount() {
      return killCount;
    },
    posted,
  };
}

function createFixture() {
  const timerFixture = createScheduler();
  const childFixture = createChild();
  const unavailable = [];
  const spawnCalls = [];
  const supervisor = createUtilitySupervisor({
    spawn(entryPath, args) {
      spawnCalls.push({ entryPath, args });
      return childFixture.child;
    },
    scheduler: timerFixture.scheduler,
    startupTimeoutMs: 5_000,
    shutdownTimeoutMs: 2_000,
    onUnavailable(code) {
      unavailable.push(code);
    },
  });
  return {
    ...timerFixture,
    ...childFixture,
    supervisor,
    unavailable,
    spawnCalls,
  };
}

test("resolves startup only after the utility reports ready", async () => {
  const fixture = createFixture();
  const started = fixture.supervisor.start("/runtime/data.js", []);

  assert.equal(fixture.supervisor.getStatus(), "starting");
  fixture.emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await started;

  assert.equal(fixture.supervisor.getStatus(), "ready");
  assert.deepEqual(fixture.spawnCalls, [
    { entryPath: "/runtime/data.js", args: [] },
  ]);
});

test("fails and terminates a utility that misses the ready deadline", async () => {
  const fixture = createFixture();
  const started = fixture.supervisor.start("/runtime/data.js", []);

  fixture.runNext();

  await assert.rejects(started, new Error("Utility failed to become ready."));
  assert.equal(fixture.supervisor.getStatus(), "failed");
  assert.equal(fixture.getKillCount(), 1);
});

test("returns a rejected promise and safe state when spawn throws", async () => {
  const timerFixture = createScheduler();
  const supervisor = createUtilitySupervisor({
    spawn() {
      throw new Error("sensitive spawn failure");
    },
    scheduler: timerFixture.scheduler,
    startupTimeoutMs: 5_000,
    shutdownTimeoutMs: 2_000,
    onUnavailable: () => undefined,
  });

  const started = supervisor.start("/runtime/missing.js");

  await assert.rejects(started, new Error("Utility process could not start."));
  assert.equal(supervisor.getStatus(), "failed");
  await supervisor.shutdown();
  assert.equal(supervisor.getStatus(), "stopped");
});

test("reports an unexpected exit without owning renderer shutdown", async () => {
  const fixture = createFixture();
  const started = fixture.supervisor.start("/runtime/data.js", []);
  fixture.emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await started;

  fixture.emitExit(7);

  assert.equal(fixture.supervisor.getStatus(), "failed");
  assert.deepEqual(fixture.unavailable, ["UTILITY_EXITED"]);
});

test("requests shutdown once and accepts a clean stopped response", async () => {
  const fixture = createFixture();
  const started = fixture.supervisor.start("/runtime/data.js", []);
  fixture.emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await started;

  const stopped = fixture.supervisor.shutdown();
  assert.deepEqual(fixture.posted, [
    { type: "shutdown", contractVersion: ipcContractVersion },
  ]);
  fixture.emitMessage({
    type: "stopped",
    contractVersion: ipcContractVersion,
  });
  await stopped;
  await fixture.supervisor.shutdown();

  assert.equal(fixture.supervisor.getStatus(), "stopped");
  assert.equal(fixture.posted.length, 1);
  assert.equal(fixture.getKillCount(), 0);
});

test("forces termination when utility shutdown misses its deadline", async () => {
  const fixture = createFixture();
  const started = fixture.supervisor.start("/runtime/data.js", []);
  fixture.emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await started;

  const stopped = fixture.supervisor.shutdown();
  fixture.runNext();
  await stopped;

  assert.equal(fixture.supervisor.getStatus(), "stopped");
  assert.equal(fixture.getKillCount(), 1);
});
