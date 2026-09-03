import nodeProcess from "node:process";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import {
  createWindowsGenericCredentialManager,
  createUtilitySupervisor,
  assertTrustedIpcSender,
  startDesktopApplication,
  type DesktopApplicationController,
  type SecureWindowOptions,
  type UtilityChild,
} from "@erc-chart/electron-main";
import {
  createProviderUtilitySupervisor,
  type ProviderUtilityChild,
  type ProviderUtilityLaunchDescriptor,
} from "@erc-chart/provider-runtime";
import {
  createProviderDataService,
  type ProviderDataService,
} from "@erc-chart/data-service";
import {
  providerImportApproveChannel,
  providerImportCancelChannel,
  providerImportPreviewChannel,
  isProviderImportCredentialValues,
  runtimeInfoChannel,
  workspaceLoadChannel,
  workspaceSaveChannel,
  type PersistedWorkspace,
} from "@erc-chart/contracts";
import {
  loadWorkspace,
  openStorageDatabase,
  saveWorkspace,
} from "@erc-chart/storage";
import {
  finishDesktopSmoke,
  launchDesktopMainWithProtocol,
} from "./launcher.js";
import { resolveDesktopArtifacts, validateDesktopArtifacts } from "./paths.js";
import { installRendererProtocol } from "./protocol.js";
import { createDesktopProviderHostBroker } from "./provider-host-broker.js";
import { createProviderImportService } from "./provider-import-service.js";
import { installWindowSecurity } from "./window-security.js";

interface SmokeResult {
  readonly ready: boolean;
  readonly processType: string;
  readonly requireType: string;
}

function adaptUtilityChild<Message>(child: UtilityProcess): {
  readonly postMessage: (message: Message) => void;
  readonly kill: () => void;
  readonly onMessage: (listener: (message: unknown) => void) => () => void;
  readonly onExit: (listener: (code: number | null) => void) => () => void;
} {
  return {
    postMessage: (message): void => child.postMessage(message),
    kill: (): void => {
      child.kill();
    },
    onMessage: (listener): (() => void) => {
      child.on("message", listener);
      return (): void => {
        child.off("message", listener);
      };
    },
    onExit: (listener): (() => void) => {
      child.on("exit", listener);
      return (): void => {
        child.off("exit", listener);
      };
    },
  };
}

function isSmokeResult(value: unknown): value is SmokeResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    result.ready === true &&
    result.processType === "undefined" &&
    result.requireType === "undefined"
  );
}

const paths = resolveDesktopArtifacts(import.meta.url);
const lastWorkspaceId = "last-workspace";
const desktopInstanceId = "desktop-main";
const smokeMode = nodeProcess.argv.includes("--erc-chart-smoke");
const workspaceSeedMode = nodeProcess.argv.includes(
  "--erc-chart-workspace-seed",
);
const workspaceVerifyMode = nodeProcess.argv.includes(
  "--erc-chart-workspace-verify",
);
const reportSmokeStage = (stage: string): void => {
  if (smokeMode) console.log(`ERC_CHART_SMOKE_STAGE ${stage}`);
};
let resolveController: (
  controller: DesktopApplicationController<ProviderUtilityLaunchDescriptor>,
) => void = (): void => undefined;
const controllerReady = new Promise<
  DesktopApplicationController<ProviderUtilityLaunchDescriptor>
>((resolve) => {
  resolveController = resolve;
});

const dataUtility = createUtilitySupervisor({
  spawn: (entryPath, args): UtilityChild =>
    adaptUtilityChild<Parameters<UtilityChild["postMessage"]>[0]>(
      utilityProcess.fork(entryPath, [...args], {
        serviceName: "ERC Chart Data Service",
        stdio: "ignore",
      }),
    ),
  scheduler: {
    setTimeout: (callback, delayMs): NodeJS.Timeout =>
      setTimeout(callback, delayMs),
    clearTimeout: (timer): void => clearTimeout(timer as NodeJS.Timeout),
  },
  startupTimeoutMs: 5_000,
  shutdownTimeoutMs: 2_000,
  onUnavailable: (): void => {
    console.error("ERC Chart data utility unavailable.");
  },
});
const providerLaunches = new Map<string, ProviderUtilityLaunchDescriptor>();
const providerCredentialManager = createWindowsGenericCredentialManager();
const providerDataReference: { current: ProviderDataService | undefined } = {
  current: undefined,
};
const providerUtilities = createProviderUtilitySupervisor({
  spawn: (entryPath, args): ProviderUtilityChild =>
    adaptUtilityChild<Parameters<ProviderUtilityChild["postMessage"]>[0]>(
      utilityProcess.fork(entryPath, [...args], {
        serviceName: "ERC Chart Provider",
        stdio: "ignore",
        env: {},
      }),
    ),
  scheduler: {
    setTimeout: (callback, delayMs): NodeJS.Timeout =>
      setTimeout(callback, delayMs),
    clearTimeout: (timer): void => clearTimeout(timer as NodeJS.Timeout),
  },
  startupTimeoutMs: 5_000,
  shutdownTimeoutMs: 2_000,
  onUnavailable: (providerProfileId, code): void => {
    providerLaunches.delete(providerProfileId);
    void providerDataReference.current
      ?.invalidateProfile(providerProfileId)
      .catch(() => undefined);
    console.error(`ERC Chart provider utility unavailable (${code}).`);
  },
  onProfileInvalidated: (providerProfileId): Promise<void> | undefined =>
    providerDataReference.current?.invalidateProfile(providerProfileId),
  onProfileRestored: (providerProfileId): Promise<void> | undefined =>
    providerDataReference.current?.restoreProfile(providerProfileId),
  hostBroker: createDesktopProviderHostBroker({
    launches: providerLaunches,
    credentialManager: providerCredentialManager,
    fetch: (url, init): Promise<Response> => net.fetch(url, init),
    log: (providerProfileId, level, code, metadata): void => {
      const writer =
        level === "error"
          ? console.error
          : level === "warn"
            ? console.warn
            : console.log;
      writer(
        `ERC Chart provider ${providerProfileId} ${code}.`,
        metadata ?? {},
      );
    },
    reportStatus: (providerProfileId, status): void => {
      console.log(`ERC Chart provider ${providerProfileId} status ${status}.`);
    },
    now: () => Date.now(),
  }),
});
const providerData = createProviderDataService(providerUtilities);
providerDataReference.current = providerData;

function createWindow(options: SecureWindowOptions): {
  loadURL: (url: string) => Promise<void>;
  flushWorkspace: () => Promise<void>;
  show: () => void;
  destroy: () => void;
  isDestroyed: () => boolean;
} {
  reportSmokeStage("window-created");
  const window = new BrowserWindow(options);
  installWindowSecurity({
    onWillNavigate: (handler): void => {
      window.webContents.on("will-navigate", (event, url) =>
        handler(event, url),
      );
    },
    setWindowOpenHandler: (handler): void => {
      window.webContents.setWindowOpenHandler(handler);
    },
  });
  if (smokeMode) {
    window.webContents.once("did-finish-load", () => {
      reportSmokeStage("renderer-loaded");
      void (async (): Promise<void> => {
        const result: unknown = await window.webContents.executeJavaScript(`
          new Promise((resolve) => {
            let processing = false;
            const inspect = async () => {
              const status = document.querySelector('[data-status]')?.textContent;
              if (status !== 'Secure bridge connected') return false;
              if (processing) return true;
              processing = true;
              const add = document.querySelector('.workspace-add');
              if (${workspaceSeedMode ? "true" : "false"}) {
                if (!(add instanceof HTMLButtonElement)) return false;
                add.click();
                await new Promise((done) => setTimeout(done, 300));
                document.querySelector('.workspace-add')?.click();
                await new Promise((done) => setTimeout(done, 600));
                const slotCount = document.querySelectorAll('[data-chart-slot]').length;
                resolve({
                  ready: slotCount === 3,
                  processType: typeof globalThis.process,
                  requireType: typeof globalThis.require
                });
                return true;
              }
              if (${workspaceVerifyMode ? "true" : "false"} && document.querySelectorAll('[data-chart-slot]').length !== 3) return false;
              resolve({
                ready: true,
                processType: typeof globalThis.process,
                requireType: typeof globalThis.require
              });
              return true;
            };
            void inspect().then((matched) => {
              if (matched) return;
              const observer = new MutationObserver(() => {
                void inspect().then((found) => {
                  if (found) observer.disconnect();
                });
              });
              observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                characterData: true
              });
              setTimeout(() => {
                observer.disconnect();
                resolve({ ready: false });
              }, 5000);
            });
          });
        `);
        if (!isSmokeResult(result)) {
          reportSmokeStage("renderer-invalid");
          try {
            await finishDesktopSmoke(controllerReady, 1, (exitCode) =>
              app.exit(exitCode),
            );
          } catch {
            // The helper exits in a finally block after bounded cleanup.
          }
          return;
        }
        reportSmokeStage("renderer-ready");
        const controller = await controllerReady;
        console.log(
          workspaceSeedMode
            ? "ERC_CHART_WORKSPACE_SEEDED"
            : workspaceVerifyMode
              ? "ERC_CHART_WORKSPACE_RESTORED"
              : "ERC_CHART_SMOKE_READY",
        );
        if (workspaceSeedMode) {
          app.quit();
          return;
        }
        await controller.shutdown();
        app.exit(0);
      })().catch(() => {
        void finishDesktopSmoke(controllerReady, 1, (exitCode) =>
          app.exit(exitCode),
        ).catch(() => undefined);
      });
    });
  }
  return {
    loadURL: (url: string): Promise<void> => window.loadURL(url),
    flushWorkspace: async (): Promise<void> => {
      if (window.isDestroyed()) return;
      await window.webContents.executeJavaScript(
        "globalThis.ercChart?.flushWorkspace?.()",
      );
    },
    show: (): void => window.show(),
    destroy: (): void => window.destroy(),
    isDestroyed: (): boolean => window.isDestroyed(),
  };
}

async function startDesktopMain(): Promise<void> {
  reportSmokeStage("artifacts-validating");
  await validateDesktopArtifacts(paths);
  reportSmokeStage("artifacts-valid");
  const userDataSwitch = smokeMode
    ? app.commandLine.getSwitchValue("erc-chart-user-data-path")
    : "";
  const userDataArgument = smokeMode
    ? [
        ...nodeProcess.argv,
        ...(userDataSwitch === ""
          ? []
          : [`--erc-chart-user-data-path=${userDataSwitch}`]),
      ].find((argument) => argument.startsWith("--erc-chart-user-data-path="))
    : undefined;
  const userDataRoot =
    userDataArgument?.slice("--erc-chart-user-data-path=".length) ??
    app.getPath("userData");
  const workspaceDatabase = await openStorageDatabase(
    path.join(userDataRoot, "erc-chart.sqlite"),
  );
  const senderFromEvent = (event: Electron.IpcMainInvokeEvent) => {
    const senderFrame = event.senderFrame;
    return senderFrame === null
      ? undefined
      : {
          url: senderFrame.url,
          isMainFrame: senderFrame.parent === null,
        };
  };
  const controller =
    await startDesktopApplication<ProviderUtilityLaunchDescriptor>(
      {
        app: {
          platform: nodeProcess.platform,
          whenReady: async (): Promise<void> => {
            await app.whenReady();
            reportSmokeStage("app-ready");
          },
          onActivate: (handler): void => {
            app.on("activate", handler);
          },
          onWindowAllClosed: (handler): void => {
            app.on("window-all-closed", handler);
          },
          quit: (): void => app.quit(),
        },
        registerRuntimeInfoHandler: (handler): (() => void) => {
          ipcMain.handle(runtimeInfoChannel, (event) =>
            handler(senderFromEvent(event)),
          );
          return (): void => ipcMain.removeHandler(runtimeInfoChannel);
        },
        registerWorkspaceLoadHandler: (handler): (() => void) => {
          ipcMain.handle(workspaceLoadChannel, (event) =>
            handler(senderFromEvent(event)),
          );
          return (): void => ipcMain.removeHandler(workspaceLoadChannel);
        },
        registerWorkspaceSaveHandler: (handler): (() => void) => {
          ipcMain.handle(workspaceSaveChannel, (event, workspace: unknown) =>
            handler(senderFromEvent(event), workspace).then(() => true),
          );
          return (): void => ipcMain.removeHandler(workspaceSaveChannel);
        },
        registerRendererProtocol: (rootPath): Promise<() => void> =>
          installRendererProtocol(
            {
              handle: (scheme, handler): void =>
                protocol.handle(scheme, handler),
              unhandle: (scheme): void => protocol.unhandle(scheme),
              fetch: (url): Promise<Response> => net.fetch(url),
            },
            rootPath,
          ),
        createWindow,
        dataUtility: {
          start: async (entryPath, args): Promise<void> => {
            await dataUtility.start(entryPath, args);
            reportSmokeStage("data-utility-ready");
          },
          shutdown: (): Promise<void> => dataUtility.shutdown(),
        },
        providerUtilities: {
          start: async (
            providerProfileId,
            entryPath,
            launch,
          ): Promise<void> => {
            providerLaunches.set(providerProfileId, launch);
            try {
              await providerUtilities.start(
                providerProfileId,
                entryPath,
                launch,
              );
            } catch (error) {
              providerLaunches.delete(providerProfileId);
              throw error;
            }
          },
          reconfigure: async (providerProfileId, settings) => {
            const previousLaunch = providerLaunches.get(providerProfileId);
            if (previousLaunch === undefined)
              throw new Error("Provider profile is not active.");
            const result = await providerUtilities.reconfigure(
              providerProfileId,
              settings,
            );
            providerLaunches.set(providerProfileId, {
              ...previousLaunch,
              settings: result.settings,
            });
            return result;
          },
          shutdown: async (providerProfileId): Promise<void> => {
            try {
              await providerData.invalidateProfile(providerProfileId);
              await providerUtilities.shutdown(providerProfileId);
            } finally {
              providerLaunches.delete(providerProfileId);
            }
          },
          shutdownAll: async (): Promise<void> => {
            try {
              await providerData.shutdown();
              await providerUtilities.shutdownAll();
            } finally {
              providerLaunches.clear();
            }
          },
        },
        providerData,
        workspacePersistence: {
          load: async (): Promise<PersistedWorkspace | null> =>
            loadWorkspace(workspaceDatabase, lastWorkspaceId) ?? null,
          save: async (workspace): Promise<void> => {
            saveWorkspace(workspaceDatabase, workspace, desktopInstanceId);
          },
          flush: async (): Promise<void> => undefined,
          close: async (): Promise<void> => {
            workspaceDatabase.close();
          },
        },
      },
      paths,
    );
  resolveController(controller);

  const providerImportService = createProviderImportService({
    database: workspaceDatabase,
    controller,
    credentialManager: providerCredentialManager,
    stagingRoot: path.join(userDataRoot, "provider-staging"),
    installationRoot: path.join(userDataRoot, "provider-plugins"),
  });
  ipcMain.handle(providerImportPreviewChannel, async (event) => {
    assertTrustedIpcSender(senderFromEvent(event));
    const selection = await dialog.showOpenDialog({
      title: "Import ERC Chart provider",
      properties: ["openDirectory"],
    });
    const selectedPath = selection.filePaths[0];
    if (selection.canceled || selectedPath === undefined) return null;
    return providerImportService.preview({
      kind: "folder",
      path: selectedPath,
    });
  });
  ipcMain.handle(
    providerImportApproveChannel,
    async (event, requestId: unknown, credentials: unknown) => {
      assertTrustedIpcSender(senderFromEvent(event));
      if (
        typeof requestId !== "string" ||
        !isProviderImportCredentialValues(credentials)
      ) {
        throw new Error("Provider import request is invalid.");
      }
      return providerImportService.approve(requestId, credentials);
    },
  );
  ipcMain.handle(
    providerImportCancelChannel,
    async (event, requestId: unknown) => {
      assertTrustedIpcSender(senderFromEvent(event));
      if (typeof requestId !== "string") {
        throw new Error("Provider import request is invalid.");
      }
      await providerImportService.cancel(requestId);
      return true;
    },
  );

  const removeProviderImportHandlers = (): void => {
    ipcMain.removeHandler(providerImportPreviewChannel);
    ipcMain.removeHandler(providerImportApproveChannel);
    ipcMain.removeHandler(providerImportCancelChannel);
  };

  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting || (smokeMode && !workspaceSeedMode)) return;
    event.preventDefault();
    quitting = true;
    void providerImportService
      .shutdown()
      .then(() => controller.shutdown())
      .finally(removeProviderImportHandlers)
      .then(() => app.quit())
      .catch(() => app.exit(1));
  });
}

launchDesktopMainWithProtocol(
  (schemes) => protocol.registerSchemesAsPrivileged(schemes),
  startDesktopMain,
  (error) => {
    console.error("ERC Chart failed to start.", error);
    app.exit(1);
  },
);
