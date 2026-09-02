import type { StagedPluginFile } from "./plugin-staging.js";

const staticAssetExtensions = new Set([
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".json",
  ".md",
  ".png",
  ".txt",
  ".webp",
]);

function fileExtension(packagePath: string): string {
  const slashIndex = packagePath.lastIndexOf("/");
  const dotIndex = packagePath.lastIndexOf(".");
  if (dotIndex <= slashIndex) return "";
  return packagePath.slice(dotIndex).toLocaleLowerCase("en-US");
}

function isAllowedPluginPackageFile(packagePath: string): boolean {
  if (packagePath === "plugin.json" || packagePath === "LICENSE") return true;
  if (packagePath.startsWith("dist/")) {
    const extension = fileExtension(packagePath);
    return extension === ".js" || extension === ".mjs";
  }
  if (packagePath.startsWith("assets/")) {
    return staticAssetExtensions.has(fileExtension(packagePath));
  }
  return false;
}

export function assertPluginPackageContentPolicy(
  files: readonly StagedPluginFile[],
): void {
  for (const file of files) {
    if (!isAllowedPluginPackageFile(file.path)) {
      throw new Error(
        `Plugin package contains a file outside the approved manifest, JavaScript module, static asset, and license allowlist: ${file.path}.`,
      );
    }
  }
}
