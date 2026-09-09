import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ZIP_UTF8_FLAG = 0x0800;
const ZIP_VERSION = 20;

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

async function collectPackageFiles(packageRoot, relativeDirectory = "") {
  const directory = path.join(packageRoot, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Plugin packages cannot contain symbolic links: ${relativePath}`,
      );
    }
    if (entry.isDirectory()) {
      files.push(...(await collectPackageFiles(packageRoot, relativePath)));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported plugin package entry: ${relativePath}`);
    }
    files.push({
      name: relativePath.split(path.sep).join("/"),
      data: await readFile(path.join(packageRoot, relativePath)),
    });
  }
  return files;
}

function createStoredZip(files) {
  if (files.length > 0xffff) {
    throw new Error("Plugin package contains too many files for ZIP32.");
  }
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = file.data;
    if (name.length > 0xffff || data.length > 0xffffffff) {
      throw new Error(
        `Plugin package file is too large for ZIP32: ${file.name}`,
      );
    }
    const checksum = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(ZIP_VERSION, 4);
    local.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(ZIP_VERSION, 4);
    central.writeUInt16LE(ZIP_VERSION, 6);
    central.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  if (offset > 0xffffffff || centralDirectory.length > 0xffffffff) {
    throw new Error("Plugin package is too large for ZIP32.");
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export async function writePluginPackageArchive(packageRoot) {
  const resolvedPackageRoot = path.resolve(packageRoot);
  const archivePath = `${resolvedPackageRoot}.zip`;
  const files = await collectPackageFiles(resolvedPackageRoot);
  await writeFile(archivePath, createStoredZip(files));
  return archivePath;
}
