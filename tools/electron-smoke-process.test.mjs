import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  createElectronArguments,
  runIndependentElectronProcesses,
  runElectronProcess,
} from "./electron-smoke-process.mjs";

test("keeps the Chromium sandbox enabled for smoke runs", () => {
  assert.deepEqual(
    createElectronArguments({
      userDataPath: "/tmp/profile",
      entryPath: "/repo/main.js",
    }),
    ["--user-data-dir=/tmp/profile", "/repo/main.js", "--erc-chart-smoke"],
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

test("does not settle a timed-out process until the child closes", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let killed = false;
  child.kill = () => {
    killed = true;
  };
  let settled = false;

  const result = runElectronProcess({
    executable: "unused",
    args: [],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 10,
    readyMarker: "ERC_CHART_SMOKE_READY",
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

test("starts two independent Electron processes before either completes", async () => {
  const started = [];
  const releases = [];
  const running = runIndependentElectronProcesses({
    processes: [{ instance: 1 }, { instance: 2 }],
    runProcess: async (configuration) =>
      new Promise((resolve) => {
        started.push(configuration.instance);
        releases.push(resolve);
      }),
  });

  await Promise.resolve();
  assert.deepEqual(started, [1, 2]);
  for (const release of releases) release();
  await running;
});

test("fails when either independent Electron process fails", async () => {
  const started = [];

  await assert.rejects(
    runIndependentElectronProcesses({
      processes: [{ instance: 1 }, { instance: 2 }],
      runProcess: async (configuration) => {
        started.push(configuration.instance);
        if (configuration.instance === 2) throw new Error("instance failed");
      },
    }),
    new Error("instance failed"),
  );
  assert.deepEqual(started, [1, 2]);
});

test("waits for every independent process to settle before rejecting", async () => {
  let releaseFirst;
  let settled = false;
  const running = runIndependentElectronProcesses({
    processes: [{ instance: 1 }, { instance: 2 }],
    runProcess: async (configuration) => {
      if (configuration.instance === 2) throw new Error("instance failed");
      return new Promise((resolve) => {
        releaseFirst = resolve;
      });
    },
  });
  void running.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  releaseFirst();
  await assert.rejects(running, new Error("instance failed"));
});
