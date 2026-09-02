import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { inflateRaw } from "node:zlib";
import {
  inspectPluginManifest,
  type ContractVersion,
  type PluginManifest,
} from "@erc-chart/contracts";

export interface PluginPackageLimits {
  readonly maximumArchiveBytes: number;
  readonly maximumExpandedBytes: number;
  readonly maximumFileBytes: number;
  readonly maximumFiles: number;
  readonly maximumPathLength: number;
}

export const defaultPluginPackageLimits: PluginPackageLimits = Object.freeze({
  maximumArchiveBytes: 64 * 1024 * 1024,
  maximumExpandedBytes: 128 * 1024 * 1024,
  maximumFileBytes: 32 * 1024 * 1024,
  maximumFiles: 4096,
  maximumPathLength: 240,
});

export type PluginPackageSource =
  | { readonly kind: "folder"; readonly path: string }
  | { readonly kind: "zip"; readonly path: string };

export interface PluginStagingOptions {
  readonly stagingRoot: string;
  readonly currentHostApiVersion?: ContractVersion;
  readonly limits?: Partial<PluginPackageLimits>;
}

export interface StagedPluginFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export interface StagedPluginPackage {
  readonly stagingPath: string;
  readonly sourceKind: PluginPackageSource["kind"];
  readonly manifest: PluginManifest;
  readonly files: readonly StagedPluginFile[];
  readonly packageHash: string;
}

interface ZipEntry {
  readonly path: string;
  readonly data: Buffer;
  readonly directory: boolean;
}

const localFileHeaderSignature = 0x04034b50;
const centralDirectoryHeaderSignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;
const utf8Flag = 0x0800;
const encryptedFlag = 0x0001;
const windowsReservedDeviceName =
  /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/iu;

function hasWindowsInvalidSegmentCharacters(value: string): boolean {
  return Array.from(value).some(
    (character) =>
      character.charCodeAt(0) < 32 || '<>:"|?*'.includes(character),
  );
}

function resolvedLimits(
  override: Partial<PluginPackageLimits> | undefined,
): PluginPackageLimits {
  const limits = { ...defaultPluginPackageLimits, ...override };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  return limits;
}

function normalizePackagePath(
  value: string,
  limits: PluginPackageLimits,
): string {
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.length > limits.maximumPathLength ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.includes("\0")
  ) {
    throw new Error("Plugin package contains an invalid path.");
  }
  const segments = normalized
    .split("/")
    .filter((segment) => segment.length > 0);
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        hasWindowsInvalidSegmentCharacters(segment) ||
        /[ .]$/u.test(segment) ||
        windowsReservedDeviceName.test(segment),
    )
  ) {
    throw new Error("Plugin package contains an invalid path.");
  }
  return segments.join("/");
}

function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function pathsOverlap(left: string, right: string): Promise<boolean> {
  const [resolvedLeft, resolvedRight] = await Promise.all([
    realpath(left),
    realpath(right),
  ]);
  return (
    pathContains(resolvedLeft, resolvedRight) ||
    pathContains(resolvedRight, resolvedLeft)
  );
}

async function readHandleBounded(
  handle: FileHandle,
  initialSize: number,
  maximumBytes: number,
  errorMessage: string,
): Promise<Buffer> {
  if (initialSize > maximumBytes) throw new Error(errorMessage);

  const initial = Buffer.allocUnsafe(initialSize);
  let totalBytes = 0;
  while (totalBytes < initialSize) {
    const { bytesRead } = await handle.read(
      initial,
      totalBytes,
      initialSize - totalBytes,
      null,
    );
    if (bytesRead === 0) return initial.subarray(0, totalBytes);
    totalBytes += bytesRead;
  }

  const chunks: Buffer[] = [initial];
  while (true) {
    const remaining = maximumBytes - totalBytes;
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining + 1));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    totalBytes += bytesRead;
    if (totalBytes > maximumBytes) throw new Error(errorMessage);
    chunks.push(chunk.subarray(0, bytesRead));
  }

  return chunks.length === 1 ? initial : Buffer.concat(chunks, totalBytes);
}

function containedPath(root: string, relativePath: string): string {
  const destination = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(path.resolve(root), destination);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Plugin package path escapes the staging directory.");
  }
  return destination;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === endOfCentralDirectorySignature) {
      return offset;
    }
  }
  throw new Error("Plugin ZIP is missing its central directory.");
}

function inflateRawAsync(
  compressed: Buffer,
  maximumFileBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    inflateRaw(
      compressed,
      { maxOutputLength: maximumFileBytes },
      (error, result) => {
        if (error !== null) reject(error);
        else resolve(result);
      },
    );
  });
}

async function* readZipEntries(
  archive: Buffer,
  limits: PluginPackageLimits,
): AsyncGenerator<ZipEntry, void, void> {
  const eocd = findEndOfCentralDirectory(archive);
  const diskNumber = archive.readUInt16LE(eocd + 4);
  const directoryDisk = archive.readUInt16LE(eocd + 6);
  const entriesOnDisk = archive.readUInt16LE(eocd + 8);
  const entryCount = archive.readUInt16LE(eocd + 10);
  const directorySize = archive.readUInt32LE(eocd + 12);
  const directoryOffset = archive.readUInt32LE(eocd + 16);
  if (
    diskNumber !== 0 ||
    directoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new Error(
      "Plugin ZIP uses an unsupported multi-disk or ZIP64 layout.",
    );
  }
  if (entryCount > limits.maximumFiles) {
    throw new Error("Plugin package contains too many files.");
  }
  if (directoryOffset + directorySize > eocd || directoryOffset < 0) {
    throw new Error("Plugin ZIP central directory is malformed.");
  }

  const seen = new Set<string>();
  let expandedBytes = 0;
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + 46 > archive.length ||
      archive.readUInt32LE(cursor) !== centralDirectoryHeaderSignature
    ) {
      throw new Error("Plugin ZIP central directory entry is malformed.");
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const compressionMethod = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const fileNameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const localHeaderOffset = archive.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + fileNameLength;
    if (
      nameEnd + extraLength + commentLength > archive.length ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new Error("Plugin ZIP entry metadata is malformed.");
    }
    if ((flags & encryptedFlag) !== 0) {
      throw new Error("Encrypted plugin ZIP entries are not supported.");
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error("Plugin ZIP contains an unsupported compression method.");
    }
    if ((flags & utf8Flag) === 0) {
      throw new Error("Plugin ZIP entry names must use UTF-8 encoding.");
    }
    const rawName = archive.subarray(nameStart, nameEnd).toString("utf8");
    const directory = rawName.endsWith("/") || rawName.endsWith("\\");
    const entryPath = normalizePackagePath(rawName, limits);
    const duplicateKey = entryPath.toLocaleLowerCase("en-US");
    if (seen.has(duplicateKey)) {
      throw new Error("Plugin ZIP contains duplicate normalized paths.");
    }
    seen.add(duplicateKey);

    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0o170000) === 0o120000) {
      throw new Error("Plugin ZIP contains a symbolic link.");
    }
    if (directory) {
      yield { path: entryPath, data: Buffer.alloc(0), directory: true };
      cursor = nameEnd + extraLength + commentLength;
      continue;
    }
    if (uncompressedSize > limits.maximumFileBytes) {
      throw new Error("Plugin package contains an oversized file.");
    }
    expandedBytes += uncompressedSize;
    if (expandedBytes > limits.maximumExpandedBytes) {
      throw new Error("Plugin package expands beyond the allowed size.");
    }
    if (
      localHeaderOffset + 30 > archive.length ||
      archive.readUInt32LE(localHeaderOffset) !== localFileHeaderSignature
    ) {
      throw new Error("Plugin ZIP local file header is malformed.");
    }
    const localNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const dataStart =
      localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataStart > archive.length || dataEnd > archive.length) {
      throw new Error("Plugin ZIP file data is truncated.");
    }
    const compressed = archive.subarray(dataStart, dataEnd);
    const data =
      compressionMethod === 0
        ? compressed
        : await inflateRawAsync(compressed, limits.maximumFileBytes);
    if (data.length !== uncompressedSize) {
      throw new Error("Plugin ZIP entry size does not match its metadata.");
    }
    yield { path: entryPath, data, directory: false };
    cursor = nameEnd + extraLength + commentLength;
  }
  if (cursor !== directoryOffset + directorySize) {
    throw new Error(
      "Plugin ZIP central directory size does not match its entries.",
    );
  }
}

async function copyFolderIntoStaging(
  sourceRoot: string,
  stagingPath: string,
  limits: PluginPackageLimits,
): Promise<void> {
  const source = path.resolve(sourceRoot);
  const sourceInfo = await stat(source);
  if (!sourceInfo.isDirectory()) {
    throw new Error("Plugin folder source must be a directory.");
  }
  let fileCount = 0;
  let totalBytes = 0;

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path
        .relative(source, absolute)
        .replaceAll(path.sep, "/");
      const packagePath = normalizePackagePath(relative, limits);
      if (entry.isSymbolicLink()) {
        throw new Error("Plugin folder contains a symbolic link.");
      }
      if (entry.isDirectory()) {
        await mkdir(containedPath(stagingPath, packagePath), {
          recursive: true,
        });
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(
          "Plugin folder contains an unsupported filesystem entry.",
        );
      }
      const sourceHandle = await open(absolute, "r");
      try {
        const info = await sourceHandle.stat();
        if (!info.isFile()) {
          throw new Error(
            "Plugin folder contains an unsupported filesystem entry.",
          );
        }
        fileCount += 1;
        if (fileCount > limits.maximumFiles) {
          throw new Error("Plugin folder exceeds staging limits.");
        }
        const remainingExpandedBytes = limits.maximumExpandedBytes - totalBytes;
        const data = await readHandleBounded(
          sourceHandle,
          info.size,
          Math.min(limits.maximumFileBytes, remainingExpandedBytes),
          "Plugin folder exceeds staging limits.",
        );
        totalBytes += data.length;
        const destination = containedPath(stagingPath, packagePath);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, data, { flag: "wx" });
      } finally {
        await sourceHandle.close();
      }
    }
  };

  await visit(source);
}

async function extractZipIntoStaging(
  sourcePath: string,
  stagingPath: string,
  limits: PluginPackageLimits,
): Promise<void> {
  const sourceHandle = await open(sourcePath, "r");
  let archive: Buffer;
  try {
    const info = await sourceHandle.stat();
    if (!info.isFile()) throw new Error("Plugin ZIP source must be a file.");
    archive = await readHandleBounded(
      sourceHandle,
      info.size,
      limits.maximumArchiveBytes,
      "Plugin ZIP exceeds the archive size limit.",
    );
  } finally {
    await sourceHandle.close();
  }
  for await (const entry of readZipEntries(archive, limits)) {
    const destination = containedPath(stagingPath, entry.path);
    if (entry.directory) {
      await mkdir(destination, { recursive: true });
      continue;
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, entry.data, { flag: "wx" });
  }
}

async function collectStagedFiles(
  stagingPath: string,
  limits: PluginPackageLimits,
): Promise<readonly StagedPluginFile[]> {
  const files: StagedPluginFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path
        .relative(stagingPath, absolute)
        .replaceAll(path.sep, "/");
      const packagePath = normalizePackagePath(relative, limits);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error("Plugin staging directory contains an invalid entry.");
      }
      const data = await readFile(absolute);
      files.push({
        path: packagePath,
        size: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
      });
    }
  };
  await visit(stagingPath);
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

function packageHash(files: readonly StagedPluginFile[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path, "utf8");
    hash.update("\0", "utf8");
    hash.update(file.sha256, "ascii");
    hash.update("\n", "utf8");
  }
  return hash.digest("hex");
}

async function validateStagedPackage(
  stagingPath: string,
  options: PluginStagingOptions,
  limits: PluginPackageLimits,
  sourceKind: PluginPackageSource["kind"],
): Promise<StagedPluginPackage> {
  const manifestPath = containedPath(stagingPath, "plugin.json");
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error("Plugin package must contain a valid plugin.json.", {
      cause: error,
    });
  }
  const report = inspectPluginManifest(
    manifestValue,
    options.currentHostApiVersion,
  );
  if (!report.ok) {
    const [first] = report.violations;
    throw new Error(
      first === undefined
        ? "Plugin manifest is invalid."
        : `${first.code}: ${first.path}: ${first.message}`,
    );
  }
  const manifest = manifestValue as PluginManifest;
  try {
    const entryInfo = await stat(containedPath(stagingPath, manifest.entry));
    if (!entryInfo.isFile()) throw new Error();
  } catch (error) {
    throw new Error("Plugin manifest entry file is missing.", { cause: error });
  }
  const files = await collectStagedFiles(stagingPath, limits);
  if (files.length === 0) throw new Error("Plugin package is empty.");
  return {
    stagingPath,
    sourceKind,
    manifest,
    files,
    packageHash: packageHash(files),
  };
}

export async function stagePluginPackage(
  source: PluginPackageSource,
  options: PluginStagingOptions,
): Promise<StagedPluginPackage> {
  if (options.stagingRoot.trim() === "") {
    throw new RangeError("Plugin staging root is required.");
  }
  const limits = resolvedLimits(options.limits);
  await mkdir(options.stagingRoot, { recursive: true });
  if (
    source.kind === "folder" &&
    (await pathsOverlap(source.path, options.stagingRoot))
  ) {
    throw new Error("Plugin folder source overlaps the staging directory.");
  }
  const stagingPath = await mkdtemp(path.join(options.stagingRoot, "plugin-"));
  let complete = false;
  try {
    if (source.kind === "folder") {
      await copyFolderIntoStaging(source.path, stagingPath, limits);
    } else if (source.kind === "zip") {
      await extractZipIntoStaging(source.path, stagingPath, limits);
    } else {
      throw new Error("Plugin source type is unsupported.");
    }
    const result = await validateStagedPackage(
      stagingPath,
      options,
      limits,
      source.kind,
    );
    complete = true;
    return result;
  } finally {
    if (!complete) await rm(stagingPath, { recursive: true, force: true });
  }
}

export async function discardStagedPlugin(
  staged: StagedPluginPackage,
): Promise<void> {
  await rm(staged.stagingPath, { recursive: true, force: true });
}
