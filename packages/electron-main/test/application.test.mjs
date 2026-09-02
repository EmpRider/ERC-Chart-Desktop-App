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
  let providerShutdownAllCount = 0;
  const providerStartCalls = [];
  const providerReconfigureCalls = [];
  const providerShutdownCalls = [];
  let quitCount = 0;
  let loadUrlError;
  let shutdownError;

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
    registerWorkspaceLoadHandler() {
      events.push("workspace-load:register");
      return () => events.push("workspace-load:remove");
    },
    registerWorkspaceSaveHandler() {
      events.push("workspace-save:register");
      return () => events.push("workspace-save:remove");
    },
    async registerRendererProtocol(rootPath) {
      events.push(`protocol:register:${rootPath}`);
      return () => events.push("protocol:remove");
    },
    createWindow(options) {
      events.push("window:create");
      const window = {
        destroyed: false,
        options,
        shown: false,
        async loadURL(url) {
          events.push(`window:load:${url}`);
          if (loadUrlError !== undefined) throw loadUrlError;
        },
        async flushWorkspace() {
          events.push("window:flush");
        },
        show() {
          this.shown = true;
          events.push("window:show");
        },
        destroy() {
          this.destroyed = true;
          events.push("window:destroy");
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
        if (shutdownError !== undefined) throw shutdownError;
      },
    },
    providerUtilities: {
      async start(providerProfileId, entryPath, launch) {
        providerStartCalls.push({ providerProfileId, entryPath, launch });
      },
      async reconfigure(providerProfileId, settings) {
        providerReconfigureCalls.push({ providerProfileId, settings });
        return {
          impact: "restart",
          settings,
          changedKeys: Object.keys(settings),
        };
      },
      async shutdown(providerProfileId) {
        providerShutdownCalls.push(providerProfileId);
      },
      async shutdownAll() {
        providerShutdownAllCount += 1;
      },
    },
    workspacePersistence: {
      async load() {
        return null;
      },
      async save() {
        return undefined;
      },
      async flush() {
        events.push("workspace:flush");
      },
      async close() {
        events.push("workspace:close");
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
    getProviderShutdownAllCount: () => providerShutdownAllCount,
    providerStartCalls,
    providerReconfigureCalls,
    providerShutdownCalls,
    getQuitCount: () => quitCount,
    setLoadUrlError: (error) => {
      loadUrlError = error;
    },
    setShutdownError: (error) => {
      shutdownError = error;
    },
  };
}

const paths = {
  preloadPath: "/runtime/preload.cjs",
  rendererRootPath: "/runtime",
  rendererEntryUrl: "erc-app://app/index.html",
  dataUtilityPath: "/runtime/data-utility.js",
  providerUtilityPath: "/runtime/provider-utility.js",
};

test("registers fixed IPC before loading one secure window", async () => {
  const fixture = createFixture();

  await startDesktopApplication(fixture.adapters, paths);

  assert.deepEqual(fixture.events, [
    "ipc:register",
    "workspace-load:register",
    "workspace-save:register",
    "app:ready",
    "protocol:register:/runtime",
    "data:start:/runtime/data-utility.js:0",
    "window:create",
    "window:load:erc-app://app/index.html",
    "window:show",
  ]);
  assert.deepEqual(
    fixture.getRuntimeInfoHandler()({
      url: "erc-app://app/index.html",
      isMainFrame: true,
    }),
    {
      ipcContractVersion,
      applicationName: "ERC Chart",
    },
  );
  assert.throws(
    () =>
      fixture.getRuntimeInfoHandler()({
        url: "https://example.com/",
        isMainFrame: true,
      }),
    new Error("Unauthorized IPC sender."),
  );
  assert.deepEqual(fixture.windows[0].options.webPreferences, {
    preload: "/runtime/preload.cjs",
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
  });
});

test("keeps provider utilities idle at boot and exposes profile-scoped lifecycle", async () => {
  const fixture = createFixture();
  const controller = await startDesktopApplication(fixture.adapters, paths);
  const launch = { pluginId: "com.example.provider" };

  assert.deepEqual(fixture.providerStartCalls, []);
  await controller.startProviderProfile("profile-a", launch);
  const changed = await controller.reconfigureProviderProfile("profile-a", {
    region: "eu",
  });
  await controller.stopProviderProfile("profile-a");

  assert.deepEqual(fixture.providerStartCalls, [
    {
      providerProfileId: "profile-a",
      entryPath: "/runtime/provider-utility.js",
      launch,
    },
  ]);
  assert.deepEqual(fixture.providerReconfigureCalls, [
    { providerProfileId: "profile-a", settings: { region: "eu" } },
  ]);
  assert.deepEqual(changed, {
    impact: "restart",
    settings: { region: "eu" },
    changedKeys: ["region"],
  });
  assert.deepEqual(fixture.providerShutdownCalls, ["profile-a"]);
  await controller.shutdown();
  assert.equal(fixture.getProviderShutdownAllCount(), 1);
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
  assert.equal(fixture.getProviderShutdownAllCount(), 1);
  assert.equal(
    fixture.events.filter((event) => event === "ipc:remove").length,
    1,
  );
  assert.equal(
    fixture.events.filter((event) => event === "protocol:remove").length,
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
  assert.equal(
    fixture.events.filter((event) => event === "protocol:remove").length,
    1,
  );
  assert.equal(fixture.windows.length, 0);
});

test("cleans a failed initial window load without exposing partial UI", async () => {
  const fixture = createFixture();
  fixture.setLoadUrlError(new Error("private path /runtime/index.html"));

  await assert.rejects(
    startDesktopApplication(fixture.adapters, paths),
    new Error("Desktop application failed to start."),
  );

  assert.equal(fixture.getShutdownCount(), 1);
  assert.equal(
    fixture.events.filter((event) => event === "ipc:remove").length,
    1,
  );
  assert.equal(fixture.windows.length, 1);
  assert.equal(fixture.windows[0].shown, false);
  assert.equal(fixture.windows[0].destroyed, true);
});

test("contains failed activation loads and permits a later retry", async () => {
  const fixture = createFixture();
  const controller = await startDesktopApplication(fixture.adapters, paths);
  fixture.windows[0].destroyed = true;
  fixture.setLoadUrlError(new Error("activation load failed"));

  await assert.doesNotReject(fixture.handlers.activate());

  assert.equal(fixture.windows.length, 2);
  assert.equal(fixture.windows[1].shown, false);
  assert.equal(fixture.windows[1].destroyed, true);

  fixture.setLoadUrlError(undefined);
  await fixture.handlers.activate();

  assert.equal(fixture.windows.length, 3);
  assert.equal(fixture.windows[2].shown, true);
  await controller.shutdown();
});

test("removes IPC registration when utility shutdown rejects", async () => {
  const fixture = createFixture();
  const controller = await startDesktopApplication(fixture.adapters, paths);
  fixture.setShutdownError(new Error("utility shutdown failed"));

  await assert.rejects(
    controller.shutdown(),
    new Error("utility shutdown failed"),
  );

  assert.equal(fixture.getShutdownCount(), 1);
  assert.equal(
    fixture.events.filter((event) => event === "ipc:remove").length,
    1,
  );
});
