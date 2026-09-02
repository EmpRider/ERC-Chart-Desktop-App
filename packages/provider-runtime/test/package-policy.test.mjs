import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stagePluginPackage } from "../dist/index.js";
import { assertPluginPackageContentPolicy } from "../dist/package-policy.js";

function stagedFile(filePath) {
  return {
    path: filePath,
    size: 1,
    sha256: "0".repeat(64),
  };
}

function pluginManifest() {
  return {
    manifestVersion: 1,
    id: "fixture.provider",
    kind: "provider",
    name: "Fixture Provider",
    version: "1.0.0",
    apiVersion: "^1.0.0",
    entry: "dist/index.js",
    authoringLanguage: "javascript",
    permissions: { network: [], credentials: [], storage: [] },
  };
}

function makeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(value);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
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
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
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

test("allows the documented provider package layout and static assets", () => {
  assert.doesNotThrow(() =>
    assertPluginPackageContentPolicy([
      stagedFile("plugin.json"),
      stagedFile("dist/index.js"),
      stagedFile("dist/chunk.mjs"),
      stagedFile("assets/icon.png"),
      stagedFile("assets/metadata.json"),
      stagedFile("LICENSE"),
    ]),
  );
});

test("rejects files outside the approved package allowlist", () => {
  const forbiddenPaths = [
    "dist/helper.exe",
    "dist/native.node",
    "dist/native.DLL",
    "dist/helper.rb",
    "dist/source.ts",
    "assets/setup.msi",
    "assets/install.ps1",
    "assets/install.cmd",
    "assets/helper.sh",
    "assets/provider.py",
    "assets/provider.pyd",
    "assets/module.wasm",
    "assets/helper.rb",
    "README.md",
  ];

  for (const filePath of forbiddenPaths) {
    assert.throws(
      () => assertPluginPackageContentPolicy([stagedFile(filePath)]),
      /outside the approved .* allowlist/i,
      filePath,
    );
  }
});

test("removes staged output when package content policy rejects a folder package", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-policy-"));
  const source = path.join(root, "provider-folder");
  const stagingRoot = path.join(root, "staging");
  try {
    await mkdir(path.join(source, "dist"), { recursive: true });
    await mkdir(path.join(source, "assets"), { recursive: true });
    await writeFile(
      path.join(source, "plugin.json"),
      JSON.stringify(pluginManifest()),
    );
    await writeFile(
      path.join(source, "dist", "index.js"),
      "export default {};\n",
    );
    await writeFile(
      path.join(source, "assets", "payload.exe"),
      "not-an-executable",
    );

    await assert.rejects(
      stagePluginPackage({ kind: "folder", path: source }, { stagingRoot }),
      /outside the approved .* allowlist/i,
    );
    assert.deepEqual(await readdir(stagingRoot), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removes staged output when package content policy rejects a ZIP package", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "erc-provider-policy-zip-"),
  );
  const archivePath = path.join(root, "provider.zip");
  const stagingRoot = path.join(root, "staging");
  try {
    await writeFile(
      archivePath,
      makeStoredZip([
        ["plugin.json", JSON.stringify(pluginManifest())],
        ["dist/index.js", "export default {};\n"],
        ["assets/payload.exe", "not-an-executable"],
      ]),
    );

    await assert.rejects(
      stagePluginPackage({ kind: "zip", path: archivePath }, { stagingRoot }),
      /outside the approved .* allowlist/i,
    );
    assert.deepEqual(await readdir(stagingRoot), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
