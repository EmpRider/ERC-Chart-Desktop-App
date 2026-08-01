import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import {
  createElectronArguments,
  runIndependentElectronProcesses,
} from "./electron-smoke-process.mjs";

const defaultRoot = path.resolve(import.meta.dirname, "..");

export async function runMultiInstanceSmoke({
  platform = process.platform,
  environment = process.env,
  applicationRoot = defaultRoot,
  executable = electronPath,
  createUserDataPath = (instance) =>
    mkdtemp(path.join(os.tmpdir(), `erc-electron-smoke-${instance}-`)),
  removeUserDataPath = (userDataPath) =>
    rm(userDataPath, { recursive: true, force: true }),
  runProcesses = runIndependentElectronProcesses,
} = {}) {
  if (platform === "linux" && environment.DISPLAY === undefined) {
    throw new Error(
      "Electron multi-instance smoke requires a display server on Linux.",
    );
  }

  const entryPath = path.join(applicationRoot, "apps/desktop/dist/main.js");
  const userDataPaths = [];
  let smokeFailure;
  try {
    for (const instance of [1, 2]) {
      userDataPaths.push(await createUserDataPath(instance));
    }
    await runProcesses({
      processes: userDataPaths.map((userDataPath) => ({
        executable,
        args: createElectronArguments({ userDataPath, entryPath }),
        cwd: applicationRoot,
        env: {
          ...environment,
          ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        },
        timeoutMs: 15_000,
        readyMarker: "ERC_CHART_SMOKE_READY",
      })),
    });
  } catch (error) {
    smokeFailure = error;
  }

  const cleanupResults = await Promise.allSettled(
    userDataPaths.map((userDataPath) => removeUserDataPath(userDataPath)),
  );
  if (smokeFailure !== undefined) throw smokeFailure;
  const cleanupFailure = cleanupResults.find(
    (result) => result.status === "rejected",
  );
  if (cleanupFailure !== undefined) throw cleanupFailure.reason;
}

const currentFile = fileURLToPath(import.meta.url);
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === currentFile
) {
  await runMultiInstanceSmoke();
}
