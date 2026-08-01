import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { applicationVersion, productName } from "./packaging-contract.mjs";

function assertContained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Package output must be a contained child directory.");
  }
}

export async function preparePackage({ root, outputRoot }) {
  assertContained(root, outputRoot);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const bundleEntry = async (entryPoint, outfile) => {
    await mkdir(path.dirname(outfile), { recursive: true });
    await build({
      entryPoints: [path.join(root, entryPoint)],
      outfile,
      bundle: true,
      external: ["electron"],
      format: "esm",
      platform: "node",
      target: "node24",
      logLevel: "silent",
    });
  };

  await Promise.all([
    bundleEntry(
      "apps/desktop/src/main.ts",
      path.join(outputRoot, "apps/desktop/dist/main.js"),
    ),
    bundleEntry(
      "packages/data-service/src/utility-entry.ts",
      path.join(outputRoot, "packages/data-service/dist/utility-entry.js"),
    ),
    bundleEntry(
      "packages/provider-runtime/src/utility-entry.ts",
      path.join(outputRoot, "packages/provider-runtime/dist/utility-entry.js"),
    ),
  ]);

  await cp(
    path.join(root, "apps/desktop/dist/runtime"),
    path.join(outputRoot, "apps/desktop/dist/runtime"),
    { recursive: true },
  );
  await writeFile(
    path.join(outputRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "erc-chart-desktop-app",
        version: applicationVersion,
        description: `${productName} development shell`,
        author: "EmpRider",
        main: "apps/desktop/dist/main.js",
        type: "module",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const rootManifest = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  if (rootManifest.version !== applicationVersion) {
    throw new Error("Package version differs from the application manifest.");
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === currentFile
) {
  const root = path.resolve(import.meta.dirname, "../..");
  await preparePackage({
    root,
    outputRoot: path.join(root, "out/package-app"),
  });
}
