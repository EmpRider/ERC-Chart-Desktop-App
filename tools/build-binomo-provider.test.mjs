import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discardStagedPlugin,
  isProviderNetworkRequestAllowed,
  stagePluginPackage,
} from "../packages/provider-runtime/dist/index.js";
import {
  binomoProviderPackageIdentity,
  buildBinomoProviderPackage,
} from "./build-binomo-provider.mjs";

test("builds the Binomo provider in the supported import package shape", async () => {
  const outputRoot = await mkdtemp(
    path.join(os.tmpdir(), "erc-binomo-package-"),
  );
  await rm(outputRoot, { recursive: true, force: true });
  try {
    const { manifest } = await buildBinomoProviderPackage({
      root: process.cwd(),
      outputRoot,
    });
    const entry = await readFile(path.join(outputRoot, "dist", "index.js"));
    const storedManifest = JSON.parse(
      await readFile(path.join(outputRoot, "plugin.json"), "utf8"),
    );

    assert.deepEqual(storedManifest, manifest);
    assert.equal(manifest.id, binomoProviderPackageIdentity.id);
    assert.equal(manifest.version, "0.1.1");
    assert.equal(manifest.kind, "provider");
    assert.equal(manifest.entry, "dist/index.js");
    assert.deepEqual(manifest.permissions.network, [
      "https://api.binomo.com/",
      "wss://as.binomo.com/",
      "wss://ws.binomo.com/",
    ]);
    assert.deepEqual(manifest.permissions.credentials, ["binomo_cookie"]);
    assert.equal(
      manifest.integrity.files["dist/index.js"],
      createHash("sha256").update(entry).digest("hex"),
    );
    assert.match(entry.toString("utf8"), /@erc-chart\/provider-sdk/u);
    assert.equal(
      isProviderNetworkRequestAllowed(
        "https://api.binomo.com/candles/v1/Z-CRY%2FIDX/2026-09-03T00:00:00/60?locale=en",
        manifest.permissions.network,
      ),
      true,
    );
    assert.equal(
      isProviderNetworkRequestAllowed(
        "wss://as.binomo.com/",
        manifest.permissions.network,
      ),
      true,
    );

    const staged = await stagePluginPackage(
      { kind: "folder", path: outputRoot },
      {
        stagingRoot: `${outputRoot}-staging`,
        trustPolicy: { mode: "developer", trustedPublisherKeys: {} },
      },
    );
    assert.equal(staged.manifest.id, "erc.provider.binomo");
    await discardStagedPlugin(staged);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
    await rm(`${outputRoot}-staging`, { recursive: true, force: true });
  }
});
