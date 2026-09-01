import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { runCommand, runInstallerSmoke } from "./installer-smoke.mjs";

test("waits for a timed-out installer command to close", async () => {
  const child = new EventEmitter();
  child.stderr = new PassThrough();
  let killed = false;
  child.kill = () => {
    killed = true;
  };
  let settled = false;
  const result = runCommand({
    executable: "unused",
    args: [],
    timeoutMs: 10,
    spawnProcess: () => child,
  });
  void result.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(killed, true);
  assert.equal(settled, false);
  child.emit("close", null, "SIGTERM");
  await assert.rejects(result, /timed out after 10 ms/);
});

test("forces termination and rejects when a timed-out command never closes", async () => {
  const child = new EventEmitter();
  child.stderr = new PassThrough();
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal ?? "SIGTERM");
  };

  await assert.rejects(
    runCommand({
      executable: "unused",
      args: [],
      timeoutMs: 10,
      terminationGraceMs: 10,
      spawnProcess: () => child,
    }),
    /did not close within 10 ms/,
  );
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("cleans a partial installer profile set", async () => {
  let creation = 0;
  const removed = [];

  await assert.rejects(
    runInstallerSmoke({
      platform: "win32",
      environment: { LOCALAPPDATA: "local-app-data" },
      createProfile: async () => {
        creation += 1;
        if (creation === 2) throw new Error("profile creation failed");
        return "profile-one";
      },
      removeProfile: async (profile) => {
        removed.push(profile);
      },
      accessFile: async () => assert.fail("Installer must not start"),
    }),
    new Error("profile creation failed"),
  );
  assert.deepEqual(removed, ["profile-one"]);
});

test("preserves the application smoke failure when uninstall and cleanup fail", async () => {
  let command = 0;

  await assert.rejects(
    runInstallerSmoke({
      platform: "win32",
      environment: { LOCALAPPDATA: "local-app-data" },
      createProfile: async (instance) => `profile-${instance}`,
      removeProfile: async () => {
        throw new Error("cleanup failed");
      },
      accessFile: async () => undefined,
      extractPackagedFile: () =>
        Buffer.from(JSON.stringify({ version: "0.2.3" })),
      executeCommand: async () => {
        command += 1;
        if (command === 2) throw new Error("uninstall failed");
      },
      runProcesses: async () => {
        throw new Error("application smoke failed");
      },
    }),
    new Error("application smoke failed"),
  );
});
