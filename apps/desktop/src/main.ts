import nodeProcess from "node:process";
import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  protocol,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import {
  createUtilitySupervisor,
  startDesktopApplication,
  type DesktopApplicationController,
  type SecureWindowOptions,
  type UtilityChild,
} from "@erc-chart/electron-main";
import { runtimeInfoChannel } from "@erc-chart/contracts";
import {
  finishDesktopSmoke,
  launchDesktopMainWithProtocol,
} from "./launcher.js";
import { resolveDesktopArtifacts, validateDesktopArtifacts } from "./paths.js";
import { installRendererProtocol } from "./protocol.js";

interface SmokeResult {
  readonly ready: boolean;
  readonly processType: string;
  readonly requireType: string;
}

function adaptUtilityChild(child: UtilityProcess): UtilityChild {
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
const smokeMode = nodeProcess.argv.includes("--erc-chart-smoke");
const reportSmokeStage = (stage: string): void => {
  if (smokeMode) console.log(`ERC_CHART_SMOKE_STAGE ${stage}`);
};
let resolveController: (
  controller: DesktopApplicationController,
) => void = (): void => undefined;
const controllerReady = new Promise<DesktopApplicationController>((resolve) => {
  resolveController = resolve;
});

const dataUtility = createUtilitySupervisor({
  spawn: (entryPath, args): UtilityChild =>
    adaptUtilityChild(
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

function createWindow(options: SecureWindowOptions): BrowserWindow {
  reportSmokeStage("window-created");
  const window = new BrowserWindow(options);
  if (smokeMode) {
    window.webContents.once("did-finish-load", () => {
      reportSmokeStage("renderer-loaded");
      void (async (): Promise<void> => {
        const result: unknown = await window.webContents.executeJavaScript(`
          new Promise((resolve) => {
            const inspect = () => {
              const status = document.querySelector('[data-status]')?.textContent;
              if (status !== 'Secure bridge connected') return false;
              resolve({
                ready: true,
                processType: typeof globalThis.process,
                requireType: typeof globalThis.require
              });
              return true;
            };
            if (inspect()) return;
            const observer = new MutationObserver(() => {
              if (inspect()) observer.disconnect();
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
        console.log("ERC_CHART_SMOKE_READY");
        await controller.shutdown();
        app.exit(0);
      })().catch(() => {
        void finishDesktopSmoke(controllerReady, 1, (exitCode) =>
          app.exit(exitCode),
        ).catch(() => undefined);
      });
    });
  }
  return window;
}

async function startDesktopMain(): Promise<void> {
  reportSmokeStage("artifacts-validating");
  await validateDesktopArtifacts(paths);
  reportSmokeStage("artifacts-valid");
  const controller = await startDesktopApplication(
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
        ipcMain.handle(runtimeInfoChannel, handler);
        return (): void => ipcMain.removeHandler(runtimeInfoChannel);
      },
      registerRendererProtocol: (rootPath): Promise<() => void> =>
        installRendererProtocol(
          {
            handle: (scheme, handler): void => protocol.handle(scheme, handler),
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
    },
    paths,
  );
  resolveController(controller);

  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting || smokeMode) return;
    event.preventDefault();
    quitting = true;
    void controller
      .shutdown()
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
