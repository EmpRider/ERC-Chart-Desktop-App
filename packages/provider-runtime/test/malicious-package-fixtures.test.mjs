import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stagePluginPackage } from "../dist/index.js";

const entryContents = "export default {};\n";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pluginManifest({ entryHash = sha256(entryContents) } = {}) {
  return {
    manifestVersion: 1,
    id: "fixture.provider",
    kind: "provider",
    name: "Malicious Fixture Provider",
    version: "1.0.0",
    apiVersion: "^1.0.0",
    entry: "dist/index.js",
    authoringLanguage: "javascript",
    permissions: { network: [], credentials: [], storage: [] },
    integrity: {
      algorithm: "sha256",
      files: { "dist/index.js": entryHash },
    },
  };
}

function makeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, value, metadata = {}] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(value);
    const flags = metadata.flags ?? 0x0800;
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
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
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(metadata.externalAttributes ?? 0, 38);
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

async function createFolderPackage(root, manifest, extraFiles = []) {
  const source = await mkdtemp(path.join(root, "provider-"));
  await mkdir(path.join(source, "dist"), { recursive: true });
  await writeFile(path.join(source, "plugin.json"), JSON.stringify(manifest));
  await writeFile(path.join(source, "dist", "index.js"), entryContents);
  for (const [relativePath, contents] of extraFiles) {
    const absolutePath = path.join(source, ...relativePath.split("/"));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents);
  }
  return source;
}

test("rejects representative malicious package fixtures through the public staging boundary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-malicious-"));
  const stagingRoot = path.join(root, "staging");
  const developerTrust = { mode: "developer", trustedPublisherKeys: {} };
  const productionTrust = { mode: "production", trustedPublisherKeys: {} };

  try {
    const traversalZip = path.join(root, "traversal.zip");
    await writeFile(
      traversalZip,
      makeStoredZip([
        ["plugin.json", JSON.stringify(pluginManifest())],
        ["../escape.js", entryContents],
      ]),
    );
    await assert.rejects(
      stagePluginPackage(
        { kind: "zip", path: traversalZip },
        { stagingRoot, trustPolicy: developerTrust },
      ),
      /invalid path/i,
    );
    assert.deepEqual(await readdir(stagingRoot), []);

    const symlinkZip = path.join(root, "symlink.zip");
    await writeFile(
      symlinkZip,
      makeStoredZip([
        ["plugin.json", JSON.stringify(pluginManifest())],
        ["dist/index.js", "target", { externalAttributes: 0xa1ff0000 }],
      ]),
    );
    await assert.rejects(
      stagePluginPackage(
        { kind: "zip", path: symlinkZip },
        { stagingRoot, trustPolicy: developerTrust },
      ),
      /symbolic link/i,
    );
    assert.deepEqual(await readdir(stagingRoot), []);

    const executableSource = await createFolderPackage(root, pluginManifest(), [
      ["assets/payload.exe", "not-an-executable"],
      ["dist/native.node", "not-a-native-module"],
    ]);
    await assert.rejects(
      stagePluginPackage(
        { kind: "folder", path: executableSource },
        { stagingRoot, trustPolicy: developerTrust },
      ),
      /outside the approved .* allowlist/i,
    );
    assert.deepEqual(await readdir(stagingRoot), []);

    const tamperedSource = await createFolderPackage(
      root,
      pluginManifest({ entryHash: sha256("different contents") }),
    );
    await assert.rejects(
      stagePluginPackage(
        { kind: "folder", path: tamperedSource },
        { stagingRoot, trustPolicy: developerTrust },
      ),
      /integrity check failed/i,
    );
    assert.deepEqual(await readdir(stagingRoot), []);

    const unsignedProductionSource = await createFolderPackage(
      root,
      pluginManifest(),
    );
    await assert.rejects(
      stagePluginPackage(
        { kind: "folder", path: unsignedProductionSource },
        { stagingRoot, trustPolicy: productionTrust },
      ),
      /Production Mode requires a trusted signed plugin package/i,
    );
    assert.deepEqual(await readdir(stagingRoot), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
