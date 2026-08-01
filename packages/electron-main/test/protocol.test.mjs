import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  rendererEntryUrl,
  rendererProtocolScheme,
  resolveRendererAssetUrl,
} from "../dist/index.js";

const rendererRoot = path.resolve("/application/runtime");

test("defines the fixed renderer scheme and entry URL", () => {
  assert.equal(rendererProtocolScheme, "erc-app");
  assert.equal(rendererEntryUrl, "erc-app://app/index.html");
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
