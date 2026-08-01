import assert from "node:assert/strict";
import test from "node:test";
import { launchDesktopMain } from "../dist/launcher.js";

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
