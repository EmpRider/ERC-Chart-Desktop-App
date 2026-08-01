import assert from "node:assert/strict";
import test from "node:test";
import { runMultiInstanceSmoke } from "./electron-multi-instance.mjs";

test("cleans a partially created profile set without running Electron", async () => {
  const removed = [];
  let creation = 0;

  await assert.rejects(
    runMultiInstanceSmoke({
      platform: "win32",
      environment: {},
      createUserDataPath: async () => {
        creation += 1;
        if (creation === 2) throw new Error("profile creation failed");
        return "profile-one";
      },
      removeUserDataPath: async (userDataPath) => {
        removed.push(userDataPath);
      },
      runProcesses: async () => assert.fail("Electron must not start"),
    }),
    new Error("profile creation failed"),
  );
  assert.deepEqual(removed, ["profile-one"]);
});

test("preserves the smoke failure when profile cleanup also fails", async () => {
  await assert.rejects(
    runMultiInstanceSmoke({
      platform: "win32",
      environment: {},
      createUserDataPath: async (instance) => `profile-${instance}`,
      removeUserDataPath: async () => {
        throw new Error("cleanup failed");
      },
      runProcesses: async () => {
        throw new Error("smoke failed");
      },
    }),
    new Error("smoke failed"),
  );
});
