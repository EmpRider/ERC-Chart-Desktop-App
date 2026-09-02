import type { StagedPluginFile } from "./plugin-staging.js";

const forbiddenPluginPackageExtensions = new Set([
  ".a",
  ".appx",
  ".appxbundle",
  ".bat",
  ".cab",
  ".cmd",
  ".com",
  ".cpl",
  ".dll",
  ".dylib",
  ".exe",
  ".hta",
  ".lib",
  ".msi",
  ".msix",
  ".msp",
  ".node",
  ".o",
  ".obj",
  ".ocx",
  ".ps1",
  ".py",
  ".pyc",
  ".pyd",
  ".pyo",
  ".pyw",
  ".sh",
  ".so",
  ".sys",
  ".vbe",
  ".vbs",
  ".wasm",
  ".wsf",
  ".wsh",
]);

function fileExtension(packagePath: string): string {
  const slashIndex = packagePath.lastIndexOf("/");
  const dotIndex = packagePath.lastIndexOf(".");
  if (dotIndex <= slashIndex) return "";
  return packagePath.slice(dotIndex).toLocaleLowerCase("en-US");
}

export function assertPluginPackageContentPolicy(
  files: readonly StagedPluginFile[],
): void {
  for (const file of files) {
    if (forbiddenPluginPackageExtensions.has(fileExtension(file.path))) {
      throw new Error(
        `Plugin package contains a forbidden executable, native, Python, install-hook, or unsupported runtime file: ${file.path}.`,
      );
    }
  }
}
