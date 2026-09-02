import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installStagedPlugin, removeInstalledPlugin } from "../dist/index.js";
import { stagePluginPackage } from "../dist/plugin-staging.js";

function pluginManifest(version) {
  return {
    manifestVersion: 1,
    id: "fixture.provider",
    kind: "provider",
    name: "Fixture Provider",
    version,
    apiVersion: "^1.0.0",
    entry: "dist/index.js",
    authoringLanguage: "javascript",
    permissions: { network: [], credentials: [], storage: [] },
  };
}

async function createFolderFixture(root, version, contents) {
  const folder = path.join(root, `provider-${version.replaceAll(".", "-")}`);
  await mkdir(path.join(folder, "dist"), { recursive: true });
  await writeFile(
    path.join(folder, "plugin.json"),
    JSON.stringify(pluginManifest(version)),
  );
  await writeFile(path.join(folder, "dist", "index.js"), contents);
  return folder;
}

test("installs versioned plugins atomically and removes only the targeted version", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-install-"));
  try {
    const installationRoot = path.join(root, "installed");
    const stagingRoot = path.join(root, "staging");
    const sourceV1 = await createFolderFixture(
      root,
      "1.0.0",
      "export default 1;\n",
    );
    const sourceV2 = await createFolderFixture(
      root,
      "2.0.0+build.5",
      "export default 2;\n",
    );
    const stagedV1 = await stagePluginPackage(
      { kind: "folder", path: sourceV1 },
      { stagingRoot },
    );
    const installedV1 = await installStagedPlugin(stagedV1, {
      installationRoot,
    });
    await assert.rejects(stat(stagedV1.stagingPath), { code: "ENOENT" });
    assert.equal(
      await readFile(
        path.join(installedV1.installationPath, "dist", "index.js"),
        "utf8",
      ),
      "export default 1;\n",
    );

    const stagedV2 = await stagePluginPackage(
      { kind: "folder", path: sourceV2 },
      { stagingRoot },
    );
    await installStagedPlugin(stagedV2, { installationRoot });
    assert.deepEqual(
      await readdir(path.join(installationRoot, "fixture.provider")),
      ["1.0.0", "2.0.0+build.5"],
    );

    assert.equal(
      await removeInstalledPlugin(
        { installationRoot },
        "fixture.provider",
        "1.0.0",
      ),
      true,
    );
    assert.equal(
      await readFile(
        path.join(
          installationRoot,
          "fixture.provider",
          "2.0.0+build.5",
          "dist",
          "index.js",
        ),
        "utf8",
      ),
      "export default 2;\n",
    );
    assert.equal(
      await removeInstalledPlugin(
        { installationRoot },
        "fixture.provider",
        "1.0.0",
      ),
      false,
    );
    assert.equal(
      await removeInstalledPlugin(
        { installationRoot },
        "fixture.provider",
        "2.0.0+build.5",
      ),
      true,
    );
    await assert.rejects(
      stat(path.join(installationRoot, "fixture.provider")),
      {
        code: "ENOENT",
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects installation collisions without replacing the installed version", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-collision-"));
  try {
    const installationRoot = path.join(root, "installed");
    const stagingRoot = path.join(root, "staging");
    const firstSource = await createFolderFixture(
      root,
      "1.0.0",
      "export default 1;\n",
    );
    const first = await stagePluginPackage(
      { kind: "folder", path: firstSource },
      { stagingRoot },
    );
    await installStagedPlugin(first, { installationRoot });

    await rm(firstSource, { recursive: true, force: true });
    const replacementSource = await createFolderFixture(
      root,
      "1.0.0",
      "export default 'replacement';\n",
    );
    const replacement = await stagePluginPackage(
      { kind: "folder", path: replacementSource },
      { stagingRoot },
    );
    await assert.rejects(
      installStagedPlugin(replacement, { installationRoot }),
      /already installed/,
    );
    await assert.rejects(stat(replacement.stagingPath), { code: "ENOENT" });
    assert.equal(
      await readFile(
        path.join(
          installationRoot,
          "fixture.provider",
          "1.0.0",
          "dist",
          "index.js",
        ),
        "utf8",
      ),
      "export default 1;\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
