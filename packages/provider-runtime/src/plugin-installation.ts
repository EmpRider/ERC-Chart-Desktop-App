import { lstat, mkdir, realpath, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import type { PluginManifest } from "@erc-chart/contracts";
import type { StagedPluginPackage } from "./plugin-staging.js";

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u;
const pluginVersionPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export interface PluginInstallationOptions {
  readonly installationRoot: string;
}

export interface InstalledPluginPackage {
  readonly installationPath: string;
  readonly pluginId: string;
  readonly version: string;
  readonly manifest: PluginManifest;
  readonly packageHash: string;
}

async function optionalStat(targetPath: string) {
  try {
    return await lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function checkedInstallationRoot(value: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new RangeError("Plugin installation root is required.");
  return path.resolve(value);
}

function checkedStagedManifest(staged: StagedPluginPackage): PluginManifest {
  if (
    !pluginIdPattern.test(staged.manifest.id) ||
    !pluginVersionPattern.test(staged.manifest.version)
  )
    throw new Error("Staged plugin id or version is invalid.");
  if (!/^[a-f0-9]{64}$/u.test(staged.packageHash))
    throw new Error("Staged plugin package hash is invalid.");
  return staged.manifest;
}

function checkedPluginCoordinates(pluginId: string, version: string): void {
  if (!pluginIdPattern.test(pluginId) || !pluginVersionPattern.test(version))
    throw new Error("Plugin id or version is invalid.");
}

async function checkedManagedDirectory(
  directoryPath: string,
  label: string,
): Promise<string> {
  const info = await optionalStat(directoryPath);
  if (info === undefined) {
    await mkdir(directoryPath, { recursive: true });
  }
  const checkedInfo = await lstat(directoryPath);
  if (!checkedInfo.isDirectory() || checkedInfo.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory.`);
  }
  return realpath(directoryPath);
}

export async function installStagedPlugin(
  staged: StagedPluginPackage,
  options: PluginInstallationOptions,
): Promise<InstalledPluginPackage> {
  let pluginDirectory: string | undefined;
  try {
    const manifest = checkedStagedManifest(staged);
    const installationRoot = checkedInstallationRoot(options.installationRoot);
    const stagingInfo = await lstat(staged.stagingPath);
    if (!stagingInfo.isDirectory() || stagingInfo.isSymbolicLink())
      throw new Error("Staged plugin path must be a real directory.");

    const managedRoot = await checkedManagedDirectory(
      installationRoot,
      "Plugin installation root",
    );
    pluginDirectory = await checkedManagedDirectory(
      path.join(managedRoot, manifest.id),
      "Plugin installation directory",
    );
    const installationPath = path.join(pluginDirectory, manifest.version);
    if ((await optionalStat(installationPath)) !== undefined)
      throw new Error(
        `Plugin ${manifest.id}@${manifest.version} is already installed.`,
      );

    try {
      await rename(await realpath(staged.stagingPath), installationPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EXDEV") {
        throw new Error(
          "Plugin staging and installation directories must be on the same filesystem for atomic installation.",
          { cause: error },
        );
      }
      throw error;
    }

    return {
      installationPath,
      pluginId: manifest.id,
      version: manifest.version,
      manifest,
      packageHash: staged.packageHash,
    };
  } catch (error) {
    await rm(staged.stagingPath, { recursive: true, force: true });
    if (pluginDirectory !== undefined) {
      try {
        await rmdir(pluginDirectory);
      } catch (cleanupError) {
        if (
          !["ENOENT", "ENOTEMPTY"].includes(
            (cleanupError as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw cleanupError;
      }
    }
    throw error;
  }
}

export async function removeInstalledPlugin(
  options: PluginInstallationOptions,
  pluginId: string,
  version: string,
): Promise<boolean> {
  checkedPluginCoordinates(pluginId, version);

  const installationRoot = checkedInstallationRoot(options.installationRoot);
  const rootInfo = await optionalStat(installationRoot);
  if (rootInfo === undefined) return false;
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error("Plugin installation root must be a real directory.");
  const managedRoot = await realpath(installationRoot);
  const pluginDirectory = path.join(managedRoot, pluginId);
  const pluginInfo = await optionalStat(pluginDirectory);
  if (pluginInfo === undefined) return false;
  if (!pluginInfo.isDirectory() || pluginInfo.isSymbolicLink())
    throw new Error("Plugin installation directory must be a real directory.");
  const installationPath = path.join(pluginDirectory, version);
  const installedInfo = await optionalStat(installationPath);
  if (installedInfo === undefined) return false;
  if (!installedInfo.isDirectory() || installedInfo.isSymbolicLink())
    throw new Error("Installed plugin path must be a real directory.");

  await rm(installationPath, { recursive: true });
  try {
    await rmdir(pluginDirectory);
  } catch (error) {
    if (
      !["ENOENT", "ENOTEMPTY"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      throw error;
  }
  return true;
}
