import assert from "node:assert/strict";
import test from "node:test";
import { runElectronProcess } from "./electron-smoke-process.mjs";

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
