import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const binomoProviderPackageIdentity = Object.freeze({
  id: "erc.provider.binomo",
  name: "Binomo",
  version: "0.1.0",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function buildBinomoProviderPackage({ root, outputRoot }) {
  const sourceEntry = path.join(
    root,
    "packages",
    "provider-examples",
    "dist",
    "binomo-provider.js",
  );
  const entry = await readFile(sourceEntry);
  const packageRoot = path.resolve(outputRoot);
  const entryDirectory = path.join(packageRoot, "dist");
  await rm(packageRoot, { recursive: true, force: true });
  await mkdir(entryDirectory, { recursive: true });
  await copyFile(sourceEntry, path.join(entryDirectory, "index.js"));

  const manifest = {
    manifestVersion: 1,
    id: binomoProviderPackageIdentity.id,
    kind: "provider",
    name: binomoProviderPackageIdentity.name,
    description:
      "Binomo candle provider migrated from the Signal userscript to the public ERC Chart Provider SDK.",
    version: binomoProviderPackageIdentity.version,
    apiVersion: "^1.0.0",
    entry: "dist/index.js",
    authoringLanguage: "typescript",
    permissions: {
      network: [
        "https://api.binomo.com/",
        "wss://as.binomo.com/",
        "wss://ws.binomo.com/",
      ],
      credentials: ["binomo_cookie"],
      storage: [],
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
  const result = await buildBinomoProviderPackage({
    root,
    outputRoot: path.join(root, "out", "provider-plugins", "binomo-provider"),
  });
  console.log(`BINOMO_PROVIDER_PACKAGE ${result.packageRoot}`);
}
