import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import electron from "electron";
import { runElectronProcess } from "./electron-smoke-process.mjs";

const root = path.resolve(import.meta.dirname, "..");
const marker = "ERC_CHART_SHARED_STORAGE_READY";

async function waitFor(check) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error("Shared-storage smoke condition timed out.");
}

if (process.versions.electron !== undefined) {
  // Trusted test entry only: production main receives no new storage override or IPC.
  const option = (name) =>
    process.argv
      .find((arg) => arg.startsWith(`--${name}=`))
      ?.slice(name.length + 3);
  const shared = option("phase6-shared");
  const mode = option("phase6-mode");
  assert.ok(shared && ["a", "b", "verify"].includes(mode));
  const { app } = electron;
  app.setPath("userData", shared);
  app.setPath("sessionData", path.join(shared, `chromium-${mode}`));
  app.once("browser-window-created", (_event, window) => {
    void (async () => {
      const initial = mode === "a" ? 1 : mode === "b" ? 2 : 3;
      const expected = mode === "a" ? 2 : 3;
      const count = () =>
        window.webContents.executeJavaScript(
          "document.querySelectorAll('[data-chart-slot]').length",
        );
      await waitFor(async () => {
        try {
          return await window.webContents.executeJavaScript(
            "document.querySelector('[data-status]')?.textContent === 'Secure bridge connected'",
          );
        } catch {
          return false;
        }
      });
      await waitFor(async () => (await count()) === initial);
      if (mode !== "verify") {
        await window.webContents.executeJavaScript(
          "document.querySelector('.workspace-add').click()",
        );
        await waitFor(async () => (await count()) === expected);
        await waitFor(async () => {
          const saved = await window.webContents.executeJavaScript(
            "globalThis.ercChart.flushWorkspace().then(() => globalThis.ercChart.loadWorkspace())",
          );
          return saved?.tabs[0]?.chartSlots.length === expected;
        });
      }
      const reloaded = new Promise((resolve) =>
        window.webContents.once("did-finish-load", resolve),
      );
      window.webContents.reload();
      await reloaded;
      await waitFor(async () => (await count()) === expected);
      const security = await window.webContents.executeJavaScript(
        "[typeof globalThis.process, typeof globalThis.require]",
      );
      assert.deepEqual(security, ["undefined", "undefined"]);
      console.log(marker);
      app.quit();
    })().catch((error) => {
      console.error(error);
      app.exit(1);
    });
  });
  await import("../apps/desktop/dist/main.js");
} else {
  const { openStorageDatabase, saveWorkspace } =
    await import("../packages/storage/dist/index.js");
  const shared = await mkdtemp(path.join(os.tmpdir(), "erc-shared-storage-"));
  const databasePath = path.join(shared, "erc-chart.sqlite");
  const workspace = {
    schemaVersion: 1,
    id: "last-workspace",
    name: "Canonical fixture",
    activeTabId: "tab-1",
    tabs: [
      {
        id: "tab-1",
        title: "Chart 1",
        layout: "grid-1",
        chartSlots: [
          {
            id: "tab-1-chart-1",
            providerProfileId: "local-default",
            instrumentId: "UNCONFIGURED",
            timeframeSeconds: 60,
            chartType: "candlestick",
            indicators: [],
          },
        ],
      },
    ],
    savedAtMs: 1,
  };
  const configuration = (mode) => ({
    executable: electron,
    args: [
      `--user-data-dir=${path.join(shared, `chromium-${mode}`)}`,
      import.meta.filename,
      `--phase6-shared=${shared}`,
      `--phase6-mode=${mode}`,
    ],
    cwd: root,
    env: process.env,
    timeoutMs: 25_000,
    readyMarker: marker,
  });
  const inspectCanonical = async (expectedCharts) => {
    const database = await openStorageDatabase(databasePath);
    try {
      const rows = database
        .prepare(
          "SELECT id, instance_id, document_json FROM workspaces ORDER BY id",
        )
        .all();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, "last-workspace");
      assert.equal(
        JSON.parse(rows[0].document_json).tabs[0].chartSlots.length,
        expectedCharts,
      );
      return rows[0];
    } finally {
      database.close();
    }
  };
  try {
    await Promise.all(
      ["a", "b", "verify"].map((mode) =>
        mkdir(path.join(shared, `chromium-${mode}`)),
      ),
    );
    const setup = await openStorageDatabase(databasePath);
    try {
      saveWorkspace(setup, workspace, "instance:legacy");
    } finally {
      setup.close();
    }

    await runElectronProcess(configuration("a"));
    await inspectCanonical(2);

    await runElectronProcess(configuration("b"));
    await inspectCanonical(3);
    await runElectronProcess(configuration("verify"));
    await inspectCanonical(3);
    console.log(
      "Shared SQLite: one canonical workspace, automatic restart restore, overwrite passed.",
    );
  } finally {
    await rm(shared, { recursive: true, force: true });
  }
}
