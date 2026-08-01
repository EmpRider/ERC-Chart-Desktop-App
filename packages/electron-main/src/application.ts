import { ipcContractVersion, type RuntimeInfo } from "@erc-chart/contracts";
import { secureWindowOptions, type SecureWindowOptions } from "./window.js";
import type { UtilitySupervisor } from "./utility-supervisor.js";

export interface DesktopArtifactPaths {
  readonly preloadPath: string;
  readonly rendererHtmlPath: string;
  readonly dataUtilityPath: string;
  readonly providerUtilityPath: string;
}

export interface DesktopWindow {
  readonly loadFile: (filePath: string) => Promise<void>;
  readonly show: () => void;
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
    handler: () => RuntimeInfo,
  ) => () => void;
  readonly createWindow: (options: SecureWindowOptions) => DesktopWindow;
  readonly dataUtility: UtilitySupervisor;
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

  const removeRuntimeInfoHandler = adapters.registerRuntimeInfoHandler(
    (): RuntimeInfo => ({
      ipcContractVersion,
      applicationName: "ERC Chart",
    }),
  );

  const openWindow = async (): Promise<void> => {
    const window = adapters.createWindow(
      secureWindowOptions(paths.preloadPath),
    );
    currentWindow = window;
    await window.loadFile(paths.rendererHtmlPath);
    window.show();
  };

  adapters.app.onActivate(async (): Promise<void> => {
    if (currentWindow === undefined || currentWindow.isDestroyed()) {
      await openWindow();
    }
  });
  adapters.app.onWindowAllClosed((): void => {
    if (adapters.app.platform !== "darwin") adapters.app.quit();
  });

  await adapters.app.whenReady();
  await adapters.dataUtility.start(paths.dataUtilityPath, []);
  await openWindow();

  return {
    shutdown: async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      await adapters.dataUtility.shutdown();
      removeRuntimeInfoHandler();
    },
  };
}
