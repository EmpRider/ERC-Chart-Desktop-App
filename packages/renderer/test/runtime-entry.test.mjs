import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { act } from "react";

test("mounts the runtime React shell into the required application root", async (t) => {
  const { document, window } = parseHTML(
    '<!doctype html><html><body><main id="app"></main></body></html>',
  );
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.document = document;
  globalThis.window = window;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let runtimeEntry;
  t.after(async () => {
    if (runtimeEntry !== undefined) {
      await act(async () => runtimeEntry.runtimeRoot.unmount());
    }
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  await act(async () => {
    runtimeEntry = await import(`../dist/runtime-entry.js?test=${Date.now()}`);
  });

  const root = document.getElementById("app");
  assert.ok(root);
  assert.match(root.innerHTML, /<header/);
  assert.match(root.innerHTML, /<main/);
  assert.match(root.innerHTML, /<footer/);
  assert.match(root.textContent, /Shell unavailable/);
});
