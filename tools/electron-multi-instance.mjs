import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import electronPath from "electron";
import {
  createElectronArguments,
  runIndependentElectronProcesses,
} from "./electron-smoke-process.mjs";

const root = path.resolve(import.meta.dirname, "..");
const entryPath = path.join(root, "apps/desktop/dist/main.js");
if (process.platform === "linux" && process.env.DISPLAY === undefined) {
  throw new Error(
    "Electron multi-instance smoke requires a display server on Linux.",
  );
}

const userDataPaths = await Promise.all(
  [1, 2].map((instance) =>
    mkdtemp(path.join(os.tmpdir(), `erc-electron-smoke-${instance}-`)),
  ),
);

try {
  await runIndependentElectronProcesses({
    processes: userDataPaths.map((userDataPath) => ({
      executable: electronPath,
      args: createElectronArguments({ userDataPath, entryPath }),
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
      timeoutMs: 15_000,
      readyMarker: "ERC_CHART_SMOKE_READY",
    })),
  });
} finally {
  await Promise.all(
    userDataPaths.map((userDataPath) =>
      rm(userDataPath, { recursive: true, force: true }),
    ),
  );
}
