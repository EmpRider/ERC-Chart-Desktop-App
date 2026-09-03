import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ApplicationShell,
  RuntimeApplicationShell,
  connectingShellState,
  createInitialWorkspace,
  resolveShellState,
  workspaceReducer,
} from "../dist/index.js";

function renderShell(
  connection,
  workspace = createInitialWorkspace(),
  overrides = {},
) {
  return renderToStaticMarkup(
    createElement(ApplicationShell, {
      connection,
      workspace,
      onWorkspaceAction: () => undefined,
      onProviderImport: () => undefined,
      ...overrides,
    }),
  );
}

async function mountShell(t, workspace, onWorkspaceAction) {
  const { document, window } = parseHTML(
    '<!doctype html><html><body><main id="test-root"></main></body></html>',
  );
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.document = document;
  globalThis.window = window;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.getElementById("test-root");
  assert.ok(container);
  const root = createRoot(container);
  t.after(async () => {
    await act(async () => root.unmount());
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  await act(async () => {
    root.render(
      createElement(ApplicationShell, {
        connection: connectingShellState,
        workspace,
        onWorkspaceAction,
        onProviderImport: () => undefined,
      }),
    );
  });

  return document;
}

test("renders the semantic dark application shell with provider import available", () => {
  const markup = renderShell(connectingShellState);

  assert.match(markup, /<header/);
  assert.match(markup, /<main/);
  assert.match(markup, /<footer/);
  assert.match(markup, /<h1[^>]*>ERC Chart<\/h1>/);
  assert.match(markup, /Desktop workspace/);
  assert.match(markup, /Workspace ready/);
  assert.match(markup, /Connecting secure bridge/);
  assert.match(markup, /Import provider/);
  assert.doesNotMatch(markup, /settings/i);
});

test("renders loaded provider candles in the primary chart workspace", () => {
  const markup = renderShell(connectingShellState, createInitialWorkspace(), {
    providerSession: {
      profileId: "erc.provider.binomo.default",
      providerId: "erc.provider.binomo",
      providerName: "Binomo",
      instrument: {
        id: "Z-CRY/IDX",
        symbol: "Z-CRY/IDX",
        name: "Z-CRY/IDX",
      },
      timeframeId: "1m",
      candles: [
        {
          instrumentId: "Z-CRY/IDX",
          timeframeId: "1m",
          openTimeMs: 1_800_000_000_000,
          open: 100,
          high: 102,
          low: 99,
          close: 101,
        },
      ],
    },
  });
  const { document } = parseHTML(markup);

  assert.match(markup, /Binomo connected/);
  assert.match(markup, /Z-CRY\/IDX/);
  assert.match(markup, /1m · 1 candles/);
  assert.ok(document.querySelector("[data-provider-chart]"));
  assert.doesNotMatch(markup, /Awaiting market data/);
});

test("resolves and renders a connected secure bridge", async () => {
  const state = await resolveShellState({
    getRuntimeInfo: async () => ({
      ipcContractVersion,
      applicationName: "ERC Chart",
    }),
  });
  const markup = renderShell(state);

  assert.deepEqual(state, {
    kind: "connected",
    label: "Secure bridge connected",
    message: "Desktop runtime verified",
  });
  assert.match(markup, /data-status="connected"/);
  assert.match(markup, /Secure bridge connected/);
});

test("fails closed without exposing bridge errors", async () => {
  for (const bridge of [
    undefined,
    { getRuntimeInfo: async () => Promise.reject(new Error("private path")) },
    {
      getRuntimeInfo: async () => ({
        ipcContractVersion: 2,
        applicationName: "ERC Chart",
      }),
    },
  ]) {
    const state = await resolveShellState(bridge);
    const markup = renderShell(state);

    assert.deepEqual(state, {
      kind: "unavailable",
      label: "Shell unavailable",
      message: "The secure application bridge could not be reached.",
    });
    assert.match(markup, /data-status="unavailable"/);
    assert.equal(markup.includes("private path"), false);
  }
});

test("fails closed on the initial render when the preload bridge is missing", () => {
  const markup = renderToStaticMarkup(
    createElement(RuntimeApplicationShell, { bridge: undefined }),
  );

  assert.match(markup, /data-status="unavailable"/);
  assert.match(markup, /Shell unavailable/);
  assert.doesNotMatch(markup, /Connecting secure bridge/);
});

test("renders accessible chart tabs and one enabled workspace add control", () => {
  const markup = renderShell(connectingShellState);
  const { document } = parseHTML(markup);
  const addWorkspace = document.querySelector(".workspace-add");

  assert.ok(addWorkspace);
  assert.equal(addWorkspace.getAttribute("aria-label"), "Add workspace");
  assert.equal(addWorkspace.hasAttribute("disabled"), false);
  assert.equal(addWorkspace.getAttribute("title"), null);
  assert.equal(document.querySelectorAll(".workspace-close").length, 0);
  assert.equal(document.querySelector(".layout-selector"), null);
  assert.equal(document.querySelectorAll("[data-chart-slot]").length, 1);
  assert.ok(document.querySelector('[role="tablist"]'));
  assert.ok(document.querySelector('[role="tab"][aria-selected="true"]'));
});

test("disables workspace addition at four and exposes the maximum hint", () => {
  const initial = createInitialWorkspace();
  const two = workspaceReducer(initial, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  const three = workspaceReducer(two, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  const four = workspaceReducer(three, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  const markup = renderShell(connectingShellState, four);
  const { document } = parseHTML(markup);
  const addWorkspace = document.querySelector(".workspace-add");
  const chartSlots = document.querySelectorAll("[data-chart-slot]");

  assert.ok(addWorkspace);
  assert.equal(addWorkspace.hasAttribute("disabled"), true);
  assert.equal(addWorkspace.getAttribute("title"), "Maximum 4 workspaces");
  assert.equal(
    addWorkspace.getAttribute("aria-label"),
    "Add workspace. Maximum 4 workspaces",
  );
  assert.match(
    document.querySelector('.workspace-toolbar [role="status"]')?.textContent ??
      "",
    /Maximum 4 workspaces/,
  );
  assert.equal(chartSlots.length, 4);
  assert.equal(document.querySelectorAll(".workspace-close").length, 3);
  assert.equal(chartSlots[0]?.querySelector(".workspace-close"), null);
  assert.equal(
    document.querySelector(".chart-grid")?.getAttribute("data-layout"),
    "4",
  );
});

test("re-enables addition after an added workspace is removed", () => {
  const initial = createInitialWorkspace();
  const two = workspaceReducer(initial, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  const three = workspaceReducer(two, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  const four = workspaceReducer(three, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  const maximumMarkup = renderShell(connectingShellState, four);
  const maximumDocument = parseHTML(maximumMarkup).document;
  const maximumAdd = maximumDocument.querySelector(".workspace-add");

  assert.ok(maximumAdd);
  assert.equal(maximumAdd.hasAttribute("disabled"), true);
  assert.equal(maximumAdd.getAttribute("title"), "Maximum 4 workspaces");

  const removed = workspaceReducer(four, {
    type: "remove-workspace",
    tabId: "tab-1",
    workspaceId: "tab-1-chart-3",
  });
  const markup = renderShell(connectingShellState, removed);
  const { document } = parseHTML(markup);
  const addWorkspace = document.querySelector(".workspace-add");
  const closeWorkspace = document.querySelector(".workspace-close");

  assert.ok(addWorkspace);
  assert.equal(addWorkspace.hasAttribute("disabled"), false);
  assert.equal(addWorkspace.getAttribute("title"), null);
  assert.equal(addWorkspace.getAttribute("aria-label"), "Add workspace");
  assert.equal(
    document.querySelector('.workspace-toolbar [role="status"]'),
    null,
  );
  assert.equal(document.querySelectorAll("[data-chart-slot]").length, 3);
  assert.equal(document.querySelectorAll(".workspace-close").length, 2);
  assert.equal(closeWorkspace?.getAttribute("aria-label"), "Close workspace 2");
});

test("dispatches the exact add workspace action", async (t) => {
  const actions = [];
  const document = await mountShell(t, createInitialWorkspace(), (action) => {
    actions.push(action);
  });
  const addWorkspace = document.querySelector(".workspace-add");

  assert.ok(addWorkspace);
  await act(async () => addWorkspace.click());
  assert.deepEqual(actions, [{ type: "add-workspace", tabId: "tab-1" }]);
});

test("dispatches the exact close action for an arbitrary workspace", async (t) => {
  const initial = createInitialWorkspace();
  const two = workspaceReducer(initial, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  const three = workspaceReducer(two, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  const four = workspaceReducer(three, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  const actions = [];
  const document = await mountShell(t, four, (action) => {
    actions.push(action);
  });
  const closeWorkspaces = document.querySelectorAll(".workspace-close");

  assert.equal(closeWorkspaces.length, 3);
  await act(async () => closeWorkspaces[1]?.click());
  assert.deepEqual(actions, [
    {
      type: "remove-workspace",
      tabId: "tab-1",
      workspaceId: "tab-1-chart-3",
    },
  ]);
});
