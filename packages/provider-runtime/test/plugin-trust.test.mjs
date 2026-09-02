import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createPluginSignaturePayload,
  discardStagedPlugin,
  stagePluginPackage,
} from "../dist/index.js";

const entryContents = "export default {};\n";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
    integrity: {
      algorithm: "sha256",
      files: { "dist/index.js": sha256(entryContents) },
    },
  };
}

async function createFolderFixture(root, manifest, entry = entryContents) {
  const source = path.join(root, "provider-folder");
  await mkdir(path.join(source, "dist"), { recursive: true });
  await writeFile(path.join(source, "plugin.json"), JSON.stringify(manifest));
  await writeFile(path.join(source, "dist", "index.js"), entry);
  return source;
}

function signedManifest(privateKey, keyId = "publisher-1") {
  const manifest = pluginManifest();
  const value = sign(
    null,
    createPluginSignaturePayload(manifest),
    privateKey,
  ).toString("base64");
  return {
    ...manifest,
    signature: { algorithm: "ed25519", publisherKeyId: keyId, value },
  };
}

test("Developer Mode explicitly allows an unsigned package with valid integrity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-dev-trust-"));
  try {
    const source = await createFolderFixture(root, pluginManifest());
    const staged = await stagePluginPackage(
      { kind: "folder", path: source },
      {
        stagingRoot: path.join(root, "staging"),
        trustPolicy: { mode: "developer", trustedPublisherKeys: {} },
      },
    );
    assert.equal(staged.manifest.signature, undefined);
    await discardStagedPlugin(staged);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Production Mode rejects unsigned packages and removes staged output", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "erc-provider-prod-trust-"),
  );
  const stagingRoot = path.join(root, "staging");
  try {
    const source = await createFolderFixture(root, pluginManifest());
    await assert.rejects(
      stagePluginPackage(
        { kind: "folder", path: source },
        {
          stagingRoot,
          trustPolicy: { mode: "production", trustedPublisherKeys: {} },
        },
      ),
      /Production Mode requires a trusted signed plugin package/i,
    );
    assert.deepEqual(await readdir(stagingRoot), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Production Mode accepts a package signed by a configured Ed25519 publisher", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-signed-"));
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const manifest = signedManifest(privateKey);
    const source = await createFolderFixture(root, manifest);
    const staged = await stagePluginPackage(
      { kind: "folder", path: source },
      {
        stagingRoot: path.join(root, "staging"),
        trustPolicy: {
          mode: "production",
          trustedPublisherKeys: {
            "publisher-1": publicKey.export({ type: "spki", format: "pem" }),
          },
        },
      },
    );
    assert.equal(staged.manifest.signature?.publisherKeyId, "publisher-1");
    await discardStagedPlugin(staged);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects content that does not match the declared integrity metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-integrity-"));
  try {
    const source = await createFolderFixture(
      root,
      pluginManifest(),
      "export default { tampered: true };\n",
    );
    await assert.rejects(
      stagePluginPackage(
        { kind: "folder", path: source },
        {
          stagingRoot: path.join(root, "staging"),
          trustPolicy: { mode: "developer", trustedPublisherKeys: {} },
        },
      ),
      /integrity check failed/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects signed packages from an untrusted publisher key", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-untrusted-"));
  try {
    const { privateKey } = generateKeyPairSync("ed25519");
    const source = await createFolderFixture(root, signedManifest(privateKey));
    await assert.rejects(
      stagePluginPackage(
        { kind: "folder", path: source },
        {
          stagingRoot: path.join(root, "staging"),
          trustPolicy: { mode: "production", trustedPublisherKeys: {} },
        },
      ),
      /publisher key is not trusted/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a signature that no longer matches the manifest", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "erc-provider-bad-signature-"),
  );
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signed = signedManifest(privateKey);
    const manifest = { ...signed, name: "Tampered Provider" };
    const source = await createFolderFixture(root, manifest);
    await assert.rejects(
      stagePluginPackage(
        { kind: "folder", path: source },
        {
          stagingRoot: path.join(root, "staging"),
          trustPolicy: {
            mode: "production",
            trustedPublisherKeys: {
              "publisher-1": publicKey.export({ type: "spki", format: "pem" }),
            },
          },
        },
      ),
      /signature verification failed/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
