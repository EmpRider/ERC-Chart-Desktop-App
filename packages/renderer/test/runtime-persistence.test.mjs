import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  RuntimeApplicationShell,
  createInitialWorkspace,
  toPersistedWorkspace,
  workspaceReducer,
} from "../dist/index.js";

async function mountRuntimeShell(t, bridge) {
  const { document, window } = parseHTML(
    '<!doctype html><html><body><main id="test-root"></main></body></html>',
  );
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.document = document;
  globalThis.window = window;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById("test-root"));
  t.after(async () => {
    await act(async () => root.unmount());
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });
  await act(async () =>
    root.render(createElement(RuntimeApplicationShell, { bridge })),
  );
  return document;
}

test("hydrates before showing workspace UI", async (t) => {
  let resolveLoad;
  const loaded = new Promise((resolve) => {
    resolveLoad = resolve;
  });
  const bridge = {
    getRuntimeInfo: async () => ({
      ipcContractVersion: 1,
      applicationName: "ERC Chart",
    }),
    loadWorkspace: async () => loaded,
    saveWorkspace: async () => undefined,
    flushWorkspace: async () => undefined,
  };
  const document = await mountRuntimeShell(t, bridge);

  assert.equal(document.querySelector(".workspace"), null);
  assert.match(document.body.textContent, /Restoring workspace/);

  const restored = workspaceReducer(createInitialWorkspace(), {
    type: "add-workspace",
    tabId: "tab-1",
  });
  await act(async () => resolveLoad(toPersistedWorkspace(restored, 1)));

  assert.equal(document.querySelectorAll("[data-chart-slot]").length, 2);
});

test("persists each real workspace mutation", async (t) => {
  const saves = [];
  const bridge = {
    getRuntimeInfo: async () => ({
      ipcContractVersion: 1,
      applicationName: "ERC Chart",
    }),
    loadWorkspace: async () => null,
    saveWorkspace: async (workspace) => saves.push(workspace),
    flushWorkspace: async () => undefined,
  };
  const document = await mountRuntimeShell(t, bridge);
  await act(async () => undefined);
  const add = document.querySelector(".workspace-add");
  assert.ok(add);

  await act(async () => add.click());
  assert.equal(saves.length, 1);
  assert.equal(saves[0].tabs[0].chartSlots.length, 2);
});

test("does not overwrite invalid persisted data", async (t) => {
  const saves = [];
  const bridge = {
    getRuntimeInfo: async () => ({
      ipcContractVersion: 1,
      applicationName: "ERC Chart",
    }),
    loadWorkspace: async () => ({ schemaVersion: 1, private: "invalid" }),
    saveWorkspace: async (workspace) => saves.push(workspace),
    flushWorkspace: async () => undefined,
  };
  const document = await mountRuntimeShell(t, bridge);
  await act(async () => undefined);

  assert.equal(document.querySelector(".workspace"), null);
  assert.match(document.body.textContent, /Workspace unavailable/);
  assert.equal(saves.length, 0);
});
