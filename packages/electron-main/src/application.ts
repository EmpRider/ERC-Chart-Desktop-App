import {
  ipcContractVersion,
  isWorkspaceSaveRequest,
  type Candle,
  type PersistedWorkspace,
  type RuntimeInfo,
} from "@erc-chart/contracts";
import type {
  ProviderCapabilities,
  ProviderDataSink,
  ProviderHistoryRequest,
  ProviderInstrument,
  ProviderSubscription,
  ProviderSubscriptionRequest,
} from "@erc-chart/provider-sdk";
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
  readonly flushWorkspace: () => Promise<void>;
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

export interface ProviderConfigurationChange {
  readonly settings: Readonly<Record<string, boolean | number | string>>;
}

export interface DesktopApplicationAdapters<ProviderLaunch = unknown> {
  readonly app: DesktopAppAdapter;
  readonly registerRuntimeInfoHandler: (
    handler: (sender: DesktopIpcSender | undefined) => RuntimeInfo,
  ) => () => void;
  readonly registerWorkspaceLoadHandler: (
    handler: (
      sender: DesktopIpcSender | undefined,
    ) => Promise<PersistedWorkspace | null>,
  ) => () => void;
  readonly registerWorkspaceSaveHandler: (
    handler: (
      sender: DesktopIpcSender | undefined,
      workspace: unknown,
    ) => Promise<void>,
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
  readonly providerUtilities: {
    readonly start: (
      providerProfileId: string,
      entryPath: string,
      launch: ProviderLaunch,
    ) => Promise<void>;
    readonly reconfigure: (
      providerProfileId: string,
      settings: Readonly<Record<string, boolean | number | string>>,
    ) => Promise<ProviderConfigurationChange>;
    readonly shutdown: (providerProfileId: string) => Promise<void>;
    readonly shutdownAll: () => Promise<void>;
  };
  readonly providerData: {
    readonly getCapabilities: (
      providerProfileId: string,
    ) => Promise<ProviderCapabilities>;
    readonly getInstruments: (
      providerProfileId: string,
    ) => Promise<readonly ProviderInstrument[]>;
    readonly requestHistory: (
      providerProfileId: string,
      request: ProviderHistoryRequest,
    ) => Promise<readonly Candle[]>;
    readonly subscribe: (
      providerProfileId: string,
      request: ProviderSubscriptionRequest,
      sink: ProviderDataSink,
    ) => Promise<ProviderSubscription>;
  };
  readonly workspacePersistence: {
    readonly load: () => Promise<PersistedWorkspace | null>;
    readonly save: (workspace: PersistedWorkspace) => Promise<void>;
    readonly flush: () => Promise<void>;
    readonly close: () => Promise<void>;
  };
}

export interface DesktopApplicationController<ProviderLaunch = unknown> {
  readonly startProviderProfile: (
    providerProfileId: string,
    launch: ProviderLaunch,
  ) => Promise<void>;
  readonly reconfigureProviderProfile: (
    providerProfileId: string,
    settings: Readonly<Record<string, boolean | number | string>>,
  ) => Promise<ProviderConfigurationChange>;
  readonly stopProviderProfile: (providerProfileId: string) => Promise<void>;
  readonly getProviderCapabilities: (
    providerProfileId: string,
  ) => Promise<ProviderCapabilities>;
  readonly getProviderInstruments: (
    providerProfileId: string,
  ) => Promise<readonly ProviderInstrument[]>;
  readonly requestProviderHistory: (
    providerProfileId: string,
    request: ProviderHistoryRequest,
  ) => Promise<readonly Candle[]>;
  readonly subscribeProviderData: (
    providerProfileId: string,
    request: ProviderSubscriptionRequest,
    sink: ProviderDataSink,
  ) => Promise<ProviderSubscription>;
  readonly shutdown: () => Promise<void>;
}

export async function startDesktopApplication<ProviderLaunch>(
  adapters: DesktopApplicationAdapters<ProviderLaunch>,
  paths: DesktopArtifactPaths,
): Promise<DesktopApplicationController<ProviderLaunch>> {
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
  const removeWorkspaceLoadHandler = adapters.registerWorkspaceLoadHandler(
    async (sender): Promise<PersistedWorkspace | null> => {
      assertTrustedIpcSender(sender);
      return adapters.workspacePersistence.load();
    },
  );
  const removeWorkspaceSaveHandler = adapters.registerWorkspaceSaveHandler(
    async (sender, workspace): Promise<void> => {
      assertTrustedIpcSender(sender);
      if (!isWorkspaceSaveRequest(workspace))
        throw new Error("Invalid workspace save request.");
      await adapters.workspacePersistence.save(workspace);
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
      await adapters.providerUtilities.shutdownAll();
    } catch {
      // Cleanup failure must not expose the original startup error.
    }
    try {
      await adapters.dataUtility.shutdown();
    } catch {
      // Cleanup failure must not expose the original startup error.
    }
    try {
      await adapters.workspacePersistence.flush();
      await adapters.workspacePersistence.close();
    } catch {
      // Cleanup failure must not expose the original startup error.
    }
    try {
      removeRendererProtocol?.();
    } catch {
      // Cleanup failure must not expose the original startup error.
    }
    removeWorkspaceSaveHandler();
    removeWorkspaceLoadHandler();
    removeRuntimeInfoHandler();
    throw new Error("Desktop application failed to start.");
  }

  return {
    startProviderProfile: (providerProfileId, launch): Promise<void> =>
      adapters.providerUtilities.start(
        providerProfileId,
        paths.providerUtilityPath,
        launch,
      ),
    reconfigureProviderProfile: (
      providerProfileId,
      settings,
    ): Promise<ProviderConfigurationChange> =>
      adapters.providerUtilities.reconfigure(providerProfileId, settings),
    stopProviderProfile: (providerProfileId): Promise<void> =>
      adapters.providerUtilities.shutdown(providerProfileId),
    getProviderCapabilities: (
      providerProfileId,
    ): Promise<ProviderCapabilities> =>
      adapters.providerData.getCapabilities(providerProfileId),
    getProviderInstruments: (
      providerProfileId,
    ): Promise<readonly ProviderInstrument[]> =>
      adapters.providerData.getInstruments(providerProfileId),
    requestProviderHistory: (
      providerProfileId,
      request,
    ): Promise<readonly Candle[]> =>
      adapters.providerData.requestHistory(providerProfileId, request),
    subscribeProviderData: (
      providerProfileId,
      request,
      sink,
    ): Promise<ProviderSubscription> =>
      adapters.providerData.subscribe(providerProfileId, request, sink),
    shutdown: async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      let shutdownError: unknown;
      try {
        await adapters.providerUtilities.shutdownAll();
      } catch (error) {
        shutdownError = error;
      }
      try {
        await adapters.dataUtility.shutdown();
      } catch (error) {
        shutdownError ??= error;
      }
      try {
        await currentWindow?.flushWorkspace();
        await adapters.workspacePersistence.flush();
        await adapters.workspacePersistence.close();
      } catch (error) {
        shutdownError ??= error;
      } finally {
        try {
          removeRendererProtocol?.();
        } finally {
          removeWorkspaceSaveHandler();
          removeWorkspaceLoadHandler();
          removeRuntimeInfoHandler();
        }
      }
      if (shutdownError !== undefined) throw shutdownError;
    },
  };
}
