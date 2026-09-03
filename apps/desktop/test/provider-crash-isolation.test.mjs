import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import { startDesktopApplication } from "@erc-chart/electron-main";
import { createProviderUtilitySupervisor } from "@erc-chart/provider-runtime";

function createProviderChild() {
  const messageListeners = new Set();
  const exitListeners = new Set();
  return {
    child: {
      postMessage() {
        return undefined;
      },
      kill() {
        return undefined;
      },
      onMessage(listener) {
        messageListeners.add(listener);
        return () => messageListeners.delete(listener);
      },
      onExit(listener) {
        exitListeners.add(listener);
        return () => exitListeners.delete(listener);
      },
    },
    emitMessage(message) {
      for (const listener of messageListeners) listener(message);
    },
    emitExit(code) {
      for (const listener of exitListeners) listener(code);
    },
  };
}

test("a provider utility crash leaves the renderer window alive", async () => {
  const children = [];
  const unavailable = [];
  const providerUtilities = createProviderUtilitySupervisor({
    spawn() {
      const fixture = createProviderChild();
      children.push(fixture);
      return fixture.child;
    },
    scheduler: {
      setTimeout(callback) {
        return { callback };
      },
      clearTimeout() {
        return undefined;
      },
    },
    startupTimeoutMs: 5_000,
    shutdownTimeoutMs: 2_000,
    onUnavailable(providerProfileId, code) {
      unavailable.push({ providerProfileId, code });
    },
  });
  const windows = [];
  let quitCount = 0;
  const controller = await startDesktopApplication(
    {
      app: {
        platform: "win32",
        whenReady: async () => undefined,
        onActivate() {
          return undefined;
        },
        onWindowAllClosed() {
          return undefined;
        },
        quit() {
          quitCount += 1;
        },
      },
      registerRuntimeInfoHandler: () => () => undefined,
      registerWorkspaceLoadHandler: () => () => undefined,
      registerWorkspaceSaveHandler: () => () => undefined,
      registerRendererProtocol: async () => () => undefined,
      createWindow() {
        const window = {
          shown: false,
          destroyed: false,
          loadURL: async () => undefined,
          flushWorkspace: async () => undefined,
          show() {
            this.shown = true;
          },
          destroy() {
            this.destroyed = true;
          },
          isDestroyed() {
            return this.destroyed;
          },
        };
        windows.push(window);
        return window;
      },
      dataUtility: {
        start: async () => undefined,
        shutdown: async () => undefined,
      },
      providerUtilities: {
        start: (providerProfileId, entryPath, launch) =>
          providerUtilities.start(providerProfileId, entryPath, launch),
        shutdown: (providerProfileId) =>
          providerUtilities.shutdown(providerProfileId),
        shutdownAll: () => providerUtilities.shutdownAll(),
      },
      workspacePersistence: {
        load: async () => null,
        save: async () => undefined,
        flush: async () => undefined,
        close: async () => undefined,
      },
    },
    {
      preloadPath: "/runtime/preload.cjs",
      rendererRootPath: "/runtime",
      rendererEntryUrl: "erc-app://app/index.html",
      dataUtilityPath: "/runtime/data.js",
      providerUtilityPath: "/runtime/provider.js",
    },
  );

  const started = controller.startProviderProfile("profile-a", {
    installationPath: "C:/erc/plugins/com.example.provider/1.0.0",
    entry: "dist/index.js",
    pluginId: "com.example.provider",
    version: "1.0.0",
    permissions: { network: [], credentials: [], storage: [] },
    settings: {},
  });
  children[0].emitMessage({
    type: "ready",
    contractVersion: ipcContractVersion,
  });
  await started;
  children[0].emitExit(7);

  assert.equal(providerUtilities.getStatus("profile-a"), "failed");
  assert.deepEqual(unavailable, [
    {
      providerProfileId: "profile-a",
      code: "PROVIDER_UTILITY_EXITED",
    },
  ]);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].shown, true);
  assert.equal(windows[0].destroyed, false);
  assert.equal(quitCount, 0);

  await controller.shutdown();
});
