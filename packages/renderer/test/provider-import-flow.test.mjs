import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { RuntimeApplicationShell } from "../dist/index.js";

test("opens provider permission review from the runtime import control and cancels safely", async (t) => {
  const { document, window } = parseHTML(
    '<!doctype html><html><body><main id="test-root"></main></body></html>',
  );
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.document = document;
  globalThis.window = window;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const rootElement = document.getElementById("test-root");
  assert.ok(rootElement);
  const root = createRoot(rootElement);
  const calls = [];
  const bridge = {
    getRuntimeInfo: async () => ({
      ipcContractVersion,
      applicationName: "ERC Chart",
    }),
    loadWorkspace: async () => null,
    saveWorkspace: async () => undefined,
    flushWorkspace: async () => undefined,
    previewProviderImport: async () => ({
      requestId: "request-binomo",
      pluginId: "erc.provider.binomo",
      pluginName: "Binomo",
      pluginVersion: "0.1.0",
      mode: "developer",
      trust: "unsigned",
      permissions: {
        network: [
          "https://api.binomo.com/",
          "wss://as.binomo.com/",
          "wss://ws.binomo.com/",
        ],
        credentials: ["binomo_cookie"],
        storage: [],
      },
    }),
    approveProviderImport: async () => assert.fail("approval was not expected"),
    cancelProviderImport: async (requestId) => calls.push(requestId),
  };
  t.after(async () => {
    await act(async () => root.unmount());
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  await act(async () => {
    root.render(createElement(RuntimeApplicationShell, { bridge }));
  });
  await act(async () => Promise.resolve());
  const importButton = document.querySelector(".provider-import");
  assert.ok(importButton);
  await act(async () => importButton.click());
  await act(async () => Promise.resolve());

  assert.match(document.body.textContent, /Review plugin permissions/u);
  assert.match(document.body.textContent, /Unsigned Developer Mode plugin/u);
  assert.match(document.body.textContent, /https:\/\/api\.binomo\.com\//u);
  assert.ok(document.querySelector('input[type="password"]'));
  const cancelButton = document.querySelector(".permission-reject");
  assert.ok(cancelButton);
  await act(async () => cancelButton.click());
  await act(async () => Promise.resolve());

  assert.deepEqual(calls, ["request-binomo"]);
  assert.equal(document.querySelector(".permission-review"), null);
});
