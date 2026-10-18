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
const userDataPath = await mkdtemp(
  path.join(os.tmpdir(), "erc-electron-workspace-restart-"),
);
const run = async (smokeArgument, readyMarker) =>
  runElectronProcess({
    executable: electronPath,
    args: createElectronArguments({ userDataPath, entryPath, smokeArgument }),
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
    timeoutMs: 15_000,
    readyMarker,
  });

try {
  await run("--erc-chart-workspace-seed", "ERC_CHART_WORKSPACE_SEEDED");
  await run("--erc-chart-workspace-verify", "ERC_CHART_WORKSPACE_RESTORED");
} finally {
  await rm(userDataPath, { recursive: true, force: true });
}
