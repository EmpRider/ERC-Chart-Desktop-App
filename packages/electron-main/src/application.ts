import { ipcContractVersion, type RuntimeInfo } from "@erc-chart/contracts";
import { assertTrustedIpcSender, type DesktopIpcSender } from "./security.js";
import { secureWindowOptions, type SecureWindowOptions } from "./window.js";

export interface DesktopArtifactPaths {
  readonly preloadPath: string;
  readonly rendererRootPath: string;
  readonly rendererEntryUrl: string;
  readonly dataUtilityPath: string;
  readonly providerUtilityPath: string;
}

export interface DesktopWindow {
  readonly loadURL: (url: string) => Promise<void>;
  readonly show: () => void;
  readonly destroy: () => void;
  readonly isDestroyed: () => boolean;
}

export interface DesktopAppAdapter {
  readonly platform: string;
  readonly whenReady: () => Promise<void>;
  readonly onActivate: (handler: () => void | Promise<void>) => void;
  readonly onWindowAllClosed: (handler: () => void) => void;
  readonly quit: () => void;
}

export interface DesktopApplicationAdapters {
  readonly app: DesktopAppAdapter;
  readonly registerRuntimeInfoHandler: (
    handler: (sender: DesktopIpcSender | undefined) => RuntimeInfo,
  ) => () => void;
  readonly registerRendererProtocol: (rootPath: string) => Promise<() => void>;
  readonly createWindow: (options: SecureWindowOptions) => DesktopWindow;
  readonly dataUtility: {
    readonly start: (
      entryPath: string,
      args?: readonly string[],
    ) => Promise<void>;
    readonly shutdown: () => Promise<void>;
  };
}

export interface DesktopApplicationController {
  readonly shutdown: () => Promise<void>;
}

export async function startDesktopApplication(
  adapters: DesktopApplicationAdapters,
  paths: DesktopArtifactPaths,
): Promise<DesktopApplicationController> {
  let currentWindow: DesktopWindow | undefined;
  let stopped = false;
  let removeRendererProtocol: (() => void) | undefined;

  const removeRuntimeInfoHandler = adapters.registerRuntimeInfoHandler(
    (sender): RuntimeInfo => {
      assertTrustedIpcSender(sender);
      return {
        ipcContractVersion,
        applicationName: "ERC Chart",
      };
    },
  );

  const openWindow = async (): Promise<void> => {
    const window = adapters.createWindow(
      secureWindowOptions(paths.preloadPath),
    );
    currentWindow = window;
    try {
      await window.loadURL(paths.rendererEntryUrl);
      window.show();
    } catch (error) {
      window.destroy();
      if (currentWindow === window) currentWindow = undefined;
      throw error;
    }
  };

  adapters.app.onActivate(async (): Promise<void> => {
    if (currentWindow === undefined || currentWindow.isDestroyed()) {
      try {
        await openWindow();
      } catch {
        currentWindow = undefined;
      }
    }
  });
  adapters.app.onWindowAllClosed((): void => {
    if (adapters.app.platform !== "darwin") adapters.app.quit();
  });

  try {
    await adapters.app.whenReady();
    removeRendererProtocol = await adapters.registerRendererProtocol(
      paths.rendererRootPath,
    );
    await adapters.dataUtility.start(paths.dataUtilityPath, []);
    await openWindow();
  } catch {
    try {
      await adapters.dataUtility.shutdown();
    } catch {
      // Cleanup failure must not expose the original startup error.
    }
    try {
      removeRendererProtocol?.();
    } catch {
      // Cleanup failure must not expose the original startup error.
    }
    removeRuntimeInfoHandler();
    throw new Error("Desktop application failed to start.");
  }

  return {
    shutdown: async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      try {
        await adapters.dataUtility.shutdown();
      } finally {
        try {
          removeRendererProtocol?.();
        } finally {
          removeRuntimeInfoHandler();
        }
      }
    },
  };
}
