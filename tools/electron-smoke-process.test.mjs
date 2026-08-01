import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  createElectronArguments,
  runElectronProcess,
} from "./electron-smoke-process.mjs";

test("keeps the Chromium sandbox enabled for smoke runs", () => {
  assert.deepEqual(
    createElectronArguments({
      userDataPath: "/tmp/profile",
      entryPath: "/repo/main.js",
    }),
    [
      "--user-data-dir=/tmp/profile",
      "/repo/main.js",
      "--erc-chart-smoke",
    ],
  );
});

test("reports the Electron exit status and bounded stderr when readiness fails", async () => {
  const stderr = `boot failed: ${"x".repeat(10_000)}:root cause`;

  await assert.rejects(
    runElectronProcess({
      executable: process.execPath,
      args: [
        "-e",
        `process.stderr.write(${JSON.stringify(stderr)}); process.exit(7);`,
      ],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
      readyMarker: "ERC_CHART_SMOKE_READY",
    }),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.match(error.message, /exit code 7/);
      assert.match(error.message, /root cause/);
      assert.doesNotMatch(error.message, /boot failed/);
      assert.ok(error.message.length < 9_000);
      return true;
    },
  );
});

test("reports the last Electron stdout stage when the process times out", async () => {
  await assert.rejects(
    runElectronProcess({
      executable: process.execPath,
      args: [
        "-e",
        "console.log('ERC_CHART_SMOKE_STAGE app-ready'); setInterval(() => {}, 1000);",
      ],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 500,
      readyMarker: "ERC_CHART_SMOKE_READY",
    }),
    /ERC_CHART_SMOKE_STAGE app-ready/,
  );
});

test("recognizes a ready marker split across stdout chunks", async () => {
  await runElectronProcess({
    executable: process.execPath,
    args: [
      "-e",
      "process.stdout.write('ERC_CHART_'); setTimeout(() => { process.stdout.write('SMOKE_READY'); setTimeout(() => process.exit(0), 50); }, 50);",
    ],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 5_000,
    readyMarker: "ERC_CHART_SMOKE_READY",
  });
});

test("waits for stdio to close before evaluating the ready marker", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => undefined;

  const result = runElectronProcess({
    executable: "unused",
    args: [],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 5_000,
    readyMarker: "ERC_CHART_SMOKE_READY",
    spawnProcess: () => child,
  });

  child.emit("exit", 0, null);
  child.stdout.end("ERC_CHART_SMOKE_READY");
  child.stderr.end();
  child.emit("close", 0, null);

  await result;
});
