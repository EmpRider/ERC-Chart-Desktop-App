import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  installRendererProtocol,
  rendererSchemeRegistration,
} from "../dist/index.js";

test("declares the renderer scheme as standard and secure", () => {
  assert.deepEqual(rendererSchemeRegistration, {
    scheme: "erc-app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  });
});

test("serves contained assets and rejects invalid renderer requests", async () => {
  const events = [];
  let handler;
  const root = path.resolve("/application/runtime");
  const unregister = await installRendererProtocol(
    {
      async handle(scheme, nextHandler) {
        events.push(`handle:${scheme}`);
        handler = nextHandler;
      },
      unhandle(scheme) {
        events.push(`unhandle:${scheme}`);
      },
      async fetch(url) {
        events.push(`fetch:${url}`);
        return new Response("asset", { status: 200 });
      },
    },
    root,
  );

  const valid = await handler({ url: "erc-app://app/renderer.js" });
  const invalid = await handler({ url: "erc-app://outside/renderer.js" });
  unregister();
  unregister();

  assert.equal(await valid.text(), "asset");
  assert.equal(invalid.status, 404);
  assert.deepEqual(events, [
    "handle:erc-app",
    `fetch:${pathToFileURL(path.join(root, "renderer.js")).href}`,
    "unhandle:erc-app",
  ]);
});

test("returns a controlled response when renderer asset fetch fails", async () => {
  let handler;
  await installRendererProtocol(
    {
      handle(_scheme, nextHandler) {
        handler = nextHandler;
      },
      unhandle() {
        return undefined;
      },
      async fetch() {
        throw new Error("sensitive filesystem failure");
      },
    },
    path.resolve("/application/runtime"),
  );

  const response = await handler({ url: "erc-app://app/missing.js" });

  assert.equal(response.status, 404);
});

test("serves only contained indicator plugin assets from the managed installation root", async () => {
  const handlers = new Map();
  const rendererRoot = path.resolve("/application/runtime");
  const pluginRoot = await mkdtemp(
    path.join(os.tmpdir(), "erc-indicator-protocol-"),
  );
  const entryPath = path.join(
    pluginRoot,
    "erc.indicator.example",
    "1.2.3",
    "dist",
    "index.js",
  );
  await mkdir(path.dirname(entryPath), { recursive: true });
  await writeFile(entryPath, "export default {};", "utf8");
  const fetched = [];
  try {
    const unregister = await installRendererProtocol(
      {
        handle(scheme, nextHandler) {
          handlers.set(scheme, nextHandler);
        },
        unhandle(scheme) {
          handlers.delete(scheme);
        },
        async fetch(url) {
          fetched.push(url);
          return new Response("plugin", { status: 200 });
        },
      },
      rendererRoot,
      pluginRoot,
    );

    const pluginHandler = handlers.get("erc-plugin");
    assert.equal(typeof pluginHandler, "function");
    const valid = await pluginHandler({
      url: "erc-plugin://plugin/erc.indicator.example/1.2.3/dist/index.js",
    });
    const traversal = await pluginHandler({
      url: "erc-plugin://plugin/erc.indicator.example/1.2.3/dist/%2e%2e/plugin.json",
    });
    const outsideDist = await pluginHandler({
      url: "erc-plugin://plugin/erc.indicator.example/1.2.3/plugin.json",
    });

    assert.equal(await valid.text(), "plugin");
    assert.equal(
      valid.headers.get("access-control-allow-origin"),
      "erc-app://app",
    );
    assert.equal(
      valid.headers.get("cross-origin-resource-policy"),
      "cross-origin",
    );
    assert.equal(traversal.status, 404);
    assert.equal(outsideDist.status, 404);
    assert.deepEqual(fetched, [pathToFileURL(await realpath(entryPath)).href]);
    unregister();
    assert.equal(handlers.size, 0);
  } finally {
    await rm(pluginRoot, { recursive: true, force: true });
  }
});

test("serves the indicator worker with an explicit network-denying CSP", async () => {
  const handlers = new Map();
  await installRendererProtocol(
    {
      handle(scheme, nextHandler) {
        handlers.set(scheme, nextHandler);
      },
      unhandle() {
        return undefined;
      },
      async fetch() {
        return new Response("worker", { status: 200 });
      },
    },
    path.resolve("/application/runtime"),
  );

  const rendererHandler = handlers.get("erc-app");
  assert.equal(typeof rendererHandler, "function");
  const response = await rendererHandler({
    url: "erc-app://app/indicator-worker.js",
  });
  const csp = response.headers.get("content-security-policy");
  assert.match(csp, /script-src 'self' erc-plugin:/u);
  assert.match(csp, /connect-src 'none'/u);
  assert.match(csp, /worker-src 'none'/u);
});
