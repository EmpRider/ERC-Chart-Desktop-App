import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { parseHTML } from "linkedom";
import { renderDevelopmentShell } from "../dist/index.js";

function createDocument() {
  return parseHTML('<!doctype html><main id="app"></main>').document;
}

test("renders deterministic dummy content and a connected bridge state", async () => {
  const document = createDocument();
  const rendering = renderDevelopmentShell(document, {
    getRuntimeInfo: async () => ({
      ipcContractVersion,
      applicationName: "ERC Chart",
    }),
  });

  assert.equal(document.querySelector("h1")?.textContent, "ERC Chart");
  assert.equal(
    document.querySelector("[data-milestone]")?.textContent,
    "Development shell",
  );
  assert.equal(
    document.querySelector("[data-status]")?.textContent,
    "Connecting secure bridge",
  );

  await rendering;

  assert.equal(
    document.querySelector("[data-status]")?.textContent,
    "Secure bridge connected",
  );
});

test("renders a safe unavailable state for missing or rejected bridges", async () => {
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
    const document = createDocument();
    await renderDevelopmentShell(document, bridge);
    assert.equal(
      document.querySelector("[data-status]")?.textContent,
      "Shell unavailable",
    );
    assert.equal(
      document.querySelector("[data-message]")?.textContent,
      "The secure application bridge could not be reached.",
    );
    assert.equal(document.body.textContent.includes("private path"), false);
  }
});

test("fails safely when the required renderer root is absent", async () => {
  const { document } = parseHTML("<!doctype html><body></body>");

  await assert.rejects(
    renderDevelopmentShell(document, undefined),
    new Error("Renderer root unavailable."),
  );
});
