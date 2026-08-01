import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DesktopArtifactPaths } from "@erc-chart/electron-main";

export function resolveDesktopArtifacts(
  moduleUrl: string,
): DesktopArtifactPaths {
  const moduleDirectory = path.dirname(fileURLToPath(moduleUrl));
  const repositoryRoot = path.resolve(moduleDirectory, "../../..");
  return {
    preloadPath: path.join(moduleDirectory, "runtime", "preload.cjs"),
    rendererHtmlPath: path.join(moduleDirectory, "runtime", "index.html"),
    dataUtilityPath: path.join(
      repositoryRoot,
      "packages",
      "data-service",
      "dist",
      "utility-entry.js",
    ),
    providerUtilityPath: path.join(
      repositoryRoot,
      "packages",
      "provider-runtime",
      "dist",
      "utility-entry.js",
    ),
  };
}

export async function validateDesktopArtifacts(
  paths: DesktopArtifactPaths,
): Promise<void> {
  try {
    await Promise.all(Object.values(paths).map((filePath) => access(filePath)));
  } catch {
    throw new Error("Required desktop artifact is unavailable.");
  }
}
