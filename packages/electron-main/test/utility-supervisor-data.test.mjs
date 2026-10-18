import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { createUtilitySupervisor } from "../dist/index.js";

function fixture() {
  const messageListeners = new Set();
  const exitListeners = new Set();
  const posted = [];
  const spawnCalls = [];
  const child = {
    postMessage(message) {
      posted.push(message);
    },
    kill() {
      /* Exit is emitted explicitly by the test. */
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onExit(listener) {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
  };
  const supervisor = createUtilitySupervisor({
    spawn(entryPath, args) {
      spawnCalls.push({ entryPath, args });
      return child;
    },
    scheduler: {
      setTimeout() {
        return {};
      },
      clearTimeout() {
        /* This fixture does not schedule real timers. */
      },
    },
    startupTimeoutMs: 5_000,
    shutdownTimeoutMs: 2_000,
    onUnavailable() {
      /* Tests inspect supervisor status directly. */
    },
  });
  return {
    supervisor,
    posted,
    spawnCalls,
    emitMessage(message) {
      for (const listener of [...messageListeners]) listener(message);
    },
    emitExit(code) {
      for (const listener of [...exitListeners]) listener(code);
    },
  };
}

test("posts initialization before ready and forwards data messages", async () => {
  const target = fixture();
  const received = [];
  const remove = target.supervisor.onMessage((message) =>
    received.push(message),
  );
  const init = {
    type: "data-init",
    contractVersion: ipcContractVersion,
    generation: 1,
    databasePath: "C:/tmp/erc.sqlite",
    instanceId: "instance:test",
    legacyWorkspaceId: "last-workspace",
  };
  const started = target.supervisor.start("/runtime/data.js", [], [init]);

  assert.deepEqual(target.posted, [init]);
  target.emitMessage({
    type: "data-result",
    contractVersion: ipcContractVersion,
    requestId: "request:1",
    generation: 1,
    ok: true,
    payload: null,
  });
  assert.equal(received.length, 1);
  target.emitMessage({ type: "ready", contractVersion: ipcContractVersion });
  await started;
  remove();
});

test("can start a fresh child generation after an unexpected exit", async () => {
  const target = fixture();
  const first = target.supervisor.start("/runtime/data.js", []);
  target.emitMessage({ type: "ready", contractVersion: ipcContractVersion });
  await first;
  target.emitExit(7);
  assert.equal(target.supervisor.getStatus(), "failed");

  const second = target.supervisor.start("/runtime/data.js", []);
  target.emitMessage({ type: "ready", contractVersion: ipcContractVersion });
  await second;

  assert.equal(target.supervisor.getStatus(), "ready");
  assert.equal(target.spawnCalls.length, 2);
});
