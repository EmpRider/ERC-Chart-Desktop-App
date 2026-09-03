import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { startDesktopApplication } from "../dist/index.js";

const paths = {
  preloadPath: "/runtime/preload.cjs",
  rendererRootPath: "/runtime",
  rendererEntryUrl: "erc-app://app/index.html",
  dataUtilityPath: "/runtime/data-utility.js",
  providerUtilityPath: "/runtime/provider-utility.js",
};

const workspace = {
  schemaVersion: 1,
  id: "last-workspace",
  name: "Last workspace",
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

function createAdapters() {
  const handlers = {};
  const removed = [];
  const sender = { url: "erc-app://app/index.html", isMainFrame: true };
  return {
    handlers,
    removed,
    sender,
    adapters: {
      app: {
        platform: "win32",
        whenReady: async () => undefined,
        onActivate: () => undefined,
        onWindowAllClosed: () => undefined,
        quit: () => undefined,
      },
      registerRuntimeInfoHandler(handler) {
        handlers.runtime = handler;
        return () => removed.push("runtime");
      },
      registerWorkspaceLoadHandler(handler) {
        handlers.load = handler;
        return () => removed.push("load");
      },
      registerWorkspaceSaveHandler(handler) {
        handlers.save = handler;
        return () => removed.push("save");
      },
      registerRendererProtocol: async () => () => undefined,
      createWindow: () => ({
        loadURL: async () => undefined,
        flushWorkspace: async () => undefined,
        show: () => undefined,
        destroy: () => undefined,
        isDestroyed: () => false,
      }),
      dataUtility: {
        start: async () => undefined,
        shutdown: async () => undefined,
      },
      providerUtilities: {
        start: async () => undefined,
        shutdown: async () => undefined,
        shutdownAll: async () => undefined,
      },
      workspacePersistence: {
        load: async () => workspace,
        save: async () => undefined,
        flush: async () => undefined,
        close: async () => undefined,
      },
    },
  };
}

test("registers trusted workspace load and save IPC", async () => {
  const fixture = createAdapters();
  const controller = await startDesktopApplication(fixture.adapters, paths);

  assert.deepEqual(fixture.handlers.runtime(fixture.sender), {
    ipcContractVersion,
    applicationName: "ERC Chart",
  });
  assert.deepEqual(await fixture.handlers.load(fixture.sender), workspace);
  await assert.doesNotReject(fixture.handlers.save(fixture.sender, workspace));
  await assert.rejects(
    fixture.handlers.load({ url: "https://example.com", isMainFrame: true }),
    new Error("Unauthorized IPC sender."),
  );

  await controller.shutdown();
  assert.deepEqual(fixture.removed.sort(), ["load", "runtime", "save"]);
});

test("rejects malformed save payload before persistence", async () => {
  const fixture = createAdapters();
  let saveCount = 0;
  fixture.adapters.workspacePersistence.save = async () => {
    saveCount += 1;
  };
  const controller = await startDesktopApplication(fixture.adapters, paths);

  await assert.rejects(
    fixture.handlers.save(fixture.sender, { private: "invalid" }),
    new Error("Invalid workspace save request."),
  );
  assert.equal(saveCount, 0);
  await controller.shutdown();
});
