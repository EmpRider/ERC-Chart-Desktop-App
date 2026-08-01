import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTrustedIpcSender,
  electronFusePolicy,
  isTrustedRendererDocument,
  rendererContentSecurityPolicy,
} from "../dist/index.js";

test("defines the exact fail-closed renderer content security policy", () => {
  assert.equal(
    rendererContentSecurityPolicy,
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
  );
});

test("trusts only the canonical renderer document", () => {
  assert.equal(isTrustedRendererDocument("erc-app://app/index.html"), true);

  for (const url of [
    "https://example.com/",
    "file:///runtime/index.html",
    "erc-app://other/index.html",
    "erc-app://app/other.html",
    "erc-app://app/index.html?debug=true",
    "erc-app://app/index.html#fragment",
    "erc-app://app/index.html?",
    "erc-app://app/index.html#",
    "erc-app://user@app/index.html",
    "not a url",
  ]) {
    assert.equal(isTrustedRendererDocument(url), false, url);
  }
});

test("accepts only the canonical main frame as an IPC sender", () => {
  assert.doesNotThrow(() =>
    assertTrustedIpcSender({
      url: "erc-app://app/index.html",
      isMainFrame: true,
    }),
  );

  for (const sender of [
    undefined,
    { url: "erc-app://app/index.html", isMainFrame: false },
    { url: "https://example.com/", isMainFrame: true },
    { url: "not a url", isMainFrame: true },
  ]) {
    assert.throws(
      () => assertTrustedIpcSender(sender),
      new Error("Unauthorized IPC sender."),
    );
  }
});

test("defines every package-time Electron fuse decision", () => {
  assert.deepEqual(electronFusePolicy, {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  });
  assert.equal(Object.isFrozen(electronFusePolicy), true);
});
