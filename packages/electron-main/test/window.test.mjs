import assert from "node:assert/strict";
import test from "node:test";
import { secureWindowOptions } from "../dist/index.js";

test("creates the initial window with the exact sandbox baseline", () => {
  assert.deepEqual(secureWindowOptions("/runtime/preload.cjs"), {
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: "#111827",
    webPreferences: {
      preload: "/runtime/preload.cjs",
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
});
