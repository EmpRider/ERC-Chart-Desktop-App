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

test(
  "rejects executable, native, Python, install-hook, and unsupported runtime extensions",
  () => {
    const forbiddenPaths = [
      "dist/helper.exe",
      "dist/native.node",
      "dist/native.DLL",
      "assets/setup.msi",
      "assets/install.ps1",
      "assets/install.cmd",
      "assets/helper.sh",
      "assets/provider.py",
      "assets/provider.pyd",
      "assets/module.wasm",
    ];

    for (const filePath of forbiddenPaths) {
      assert.throws(
        () => assertPluginPackageContentPolicy([stagedFile(filePath)]),
        /forbidden executable, native, Python, install-hook, or unsupported runtime file/i,
        filePath,
      );
    }
  },
);

test(
  "removes staged output when package content policy rejects a folder package",
  async () => {
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
        /forbidden executable/i,
      );
      assert.deepEqual(await readdir(stagingRoot), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
