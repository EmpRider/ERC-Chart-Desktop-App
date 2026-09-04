import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderManager } from "../dist/index.js";

const snapshot = {
  installedProviders: [
    {
      providerId: "erc.provider.fixture",
      providerName: "Fixture Provider",
      version: "1.0.0",
      credentialKeys: ["auth_token"],
    },
  ],
  profiles: [
    {
      profileId: "profile-a",
      providerId: "erc.provider.fixture",
      providerName: "Fixture Provider",
      version: "1.0.0",
      displayName: "Primary",
      status: "ready",
      settings: { region: "eu" },
      credentialKeys: ["auth_token"],
    },
  ],
};

test("renders provider management without exposing credential values", () => {
  const markup = renderToStaticMarkup(
    createElement(ProviderManager, {
      snapshot,
      onClose: () => undefined,
      onImport: () => undefined,
      onRefresh: async () => undefined,
      onCreate: async () => undefined,
      onUpdate: async () => undefined,
      onStart: async () => undefined,
      onStop: async () => undefined,
      onDelete: async () => undefined,
    }),
  );

  assert.match(markup, /Provider manager/u);
  assert.match(markup, /Primary/u);
  assert.match(markup, /ready/u);
  assert.match(markup, /Import provider/u);
  assert.match(markup, /Create profile/u);
  assert.match(markup, /type="password"/u);
  assert.doesNotMatch(markup, /fixture-token/u);
});

test("dispatches stop and profile removal actions", async (t) => {
  const { document, window } = parseHTML(
    '<!doctype html><html><body><main id="root"></main></body></html>',
  );
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.document = document;
  globalThis.window = window;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const rootElement = document.getElementById("root");
  assert.ok(rootElement);
  const root = createRoot(rootElement);
  const calls = [];
  t.after(async () => {
    await act(async () => root.unmount());
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  await act(async () => {
    root.render(
      createElement(ProviderManager, {
        snapshot,
        onClose: () => undefined,
        onImport: () => calls.push(["import"]),
        onRefresh: async () => undefined,
        onCreate: async () => undefined,
        onUpdate: async () => undefined,
        onStart: async (profileId) => calls.push(["start", profileId]),
        onStop: async (profileId) => calls.push(["stop", profileId]),
        onDelete: async (profileId) => calls.push(["delete", profileId]),
      }),
    );
  });
  const buttons = [...document.querySelectorAll("button")];
  const importProvider = buttons.find(
    (button) => button.textContent === "Import provider",
  );
  const stop = buttons.find((button) => button.textContent === "Stop");
  const remove = buttons.find((button) => button.textContent === "Remove");
  assert.ok(importProvider);
  assert.ok(stop);
  assert.ok(remove);
  await act(async () => importProvider.click());
  await act(async () => stop.click());
  await act(async () => remove.click());
  assert.deepEqual(calls, [
    ["import"],
    ["stop", "profile-a"],
    ["delete", "profile-a"],
  ]);
});
