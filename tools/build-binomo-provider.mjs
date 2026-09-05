import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const binomoProviderPackageIdentity = Object.freeze({
  id: "erc.provider.binomo",
  name: "Binomo",
  version: "0.1.1",
});

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(value);
    const checksum = crc32(data);
    const flags = 0x0800;
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }

  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, eocd]);
}

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
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(packageRoot, "plugin.json"), manifestText, "utf8");

  const archivePath = `${packageRoot}.zip`;
  await rm(archivePath, { force: true });
  await writeFile(
    archivePath,
    makeStoredZip([
      ["plugin.json", manifestText],
      ["dist/index.js", entry],
    ]),
  );
  return { packageRoot, archivePath, manifest };
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
  console.log(`BINOMO_PROVIDER_ARCHIVE ${result.archivePath}`);
}
