import assert from "node:assert/strict";
import test from "node:test";
import { finishDesktopSmoke, launchDesktopMain } from "../dist/launcher.js";

test("launches asynchronous desktop boot without blocking module evaluation", async () => {
  let finishBoot;
  const bootFinished = new Promise((resolve) => {
    finishBoot = resolve;
  });
  let failure;

  const result = launchDesktopMain(
    () => bootFinished,
    (error) => {
      failure = error;
    },
  );

  assert.equal(result, undefined);
  assert.equal(failure, undefined);
  finishBoot();
  await bootFinished;
});

test("routes an asynchronous desktop boot rejection to the failure handler", async () => {
  const expected = new Error("boot failed");
  const handled = new Promise((resolve) => {
    launchDesktopMain(async () => Promise.reject(expected), resolve);
  });

  assert.equal(await handled, expected);
});

test("shuts down the desktop before reporting a smoke exit", async () => {
  const events = [];

  await finishDesktopSmoke(
    Promise.resolve({
      async shutdown() {
        events.push("shutdown");
      },
    }),
    1,
    (exitCode) => events.push(`exit:${exitCode}`),
  );

  assert.deepEqual(events, ["shutdown", "exit:1"]);
});

test("reports the smoke exit even when shutdown rejects", async () => {
  const events = [];

  await assert.rejects(
    finishDesktopSmoke(
      Promise.resolve({
        async shutdown() {
          events.push("shutdown");
          throw new Error("shutdown failed");
        },
      }),
      1,
      (exitCode) => events.push(`exit:${exitCode}`),
    ),
    new Error("shutdown failed"),
  );

  assert.deepEqual(events, ["shutdown", "exit:1"]);
});

test("reports the smoke exit when the controller fails to start", async () => {
  const events = [];

  await assert.rejects(
    finishDesktopSmoke(
      Promise.reject(new Error("startup failed")),
      1,
      (exitCode) => events.push(`exit:${exitCode}`),
    ),
    new Error("startup failed"),
  );

  assert.deepEqual(events, ["exit:1"]);
});
