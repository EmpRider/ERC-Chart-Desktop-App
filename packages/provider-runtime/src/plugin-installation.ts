import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import type { PluginManifest } from "@erc-chart/contracts";
import type { StagedPluginPackage } from "./plugin-staging.js";

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u;
const pluginVersionPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export interface PluginInstallationOptions {
  readonly installationRoot: string;
  readonly replaceExisting?: boolean;
  readonly deferReplacementCommit?: boolean;
}

export interface PluginReplacementTransaction {
  readonly commit: () => Promise<void>;
  readonly rollback: () => Promise<void>;
}

/** The original package remains in backup and must not be activated. */
export class PluginInstallationRecoveryError extends Error {
  constructor(cause: unknown) {
    super(
      "Plugin installation could not be restored; the plugin must remain disabled.",
      { cause },
    );
    this.name = "PluginInstallationRecoveryError";
  }
}

export interface InstalledPluginPackage {
  readonly installationPath: string;
  readonly pluginId: string;
  readonly version: string;
  readonly manifest: PluginManifest;
  readonly packageHash: string;
  readonly replacement?: PluginReplacementTransaction;
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
  let replacementBackupPath: string | undefined;
  let installationPath: string | undefined;
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
    installationPath = path.join(pluginDirectory, manifest.version);
    const existingInfo = await optionalStat(installationPath);
    if (existingInfo !== undefined) {
      if (!options.replaceExisting)
        throw new Error(
          `Plugin ${manifest.id}@${manifest.version} is already installed.`,
        );
      if (!existingInfo.isDirectory() || existingInfo.isSymbolicLink())
        throw new Error("Installed plugin path must be a real directory.");
      const backupPath = path.join(
        pluginDirectory,
        `.${manifest.version}.replacement-${randomUUID()}`,
      );
      await rename(installationPath, backupPath);
      replacementBackupPath = backupPath;
    }

    try {
      await rename(await realpath(staged.stagingPath), installationPath);
    } catch (error) {
      if (replacementBackupPath !== undefined) {
        try {
          await rename(replacementBackupPath, installationPath);
          replacementBackupPath = undefined;
        } catch {
          // Keep the backup path so the outer recovery handler can retry.
        }
      }
      if ((error as NodeJS.ErrnoException).code === "EXDEV") {
        throw new Error(
          "Plugin staging and installation directories must be on the same filesystem for atomic installation.",
          { cause: error },
        );
      }
      throw error;
    }

    if (
      replacementBackupPath !== undefined &&
      !options.deferReplacementCommit
    ) {
      await rm(replacementBackupPath, { recursive: true, force: true }).catch(
        () => undefined,
      );
      replacementBackupPath = undefined;
    }

    const replacement =
      replacementBackupPath === undefined
        ? undefined
        : ({
            commit: async (): Promise<void> => {
              if (replacementBackupPath === undefined) return;
              await rm(replacementBackupPath, {
                recursive: true,
                force: true,
              }).catch(() => undefined);
              replacementBackupPath = undefined;
            },
            rollback: async (): Promise<void> => {
              if (
                replacementBackupPath === undefined ||
                pluginDirectory === undefined ||
                installationPath === undefined
              )
                return;
              const replacementPath = path.join(
                pluginDirectory,
                `.${manifest.version}.rollback-${randomUUID()}`,
              );
              await rename(installationPath, replacementPath);
              try {
                await rename(replacementBackupPath, installationPath);
                replacementBackupPath = undefined;
              } catch (error) {
                await rename(replacementPath, installationPath).catch(
                  () => undefined,
                );
                throw error;
              }
              await rm(replacementPath, { recursive: true, force: true });
            },
          } satisfies PluginReplacementTransaction);

    return {
      installationPath,
      pluginId: manifest.id,
      version: manifest.version,
      manifest,
      packageHash: staged.packageHash,
      ...(replacement === undefined ? {} : { replacement }),
    };
  } catch (error) {
    if (
      replacementBackupPath !== undefined &&
      pluginDirectory !== undefined &&
      installationPath !== undefined
    ) {
      try {
        if ((await optionalStat(installationPath)) === undefined) {
          await rename(replacementBackupPath, installationPath);
          replacementBackupPath = undefined;
        }
      } catch {
        // An inaccessible path is not evidence of successful restoration.
      }
    }
    await rm(staged.stagingPath, { recursive: true, force: true }).catch(
      () => undefined,
    );
    if (replacementBackupPath !== undefined)
      throw new PluginInstallationRecoveryError(error);
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
