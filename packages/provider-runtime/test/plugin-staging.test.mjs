import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discardStagedPlugin,
  moveStagedPlugin,
  stagePluginPackage,
} from "../dist/index.js";

function pluginManifest(entry = "dist/index.js") {
  return {
    manifestVersion: 1,
    id: "fixture.provider",
    kind: "provider",
    name: "Fixture Provider",
    version: "1.0.0",
    apiVersion: "^1.0.0",
    entry,
    authoringLanguage: "javascript",
    permissions: { network: [], credentials: [], storage: [] },
  };
}

async function createFolderFixture(root) {
  const folder = path.join(root, "provider-folder");
  await mkdir(path.join(folder, "dist"), { recursive: true });
  await writeFile(
    path.join(folder, "plugin.json"),
    JSON.stringify(pluginManifest()),
  );
  await writeFile(
    path.join(folder, "dist", "index.js"),
    "export default {};\n",
  );
  return folder;
}

function makeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, value, metadata = {}] of entries) {
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

test("stages a provider folder into a controlled temporary directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-stage-"));
  try {
    const source = await createFolderFixture(root);
    const staged = await stagePluginPackage(
      { kind: "folder", path: source },
      { stagingRoot: path.join(root, "staging") },
    );

    assert.equal(staged.sourceKind, "folder");
    assert.equal(staged.manifest.id, "fixture.provider");
    assert.deepEqual(
      staged.files.map((file) => file.path),
      ["dist/index.js", "plugin.json"],
    );
    assert.match(staged.packageHash, /^[a-f0-9]{64}$/);
    assert.equal(
      await readFile(path.join(staged.stagingPath, "dist", "index.js"), "utf8"),
      "export default {};\n",
    );
    await discardStagedPlugin(staged);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stages a ZIP package and validates plugin.json plus its entry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-zip-"));
  try {
    const archivePath = path.join(root, "provider.zip");
    await writeFile(
      archivePath,
      makeStoredZip([
        ["plugin.json", JSON.stringify(pluginManifest())],
        ["dist/index.js", "export default {};\n"],
      ]),
    );
    const staged = await stagePluginPackage(
      { kind: "zip", path: archivePath },
      { stagingRoot: path.join(root, "staging") },
    );

    assert.equal(staged.sourceKind, "zip");
    assert.equal(staged.manifest.entry, "dist/index.js");
    await discardStagedPlugin(staged);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects traversal, symlink, duplicate, and oversized ZIP entries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-zip-bad-"));
  const stagingRoot = path.join(root, "staging");
  const cases = [
    {
      name: "traversal",
      entries: [
        ["plugin.json", JSON.stringify(pluginManifest())],
        ["../escape.js", "export default {};\n"],
      ],
      options: {},
      pattern: /invalid path/i,
    },
    {
      name: "symlink",
      entries: [
        ["plugin.json", JSON.stringify(pluginManifest())],
        ["dist/index.js", "target", { externalAttributes: 0xa1ff0000 }],
      ],
      options: {},
      pattern: /symbolic link/i,
    },
    {
      name: "duplicate normalized path",
      entries: [
        ["plugin.json", JSON.stringify(pluginManifest())],
        ["dist/index.js", "export default {};\n"],
        ["DIST/INDEX.JS", "export default {};\n"],
      ],
      options: {},
      pattern: /duplicate normalized paths/i,
    },
    {
      name: "oversized file",
      entries: [
        ["plugin.json", JSON.stringify(pluginManifest())],
        ["dist/index.js", Buffer.alloc(1024, "x")],
      ],
      options: { limits: { maximumFileBytes: 512 } },
      pattern: /oversized file/i,
    },
  ];

  try {
    for (const fixture of cases) {
      const archivePath = path.join(root, `${fixture.name}.zip`);
      await writeFile(archivePath, makeStoredZip(fixture.entries));
      await assert.rejects(
        stagePluginPackage(
          { kind: "zip", path: archivePath },
          { stagingRoot, ...fixture.options },
        ),
        fixture.pattern,
        fixture.name,
      );
      assert.deepEqual(await readdir(stagingRoot), [], fixture.name);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removes failed staging directories when the manifest or entry is invalid", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-invalid-"));
  try {
    const source = path.join(root, "provider-folder");
    await mkdir(source, { recursive: true });
    await writeFile(
      path.join(source, "plugin.json"),
      JSON.stringify(pluginManifest("dist/missing.js")),
    );
    await assert.rejects(
      stagePluginPackage(
        { kind: "folder", path: source },
        { stagingRoot: path.join(root, "staging") },
      ),
      /entry file is missing/i,
    );
    assert.deepEqual(await readdir(path.join(root, "staging")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("moves staged packages only into a destination that does not exist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-move-"));
  try {
    const source = await createFolderFixture(root);
    const staged = await stagePluginPackage(
      { kind: "folder", path: source },
      { stagingRoot: path.join(root, "staging") },
    );
    const occupied = path.join(root, "installed", "occupied");
    await mkdir(occupied, { recursive: true });
    await assert.rejects(
      moveStagedPlugin(staged, occupied),
      /destination must not already exist/i,
    );

    const destination = path.join(root, "installed", "1.0.0");
    await moveStagedPlugin(staged, destination);
    assert.equal(
      await readFile(path.join(destination, "dist", "index.js"), "utf8"),
      "export default {};\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
