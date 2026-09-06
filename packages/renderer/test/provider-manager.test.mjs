import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { PluginManager } from "../dist/index.js";

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

const indicators = [
  {
    pluginId: "erc.indicator.fixture",
    pluginName: "Fixture Indicator",
    version: "2.0.0",
    definition: {
      id: "erc.indicator.fixture.main",
      name: "Fixture RSI",
      description: "Fixture indicator definition",
      placement: "pane",
      inputs: [
        {
          key: "length",
          label: "Length",
          type: "number",
          defaultValue: 14,
          effect: "calculation",
        },
      ],
      outputs: [{ key: "value", label: "Value" }],
      plots: [{ key: "value", kind: "line", outputKey: "value" }],
      requiresLiveTicks: false,
    },
  },
];

function managerProps(overrides = {}) {
  return {
    snapshot,
    indicators,
    onClose: () => undefined,
    onProviderImport: () => undefined,
    onIndicatorImport: () => undefined,
    onRefresh: async () => undefined,
    onCreate: async () => undefined,
    onUpdate: async () => undefined,
    onStart: async () => undefined,
    onStop: async () => undefined,
    onDelete: async () => undefined,
    ...overrides,
  };
}

test("renders plugin manager provider list and selected provider settings", () => {
  const markup = renderToStaticMarkup(
    createElement(PluginManager, managerProps()),
  );

  assert.match(markup, /Plugin Manager/u);
  assert.match(markup, /Providers/u);
  assert.match(markup, /Indicators/u);
  assert.match(markup, /Installed providers/u);
  assert.match(markup, /Installed profiles/u);
  assert.match(markup, /Fixture Provider/u);
  assert.match(markup, /Import ZIP/u);
  assert.match(markup, /Import folder/u);
  assert.match(markup, /Provider installation/u);
  assert.match(markup, /managed from the Installed profiles tab/u);
  assert.doesNotMatch(markup, /Add profile/u);
  assert.doesNotMatch(markup, /fixture-token/u);
});

test("switches tabs and dispatches provider and indicator import source kinds", async (t) => {
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
      createElement(
        PluginManager,
        managerProps({
          onProviderImport: (sourceKind) =>
            calls.push(["provider-import", sourceKind]),
          onIndicatorImport: (sourceKind) =>
            calls.push(["indicator-import", sourceKind]),
          onStart: async (profileId) => calls.push(["start", profileId]),
          onStop: async (profileId) => calls.push(["stop", profileId]),
          onDelete: async (profileId) => calls.push(["delete", profileId]),
        }),
      ),
    );
  });

  const providerImportZip = [
    ...document.querySelectorAll(".plugin-import-actions button"),
  ].find((button) => button.textContent?.trim() === "Import ZIP");
  assert.ok(providerImportZip);
  await act(async () => providerImportZip.click());

  const profilesTab = [...document.querySelectorAll('[role="tab"]')].find(
    (button) => button.textContent?.includes("Installed profiles"),
  );
  assert.ok(profilesTab);
  await act(async () => profilesTab.click());

  assert.match(document.body.textContent, /Primary/u);
  assert.match(document.body.textContent, /Fixture Provider/u);
  assert.match(document.body.textContent, /Add profile/u);

  const stop = [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Stop",
  );
  const remove = [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Remove profile",
  );
  assert.ok(stop);
  assert.ok(remove);

  await act(async () => stop.click());
  await act(async () => remove.click());

  const addProfile = [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Add profile",
  );
  assert.ok(addProfile);
  await act(async () => addProfile.click());
  assert.match(document.body.textContent, /Create and start/u);
  const providerSelect = document.querySelector("select");
  assert.ok(providerSelect);
  assert.equal(providerSelect.value, "erc.provider.fixture");

  const indicatorTab = [...document.querySelectorAll('[role="tab"]')].find(
    (button) => button.textContent?.trim().startsWith("Indicators"),
  );
  assert.ok(indicatorTab);
  await act(async () => indicatorTab.click());

  assert.match(document.body.textContent, /Installed indicators/u);
  assert.match(document.body.textContent, /Fixture Indicator/u);
  assert.match(document.body.textContent, /Declared parameters/u);
  assert.match(document.body.textContent, /configured per indicator instance/u);

  const indicatorImportFolder = [
    ...document.querySelectorAll(".plugin-import-actions button"),
  ].find((button) => button.textContent?.trim() === "Import folder");
  assert.ok(indicatorImportFolder);
  await act(async () => indicatorImportFolder.click());

  assert.deepEqual(calls, [
    ["provider-import", "zip"],
    ["stop", "profile-a"],
    ["delete", "profile-a"],
    ["indicator-import", "folder"],
  ]);
});
