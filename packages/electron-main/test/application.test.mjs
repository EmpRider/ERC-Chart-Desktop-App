import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { startDesktopApplication } from "../dist/index.js";

function createFixture(platform = "win32") {
  const events = [];
  const handlers = {};
  const windows = [];
  let runtimeInfoHandler;
  let shutdownCount = 0;
  let quitCount = 0;

  const adapters = {
    app: {
      platform,
      async whenReady() {
        events.push("app:ready");
      },
      onActivate(handler) {
        handlers.activate = handler;
      },
      onWindowAllClosed(handler) {
        handlers.windowAllClosed = handler;
      },
      quit() {
        quitCount += 1;
      },
    },
    registerRuntimeInfoHandler(handler) {
      events.push("ipc:register");
      runtimeInfoHandler = handler;
      return () => events.push("ipc:remove");
    },
    createWindow(options) {
      events.push("window:create");
      const window = {
        destroyed: false,
        options,
        async loadFile(filePath) {
          events.push(`window:load:${filePath}`);
        },
        show() {
          events.push("window:show");
        },
        isDestroyed() {
          return this.destroyed;
        },
      };
      windows.push(window);
      return window;
    },
    dataUtility: {
      async start(entryPath, args) {
        events.push(`data:start:${entryPath}:${args.length}`);
      },
      async shutdown() {
        shutdownCount += 1;
      },
      getStatus() {
        return "ready";
      },
    },
  };

  return {
    adapters,
    events,
    handlers,
    windows,
    getRuntimeInfoHandler: () => runtimeInfoHandler,
    getShutdownCount: () => shutdownCount,
    getQuitCount: () => quitCount,
  };
}

const paths = {
  preloadPath: "/runtime/preload.cjs",
  rendererHtmlPath: "/runtime/index.html",
  dataUtilityPath: "/runtime/data-utility.js",
  providerUtilityPath: "/runtime/provider-utility.js",
};

test("registers fixed IPC before loading one secure window", async () => {
  const fixture = createFixture();

  await startDesktopApplication(fixture.adapters, paths);

  assert.deepEqual(fixture.events, [
    "ipc:register",
    "app:ready",
    "data:start:/runtime/data-utility.js:0",
    "window:create",
    "window:load:/runtime/index.html",
    "window:show",
  ]);
  assert.deepEqual(fixture.getRuntimeInfoHandler()(), {
    ipcContractVersion,
    applicationName: "ERC Chart",
  });
  assert.deepEqual(fixture.windows[0].options.webPreferences, {
    preload: "/runtime/preload.cjs",
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
  });
});

test("recreates a missing window and quits only on non-macOS", async () => {
  const fixture = createFixture();
  await startDesktopApplication(fixture.adapters, paths);
  fixture.windows[0].destroyed = true;

  await fixture.handlers.activate();
  fixture.handlers.windowAllClosed();

  assert.equal(fixture.windows.length, 2);
  assert.equal(fixture.getQuitCount(), 1);

  const macFixture = createFixture("darwin");
  await startDesktopApplication(macFixture.adapters, paths);
  macFixture.handlers.windowAllClosed();
  assert.equal(macFixture.getQuitCount(), 0);
});

test("shuts down the data utility and IPC registration idempotently", async () => {
  const fixture = createFixture();
  const controller = await startDesktopApplication(fixture.adapters, paths);

  await controller.shutdown();
  await controller.shutdown();

  assert.equal(fixture.getShutdownCount(), 1);
  assert.equal(
    fixture.events.filter((event) => event === "ipc:remove").length,
    1,
  );
});

test("cleans partial startup and redacts the original failure", async () => {
  const fixture = createFixture();
  fixture.adapters.dataUtility.start = async () => {
    throw new Error("private path /runtime/data.js");
  };

  await assert.rejects(
    startDesktopApplication(fixture.adapters, paths),
    new Error("Desktop application failed to start."),
  );

  assert.equal(fixture.getShutdownCount(), 1);
  assert.equal(
    fixture.events.filter((event) => event === "ipc:remove").length,
    1,
  );
  assert.equal(fixture.windows.length, 0);
});
