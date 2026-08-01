import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import electronPath from "electron";
import {
  createElectronArguments,
  runElectronProcess,
} from "./electron-smoke-process.mjs";

const root = path.resolve(import.meta.dirname, "..");
const entryPath = path.join(root, "apps/desktop/dist/main.js");
if (process.platform === "linux" && process.env.DISPLAY === undefined) {
  throw new Error("Electron smoke test requires a display server on Linux.");
}
const userDataPath = await mkdtemp(
  path.join(os.tmpdir(), "erc-electron-smoke-"),
);
const electronArguments = createElectronArguments({
  userDataPath,
  entryPath,
});

try {
  await runElectronProcess({
    executable: electronPath,
    args: electronArguments,
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
    timeoutMs: 15_000,
    readyMarker: "ERC_CHART_SMOKE_READY",
  });
} finally {
  await rm(userDataPath, { recursive: true, force: true });
}
