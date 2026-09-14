import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { isInstalledIndicatorDefinition } from "../packages/contracts/dist/index.js";
import { indicatorAuthoringTransformPlugin } from "./indicator-authoring-transform.mjs";
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

function emittedPlotCallsiteIds(outputFiles) {
  const code = outputFiles.map((file) => file.text).join("\n");
  const callsiteTokens = new Map();
  const callsitePattern =
    /([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*Object\.freeze\(\{\s*__ercCallsite:\s*"v2",\s*id:\s*"([^"]+)",\s*kind:\s*"plot"/gu;
  for (const match of code.matchAll(callsitePattern)) {
    const token = match[1];
    const id = match[2];
    if (token !== undefined && id !== undefined) callsiteTokens.set(token, id);
  }

  const references = new Map(
    [...callsiteTokens.keys()].map((token) => [token, 0]),
  );
  for (const match of code.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/gu)) {
    const token = match[0];
    const count = references.get(token);
    if (count !== undefined) references.set(token, count + 1);
  }

  const emitted = new Set();
  for (const [token, id] of callsiteTokens) {
    if ((references.get(token) ?? 0) > 1) emitted.add(id);
  }
  return emitted;
}

function authoringTransformContext(sourceRoot) {
  const plotDeclarationsByInput = new Map();
  const authoringTransform = indicatorAuthoringTransformPlugin({
    sourceRoot,
    onTransform({ fileName, plotDeclarations }) {
      plotDeclarationsByInput.set(fileName, plotDeclarations);
    },
  });
  return { authoringTransform, plotDeclarationsByInput };
}

async function collectCompilerPlotDeclarations(
  sourcePath,
  authoringTransform,
  plotDeclarationsByInput,
  { platform, target },
) {
  const prebuild = await build({
    entryPoints: [sourcePath],
    bundle: true,
    write: false,
    platform,
    format: "esm",
    target,
    minify: false,
    define: {
      ...indicatorCompilerBaseDefine,
      __ERC_INDICATOR_PLOT_DECLARATIONS__: "[]",
    },
    plugins: [authoringTransform],
  });

  const emittedCallsites = emittedPlotCallsiteIds(prebuild.outputFiles);
  const byId = new Map();
  for (const declarations of plotDeclarationsByInput.values()) {
    for (const declaration of declarations) {
      if (!emittedCallsites.has(declaration.id)) continue;
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

function indicatorCompilerDefine(plotDeclarations) {
  return {
    ...indicatorCompilerBaseDefine,
    __ERC_INDICATOR_PLOT_DECLARATIONS__: JSON.stringify(plotDeclarations),
  };
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
  const entryTransform = authoringTransformContext(authoringRoot);
  const metadataTransform = authoringTransformContext(authoringRoot);
  const plotDeclarations = await collectCompilerPlotDeclarations(
    sourcePath,
    entryTransform.authoringTransform,
    entryTransform.plotDeclarationsByInput,
    { platform: "neutral", target: "es2022" },
  );
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
    define: indicatorCompilerDefine(plotDeclarations),
    plugins: [entryTransform.authoringTransform],
  });
  await build({
    entryPoints: [sourcePath],
    outfile: metadataPath,
    bundle: true,
    platform: "neutral",
    format: "esm",
    target: "es2022",
    minify: false,
    define: indicatorCompilerDefine(plotDeclarations),
    plugins: [metadataTransform.authoringTransform],
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
