import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ApplicationShell,
  RuntimeApplicationShell,
  connectingShellState,
  createInitialWorkspace,
  resolveShellState,
  workspaceReducer,
} from "../dist/index.js";

function renderShell(connection, workspace = createInitialWorkspace()) {
  return renderToStaticMarkup(
    createElement(ApplicationShell, {
      connection,
      workspace,
      onWorkspaceAction: () => undefined,
    }),
  );
}

test("renders the semantic dark application shell without deferred controls", () => {
  const markup = renderShell(connectingShellState);

  assert.match(markup, /<header/);
  assert.match(markup, /<main/);
  assert.match(markup, /<footer/);
  assert.match(markup, /<h1[^>]*>ERC Chart<\/h1>/);
  assert.match(markup, /Desktop workspace/);
  assert.match(markup, /Workspace ready/);
  assert.match(markup, /Connecting secure bridge/);
  assert.doesNotMatch(markup, /settings|provider/i);
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

test("renders accessible tabs and exact one-to-four layout state", () => {
  const initial = createInitialWorkspace();
  const added = workspaceReducer(initial, { type: "add-tab" });
  const four = workspaceReducer(added, {
    type: "set-layout",
    tabId: "tab-2",
    layoutSize: 4,
  });
  const markup = renderShell(connectingShellState, four);

  assert.match(markup, /role="tablist"/);
  assert.match(markup, /role="tab"[^>]*aria-selected="true"[^>]*>Chart 2/);
  assert.match(markup, /aria-label="Add chart tab"/);
  assert.match(
    markup,
    /aria-label="Use four chart layout"[^>]*aria-pressed="true"/,
  );
  assert.equal((markup.match(/data-chart-slot=/g) ?? []).length, 4);
  assert.match(markup, /data-layout="4"/);
});
