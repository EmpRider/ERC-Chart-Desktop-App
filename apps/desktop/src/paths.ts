import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  rendererEntryUrl,
  type DesktopArtifactPaths,
} from "@erc-chart/electron-main";

export function resolveDesktopArtifacts(
  moduleUrl: string,
): DesktopArtifactPaths {
  const moduleDirectory = path.dirname(fileURLToPath(moduleUrl));
  const repositoryRoot = path.resolve(moduleDirectory, "../../..");
  const rendererRootPath = path.join(moduleDirectory, "runtime");
  return {
    preloadPath: path.join(rendererRootPath, "preload.cjs"),
    rendererRootPath,
    rendererEntryUrl,
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
    await Promise.all(
      [
        paths.preloadPath,
        path.join(paths.rendererRootPath, "index.html"),
        paths.dataUtilityPath,
        paths.providerUtilityPath,
      ].map((filePath) => access(filePath)),
    );
  } catch {
    throw new Error("Required desktop artifact is unavailable.");
  }
}
