import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ApplicationShell,
  connectingShellState,
  resolveShellState,
} from "../dist/index.js";

test("renders the semantic dark application shell without deferred controls", () => {
  const markup = renderToStaticMarkup(
    createElement(ApplicationShell, { connection: connectingShellState }),
  );

  assert.match(markup, /<header/);
  assert.match(markup, /<main/);
  assert.match(markup, /<footer/);
  assert.match(markup, /<h1[^>]*>ERC Chart<\/h1>/);
  assert.match(markup, /Desktop workspace/);
  assert.match(markup, /Workspace ready/);
  assert.match(markup, /Connecting secure bridge/);
  assert.doesNotMatch(markup, /tab|layout|settings|provider/i);
});

test("resolves and renders a connected secure bridge", async () => {
  const state = await resolveShellState({
    getRuntimeInfo: async () => ({
      ipcContractVersion,
      applicationName: "ERC Chart",
    }),
  });
  const markup = renderToStaticMarkup(
    createElement(ApplicationShell, { connection: state }),
  );

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
    const markup = renderToStaticMarkup(
      createElement(ApplicationShell, { connection: state }),
    );

    assert.deepEqual(state, {
      kind: "unavailable",
      label: "Shell unavailable",
      message: "The secure application bridge could not be reached.",
    });
    assert.match(markup, /data-status="unavailable"/);
    assert.equal(markup.includes("private path"), false);
  }
});
