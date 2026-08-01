import assert from "node:assert/strict";
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
      codeCache: true,
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
