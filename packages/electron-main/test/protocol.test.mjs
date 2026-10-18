import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  indicatorPluginOrigin,
  indicatorPluginProtocolScheme,
  rendererEntryUrl,
  rendererProtocolScheme,
  resolveIndicatorPluginAssetUrl,
  resolveRendererAssetUrl,
} from "../dist/index.js";

const rendererRoot = path.resolve("/application/runtime");

test("defines the fixed renderer scheme and entry URL", () => {
  assert.equal(rendererProtocolScheme, "erc-app");
  assert.equal(rendererEntryUrl, "erc-app://app/index.html");
  assert.equal(indicatorPluginProtocolScheme, "erc-plugin");
  assert.equal(indicatorPluginOrigin, "erc-plugin://plugin");
});

test("resolves renderer assets only beneath the configured root", () => {
  assert.equal(
    resolveRendererAssetUrl("erc-app://app/index.html", rendererRoot),
    pathToFileURL(path.join(rendererRoot, "index.html")).href,
  );
  assert.equal(
    resolveRendererAssetUrl(
      "erc-app://app/assets/renderer.js?build=1#ignored",
      rendererRoot,
    ),
    pathToFileURL(path.join(rendererRoot, "assets", "renderer.js")).href,
  );
  assert.equal(
    resolveRendererAssetUrl("ERC-APP://APP/index.html", rendererRoot),
    pathToFileURL(path.join(rendererRoot, "index.html")).href,
  );
});

test("rejects requests outside the renderer protocol boundary", () => {
  for (const requestUrl of [
    "https://app/index.html",
    "erc-app://other/index.html",
    "erc-app://app/%00secret",
    "erc-app://app/assets%5Crenderer.js",
    "erc-app://app/%2e%2e/%2e%2e/secret.txt",
    "erc-app://app/%E0%A4%A",
  ]) {
    assert.equal(resolveRendererAssetUrl(requestUrl, rendererRoot), undefined);
  }
});

test("resolves plugin assets with the canonical manifest path and SemVer rules", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-plugin-resolver-"));
  const longName = `${"a".repeat(130)}.js`;
  const version = "1.2.3-alpha.1+build.5";
  const entryPath = path.join(
    root,
    "erc.indicator.example",
    version,
    "dist",
    longName,
  );
  try {
    await mkdir(path.dirname(entryPath), { recursive: true });
    await writeFile(entryPath, "export default {};", "utf8");
    assert.equal(
      resolveIndicatorPluginAssetUrl(
        `erc-plugin://plugin/erc.indicator.example/${version}/dist/${longName}`,
        root,
      ),
      pathToFileURL(await realpath(entryPath)).href,
    );
    assert.equal(
      resolveIndicatorPluginAssetUrl(
        `erc-app://app/erc.indicator.example/${version}/dist/${longName}`,
        root,
      ),
      undefined,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects plugin asset paths that escape through a directory link", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-plugin-contained-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "erc-plugin-outside-"));
  const versionRoot = path.join(root, "erc.indicator.example", "1.2.3");
  const distRoot = path.join(versionRoot, "dist");
  const outsideFile = path.join(outside, "secret.js");
  try {
    await mkdir(distRoot, { recursive: true });
    await writeFile(outsideFile, "secret", "utf8");
    try {
      await symlink(
        outside,
        path.join(distRoot, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      t.skip(
        `directory links are unavailable in this environment: ${String(error)}`,
      );
      return;
    }
    assert.equal(
      resolveIndicatorPluginAssetUrl(
        "erc-plugin://plugin/erc.indicator.example/1.2.3/dist/linked/secret.js",
        root,
      ),
      undefined,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
