import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { isInstalledIndicatorDefinition } from "../packages/contracts/dist/index.js";
import { indicatorAuthoringTransformPlugin } from "./indicator-authoring-transform.mjs";
import { transformIndicatorCallsites } from "./indicator-authoring/callsite-transform.mjs";
import { writePluginPackageArchive } from "./plugin-package-archive.mjs";

const indicatorCompilerBaseDefine = {
  __ERC_INDICATOR_COMPILED__: "true",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function findAuthoringRoot(sourcePath) {
  const fallback = path.dirname(sourcePath);
  let current = fallback;
  while (true) {
    try {
      await access(path.join(current, "package.json"));
      return current;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return fallback;
    current = parent;
  }
}

function withinRoot(root, fileName) {
  const relative = path.relative(root, fileName);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function compilerSourceFileId(root, fileName) {
  return path.relative(root, fileName).replaceAll(path.sep, "/");
}

function comparePlotDeclarations(left, right) {
  if (left.source.file !== right.source.file)
    return left.source.file < right.source.file ? -1 : 1;
  if (left.source.line !== right.source.line)
    return left.source.line - right.source.line;
  if (left.source.column !== right.source.column)
    return left.source.column - right.source.column;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function normalizePlotDeclarations(values) {
  const declarations = [...values].sort(comparePlotDeclarations);
  if (declarations.length > 128)
    throw new RangeError("An indicator may declare at most 128 plots.");
  return declarations.map((value, index) => ({
    id: value.id,
    callee: value.callee,
    kind: value.kind,
    outputKey: typeof value.key === "string" ? value.key : `plot_${index}`,
    label: typeof value.title === "string" ? value.title : `Plot ${index + 1}`,
    keyExplicit: typeof value.key === "string",
    titleExplicit: typeof value.title === "string",
    ...(typeof value.color === "string" ? { color: value.color } : {}),
    ...(typeof value.width === "number" ? { width: value.width } : {}),
    ...(typeof value.style === "string" ? { style: value.style } : {}),
    ...(typeof value.direction === "string"
      ? { direction: value.direction }
      : {}),
  }));
}

async function collectCompilerPlotDeclarations(sourcePath, authoringRoot) {
  const prebuild = await build({
    entryPoints: [sourcePath],
    bundle: true,
    write: false,
    metafile: true,
    platform: "neutral",
    format: "esm",
    target: "es2022",
    minify: false,
    define: {
      ...indicatorCompilerBaseDefine,
      __ERC_INDICATOR_PLOT_DECLARATIONS__: "[]",
    },
    plugins: [indicatorAuthoringTransformPlugin({ sourceRoot: authoringRoot })],
  });

  const inputNames = new Set();
  for (const output of Object.values(prebuild.metafile.outputs)) {
    for (const [inputName, input] of Object.entries(output.inputs)) {
      if (input.bytesInOutput > 0) inputNames.add(inputName);
    }
  }

  const byId = new Map();
  for (const inputName of inputNames) {
    const inputPath = path.resolve(inputName);
    if (!withinRoot(authoringRoot, inputPath)) continue;
    if (inputPath.includes(`${path.sep}node_modules${path.sep}`)) continue;
    if (!/\.[cm]?[jt]sx?$/u.test(inputPath)) continue;
    const sourceText = await readFile(inputPath, "utf8");
    const transformed = transformIndicatorCallsites(sourceText, {
      fileName: inputPath,
      sourceFileId: compilerSourceFileId(authoringRoot, inputPath),
    });
    for (const declaration of transformed.plotDeclarations) {
      const existing = byId.get(declaration.id);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(declaration))
          throw new Error(
            `Conflicting compiler plot declaration for ${declaration.id}.`,
          );
        continue;
      }
      byId.set(declaration.id, declaration);
    }
  }
  return normalizePlotDeclarations(byId.values());
}

export async function buildIndicatorPackage({
  source,
  outputRoot,
  id,
  name,
  version,
  description,
}) {
  if (typeof id !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id))
    throw new TypeError(
      "Package id must contain only lowercase letters, digits, dots and hyphens.",
    );
  if (
    typeof version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)
  )
    throw new TypeError("Package version must be a semantic version.");
  const packageRoot = path.resolve(outputRoot);
  const entryDirectory = path.join(packageRoot, "dist");
  const entryPath = path.join(entryDirectory, "index.js");
  const metadataPath = path.join(entryDirectory, "metadata.mjs");
  const sourcePath = path.resolve(source);
  if (
    sourcePath === packageRoot ||
    sourcePath.startsWith(packageRoot + path.sep)
  )
    throw new Error("Build output must not contain the indicator source.");
  const authoringRoot = await findAuthoringRoot(sourcePath);
  const compilerPlotDeclarations = await collectCompilerPlotDeclarations(
    sourcePath,
    authoringRoot,
  );
  const indicatorCompilerDefine = {
    ...indicatorCompilerBaseDefine,
    __ERC_INDICATOR_PLOT_DECLARATIONS__: JSON.stringify(
      compilerPlotDeclarations,
    ),
  };
  await rm(packageRoot, { recursive: true, force: true });
  await mkdir(entryDirectory, { recursive: true });
  await build({
    entryPoints: [sourcePath],
    outfile: entryPath,
    bundle: true,
    platform: "neutral",
    format: "esm",
    target: "es2022",
    minify: false,
    define: indicatorCompilerDefine,
    plugins: [indicatorAuthoringTransformPlugin({ sourceRoot: authoringRoot })],
  });
  await build({
    entryPoints: [sourcePath],
    outfile: metadataPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    minify: false,
    define: indicatorCompilerDefine,
    plugins: [indicatorAuthoringTransformPlugin({ sourceRoot: authoringRoot })],
  });
  const metadataModule = await import(
    `${pathToFileURL(metadataPath).href}?build=${Date.now()}`
  );
  const indicatorDefinition = metadataModule.default?.definition;
  if (indicatorDefinition === undefined) {
    throw new Error("Indicator definition could not be extracted.");
  }
  if (
    !isInstalledIndicatorDefinition(indicatorDefinition) ||
    !indicatorDefinition.id.startsWith(id + ".")
  )
    throw new Error(
      "Generated definition must be valid and belong to the package id.",
    );
  await rm(metadataPath, { force: true });
  const entry = await readFile(entryPath);
  const manifest = {
    manifestVersion: 1,
    id,
    kind: "indicator",
    name: name ?? indicatorDefinition.name,
    description:
      description ??
      indicatorDefinition.description ??
      indicatorDefinition.name,
    version,
    apiVersion: "^1.0.0",
    entry: "dist/index.js",
    authoringLanguage: "typescript",
    permissions: {
      network: [],
      credentials: [],
      storage: [],
    },
    capabilities: {
      indicatorDefinition,
    },
    integrity: {
      algorithm: "sha256",
      files: { "dist/index.js": sha256(entry) },
    },
  };
  await writeFile(
    path.join(packageRoot, "plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  const archivePath = await writePluginPackageArchive(packageRoot);
  return { packageRoot, archivePath, manifest };
}

const currentFile = fileURLToPath(import.meta.url);
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === currentFile
) {
  const [
    source,
    id,
    version = "0.1.0",
    outputRoot = path.resolve("out", "indicator-plugins", id ?? "indicator"),
  ] = process.argv.slice(2);
  if (source === undefined || id === undefined)
    throw new Error(
      "Usage: node tools/build-indicator-package.mjs <source.ts> <plugin-id> [version] [output-directory]",
    );
  const result = await buildIndicatorPackage({
    source,
    id,
    version,
    outputRoot,
  });
  console.log(`INDICATOR_PACKAGE ${result.packageRoot}`);
  console.log(`INDICATOR_PACKAGE_ZIP ${result.archivePath}`);
}
