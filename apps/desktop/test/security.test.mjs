import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { rendererContentSecurityPolicy } from "@erc-chart/electron-main";
import { parseHTML } from "linkedom";
import { installWindowSecurity } from "../dist/window-security.js";

test("declares the renderer CSP before any resource is loaded", async () => {
  const html = await readFile(
    new URL("../static/index.html", import.meta.url),
    "utf8",
  );
  const { document } = parseHTML(html);
  const csp = document.querySelector(
    'meta[http-equiv="Content-Security-Policy"]',
  );

  assert.equal(csp?.getAttribute("content"), rendererContentSecurityPolicy);
  assert.ok(
    html.indexOf('http-equiv="Content-Security-Policy"') <
      html.indexOf('<link rel="stylesheet"'),
  );
  assert.ok(
    html.indexOf('http-equiv="Content-Security-Policy"') <
      html.indexOf('<script type="module"'),
  );
});

test("denies child windows and prevents untrusted navigation", () => {
  let navigate;
  let openHandler;
  const prevented = [];

  installWindowSecurity({
    onWillNavigate(handler) {
      navigate = handler;
    },
    setWindowOpenHandler(handler) {
      openHandler = handler;
    },
  });

  navigate(
    { preventDefault: () => prevented.push("external") },
    "https://example.com/",
  );
  navigate(
    { preventDefault: () => prevented.push("canonical") },
    "erc-app://app/index.html",
  );

  assert.deepEqual(prevented, ["external"]);
  assert.deepEqual(openHandler(), { action: "deny" });
});
