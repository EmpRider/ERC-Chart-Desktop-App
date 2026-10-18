import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { extractFile } from "@electron/asar";
import { runIndependentElectronProcesses } from "../electron-smoke-process.mjs";
import {
  applicationVersion,
  assertPackagedVersion,
  installedExecutablePath,
  installerArtifactName,
  packagedElectronArguments,
  productName,
} from "./packaging-contract.mjs";

const maximumDiagnosticCharacters = 8_192;
const unpackedRuntimeEntries = [
  ["packages", "data-service", "dist", "utility-entry.js"],
  ["packages", "provider-runtime", "dist", "utility-entry.js"],
  ["packages", "provider-sdk", "dist", "index.js"],
];

async function assertInstalledRuntimeFiles(accessFile, installationRoot) {
  try {
    await Promise.all(
      unpackedRuntimeEntries.map((segments) =>
        accessFile(
          path.join(
            installationRoot,
            "resources",
            "app.asar.unpacked",
            ...segments,
          ),
        ),
      ),
    );
  } catch {
    throw new Error("Installed unpacked utility runtime is unavailable.");
  }
}

export function runCommand({
  executable,
  args,
  timeoutMs,
  terminationGraceMs = 5_000,
  spawnProcess = spawn,
}) {
  return new Promise((resolve, reject) => {
    let diagnostic = "";
    let finished = false;
    let timedOut = false;
    let terminationTimeout;
    const child = spawnProcess(executable, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    const timeout = setTimeout(() => {
      if (finished) return;
      timedOut = true;
      child.kill();
      terminationTimeout = setTimeout(() => {
        if (finished) return;
        child.kill("SIGKILL");
        finished = true;
        reject(
          new Error(
            `Installer command timed out after ${timeoutMs} ms and did not close within ${terminationGraceMs} ms.`,
          ),
        );
      }, terminationGraceMs);
    }, timeoutMs);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      diagnostic = `${diagnostic}${chunk}`.slice(-maximumDiagnosticCharacters);
    });
    child.on("error", (error) => {
      if (finished || timedOut) return;
      finished = true;
      clearTimeout(timeout);
      clearTimeout(terminationTimeout);
      reject(new Error(`Installer command could not start: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearTimeout(terminationTimeout);
      if (timedOut) {
        reject(new Error(`Installer command timed out after ${timeoutMs} ms.`));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Installer command failed (exit code ${String(code)}, signal ${signal ?? "none"}). ${diagnostic.trim()}`,
        ),
      );
    });
  });
}

const defaultRoot = path.resolve(import.meta.dirname, "../..");

export async function runInstallerSmoke({
  platform = process.platform,
  environment = process.env,
  applicationRoot = defaultRoot,
  createProfile = (instance) =>
    mkdtemp(path.join(os.tmpdir(), `erc-installed-smoke-${instance}-`)),
  removeProfile = (profile) => rm(profile, { recursive: true, force: true }),
  accessFile = access,
  extractPackagedFile = extractFile,
  executeCommand = runCommand,
  runProcesses = runIndependentElectronProcesses,
} = {}) {
  if (platform !== "win32") {
    throw new Error("Installer smoke must run on Windows.");
  }
  const localAppData = environment.LOCALAPPDATA;
  const executablePath = installedExecutablePath(localAppData ?? "");
  const installationRoot = path.dirname(executablePath);
  const uninstallerPath = path.join(
    installationRoot,
    `Uninstall ${productName}.exe`,
  );
  const installerPath = path.join(
    applicationRoot,
    "release",
    installerArtifactName(applicationVersion),
  );
  const profiles = [];
  let installed = false;
  let smokeFailure;

  try {
    for (const instance of [1, 2]) {
      profiles.push(await createProfile(instance));
    }
    await accessFile(installerPath);
    await executeCommand({
      executable: installerPath,
      args: ["/S"],
      timeoutMs: 120_000,
    });
    installed = true;
    await accessFile(executablePath);
    const asarPath = path.join(installationRoot, "resources", "app.asar");
    const packagedManifest = JSON.parse(
      extractPackagedFile(asarPath, "package.json").toString("utf8"),
    );
    assertPackagedVersion(packagedManifest.version);
    await assertInstalledRuntimeFiles(accessFile, installationRoot);
    await runProcesses({
      processes: profiles.map((profile) => ({
        executable: executablePath,
        args: packagedElectronArguments(profile),
        cwd: installationRoot,
        env: {
          ...environment,
          ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        },
        timeoutMs: 30_000,
        readyMarker: "ERC_CHART_SMOKE_READY",
      })),
    });
  } catch (error) {
    smokeFailure = error;
  }

  let uninstallFailure;
  if (installed) {
    try {
      await executeCommand({
        executable: uninstallerPath,
        args: ["/S"],
        timeoutMs: 120_000,
      });
    } catch (error) {
      uninstallFailure = error;
    }
  }
  const cleanupResults = await Promise.allSettled(
    profiles.map((profile) => removeProfile(profile)),
  );
  if (smokeFailure !== undefined) throw smokeFailure;
  if (uninstallFailure !== undefined) throw uninstallFailure;
  const cleanupFailure = cleanupResults.find(
    (result) => result.status === "rejected",
  );
  if (cleanupFailure !== undefined) throw cleanupFailure.reason;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (invokedDirectly) await runInstallerSmoke();
