import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

function assertSafeOutput(root, outputRoot) {
  const resolvedRoot = path.resolve(root);
  const resolvedOutput = path.resolve(outputRoot);
  const relativeRoot = path.relative(resolvedOutput, resolvedRoot);
  const outputContainsRoot =
    relativeRoot === "" ||
    (relativeRoot !== ".." &&
      !relativeRoot.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeRoot));
  if (
    outputContainsRoot ||
    resolvedOutput === path.parse(resolvedOutput).root
  ) {
    throw new Error("Runtime output directory is unsafe.");
  }
}

export async function buildRuntime({ root, outputRoot }) {
  assertSafeOutput(root, outputRoot);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  await build({
    entryPoints: [path.join(root, "packages/preload/src/runtime-entry.ts")],
    outfile: path.join(outputRoot, "preload.cjs"),
    bundle: true,
    external: ["electron"],
    format: "cjs",
    platform: "node",
    target: "node24",
    logLevel: "silent",
  });
  await build({
    entryPoints: [path.join(root, "packages/renderer/src/runtime-entry.tsx")],
    outfile: path.join(outputRoot, "renderer.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome150",
    logLevel: "silent",
  });

  await Promise.all(
    ["index.html", "styles.css"].map((fileName) =>
      copyFile(
        path.join(root, "apps/desktop/static", fileName),
        path.join(outputRoot, fileName),
      ),
    ),
  );
}

const currentFile = fileURLToPath(import.meta.url);
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === currentFile
) {
  const root = path.resolve(path.dirname(currentFile), "..");
  await buildRuntime({
    root,
    outputRoot: path.join(root, "apps/desktop/dist/runtime"),
  });
}
