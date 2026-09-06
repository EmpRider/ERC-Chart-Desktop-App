import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

export const atrRopeUtBotPackageIdentity = Object.freeze({
  id: "erc.indicator.atr-rope-utbot",
  name: "ATR Rope + UT Bot Unified",
  version: "0.1.2",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function buildAtrRopeUtBotIndicatorPackage({ root, outputRoot }) {
  const packageRoot = path.resolve(outputRoot);
  const entryDirectory = path.join(packageRoot, "dist");
  const entryPath = path.join(entryDirectory, "index.js");
  const metadataPath = path.join(entryDirectory, "metadata.mjs");
  await rm(packageRoot, { recursive: true, force: true });
  await mkdir(entryDirectory, { recursive: true });
  await build({
    entryPoints: [
      path.join(
        root,
        "packages",
        "indicator-examples",
        "src",
        "atr-rope-utbot.ts",
      ),
    ],
    outfile: entryPath,
    bundle: true,
    platform: "neutral",
    format: "esm",
    target: "es2022",
    minify: false,
  });
  await build({
    entryPoints: [
      path.join(
        root,
        "packages",
        "indicator-examples",
        "src",
        "atr-rope-utbot.ts",
      ),
    ],
    outfile: metadataPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    minify: false,
  });
  const metadataModule = await import(
    `${pathToFileURL(metadataPath).href}?build=${Date.now()}`
  );
  const indicatorDefinition = metadataModule.default?.definition;
  if (indicatorDefinition === undefined) {
    throw new Error("ATR Rope indicator definition could not be extracted.");
  }
  await rm(metadataPath, { force: true });
  const entry = await readFile(entryPath);
  const manifest = {
    manifestVersion: 1,
    id: atrRopeUtBotPackageIdentity.id,
    kind: "indicator",
    name: atrRopeUtBotPackageIdentity.name,
    description:
      "ATR Rope, UT Bot, follow signals, and rolling ADX POC migration converted from Signal to the ERC Chart Indicator SDK.",
    version: atrRopeUtBotPackageIdentity.version,
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
  return { packageRoot, manifest };
}

const currentFile = fileURLToPath(import.meta.url);
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === currentFile
) {
  const root = path.resolve(path.dirname(currentFile), "..");
  const result = await buildAtrRopeUtBotIndicatorPackage({
    root,
    outputRoot: path.join(root, "out", "indicator-plugins", "atr-rope-utbot"),
  });
  console.log(`ATR_ROPE_UTBOT_INDICATOR_PACKAGE ${result.packageRoot}`);
}
