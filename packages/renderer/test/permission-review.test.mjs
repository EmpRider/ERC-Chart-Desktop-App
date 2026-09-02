import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { PluginPermissionReview } from "../dist/index.js";

function request(overrides = {}) {
  return {
    requestId: "review-1",
    pluginId: "erc.provider.binomo",
    pluginName: "Binomo Provider",
    pluginVersion: "1.2.0",
    kind: "provider",
    mode: "production",
    trust: "signed",
    reason: "install",
    permissions: {
      network: ["https://api.binomo.com", "wss://ws.binomo.com"],
      credentials: ["session-token"],
      storage: ["provider-cache"],
    },
    ...overrides,
  };
}

test("renders a complete accessible permission review without secret values", () => {
  const markup = renderToStaticMarkup(
    createElement(PluginPermissionReview, {
      request: request(),
      onDecision: () => undefined,
    }),
  );
  const { document } = parseHTML(markup);
  const dialog = document.querySelector('[role="dialog"]');

  assert.ok(dialog);
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.match(dialog.textContent ?? "", /Binomo Provider/);
  assert.match(dialog.textContent ?? "", /Trusted signed plugin/);
  assert.match(dialog.textContent ?? "", /https:\/\/api\.binomo\.com/);
  assert.match(dialog.textContent ?? "", /session-token/);
  assert.match(dialog.textContent ?? "", /provider-cache/);
  assert.doesNotMatch(dialog.textContent ?? "", /secret-value/i);
});

test("requires explicit re-approval when an update changes permissions", () => {
  const markup = renderToStaticMarkup(
    createElement(PluginPermissionReview, {
      request: request({ reason: "permission-change" }),
      onDecision: () => undefined,
    }),
  );

  assert.match(markup, /must be approved again before activation/);
});

test("shows an explicit warning for unsigned Developer Mode packages", () => {
  const markup = renderToStaticMarkup(
    createElement(PluginPermissionReview, {
      request: request({ mode: "developer", trust: "unsigned" }),
      onDecision: () => undefined,
    }),
  );

  assert.match(markup, /Unsigned Developer Mode plugin/);
  assert.match(markup, /Only approve packages you trust and understand/);
  assert.match(markup, /role="alert"/);
});

test("emits only the review id and explicit approve or reject decision", async (t) => {
  const { document, window } = parseHTML(
    '<!doctype html><html><body><main id="root"></main></body></html>',
  );
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.document = document;
  globalThis.window = window;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);
  t.after(async () => {
    await act(async () => root.unmount());
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });
  const decisions = [];
  await act(async () => {
    root.render(
      createElement(PluginPermissionReview, {
        request: request(),
        onDecision: (...args) => decisions.push(args),
      }),
    );
  });

  await act(async () => document.querySelector(".permission-reject")?.click());
  await act(async () => document.querySelector(".permission-approve")?.click());

  assert.deepEqual(decisions, [
    ["review-1", "reject"],
    ["review-1", "approve"],
  ]);
});

test("disables both decisions while an approval is being applied", () => {
  const markup = renderToStaticMarkup(
    createElement(PluginPermissionReview, {
      request: request(),
      busy: true,
      onDecision: () => undefined,
    }),
  );
  const { document } = parseHTML(markup);

  assert.equal(
    document.querySelector(".permission-reject")?.hasAttribute("disabled"),
    true,
  );
  assert.equal(
    document.querySelector(".permission-approve")?.hasAttribute("disabled"),
    true,
  );
  assert.match(markup, /Applying…/);
});
