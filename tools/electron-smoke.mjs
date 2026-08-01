import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import electronPath from "electron";

const root = path.resolve(import.meta.dirname, "..");
const entryPath = path.join(root, "apps/desktop/dist/main.js");
if (process.platform === "linux" && process.env.DISPLAY === undefined) {
  throw new Error("Electron smoke test requires a display server on Linux.");
}
const userDataPath = await mkdtemp(
  path.join(os.tmpdir(), "erc-electron-smoke-"),
);
const electronArguments = [];
if (typeof process.getuid === "function" && process.getuid() === 0) {
  electronArguments.push("--no-sandbox");
}
electronArguments.push(
  `--user-data-dir=${userDataPath}`,
  entryPath,
  "--erc-chart-smoke",
);

try {
  await new Promise((resolve, reject) => {
    let ready = false;
    let finished = false;
    const child = spawn(electronPath, electronArguments, {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill();
      reject(new Error("Electron smoke test timed out."));
    }, 15_000);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (chunk.includes("ERC_CHART_SMOKE_READY")) ready = true;
    });
    child.stderr.resume();
    child.on("error", () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(new Error("Electron smoke process could not start."));
    });
    child.on("exit", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (code === 0 && ready) resolve();
      else reject(new Error("Electron smoke test did not reach ready state."));
    });
  });
} finally {
  await rm(userDataPath, { recursive: true, force: true });
}
