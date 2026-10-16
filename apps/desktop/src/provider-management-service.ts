import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  isPluginManifest,
  type ImportedProviderSession,
  type ProviderManagementSnapshot,
  type ProviderProfileCreateRequest,
  type ProviderProfileSummary,
  type ProviderProfileUpdateRequest,
  type ProviderSessionRequest,
} from "@erc-chart/contracts";
import { createProviderSelectorData } from "@erc-chart/data-service";
import {
  windowsCredentialTarget,
  type DesktopApplicationController,
  type WindowsGenericCredentialManager,
} from "@erc-chart/electron-main";
import type {
  ProviderUtilityLaunchDescriptor,
  ProviderUtilitySupervisorStatus,
} from "@erc-chart/provider-runtime";
import type { PluginRegistryEntry, ProviderProfile } from "@erc-chart/storage";
import type { DataUtilityStorage } from "./data-utility-storage.js";

type ProviderController = Pick<
  DesktopApplicationController<ProviderUtilityLaunchDescriptor>,
  | "startProviderProfile"
  | "stopProviderProfile"
  | "reconfigureProviderProfile"
  | "getProviderCapabilities"
  | "getProviderInstruments"
  | "requestProviderHistory"
>;

export interface ProviderManagementServiceOptions {
  readonly storage: DataUtilityStorage;
  readonly controller: ProviderController;
  readonly credentialManager: Pick<
    WindowsGenericCredentialManager,
    "write" | "delete"
  >;
  readonly installationRoot: string;
  readonly getStatus: (profileId: string) => ProviderUtilitySupervisorStatus;
  readonly now?: () => number;
  readonly createProfileId?: () => string;
}

export interface ProviderManagementService {
  readonly snapshot: () => Promise<ProviderManagementSnapshot>;
  readonly create: (
    request: ProviderProfileCreateRequest,
  ) => Promise<ImportedProviderSession>;
  readonly update: (
    request: ProviderProfileUpdateRequest,
  ) => Promise<ProviderProfileSummary>;
  readonly start: (profileId: string) => Promise<ImportedProviderSession>;
  readonly load: (
    request: ProviderSessionRequest,
  ) => Promise<ImportedProviderSession>;
  readonly stop: (profileId: string) => Promise<void>;
  readonly delete: (profileId: string) => Promise<void>;
}

function requireProfileId(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._-]+$/u.test(value)
  ) {
    throw new Error("Provider profile ID is invalid.");
  }
  return value;
}

async function activeProviderPlugin(
  storage: DataUtilityStorage,
  providerId: string,
): Promise<PluginRegistryEntry> {
  const plugin = (await storage.listPlugins()).find(
    (candidate) =>
      candidate.pluginId === providerId &&
      candidate.kind === "provider" &&
      candidate.status === "active",
  );
  if (plugin === undefined || !isPluginManifest(plugin.manifest)) {
    throw new Error("Installed provider is unavailable.");
  }
  return plugin;
}

function providerName(plugin: PluginRegistryEntry): string {
  if (!isPluginManifest(plugin.manifest)) {
    throw new Error("Installed provider manifest is invalid.");
  }
  return plugin.manifest.name;
}

function summary(
  profile: ProviderProfile,
  plugin: PluginRegistryEntry,
  status: ProviderUtilitySupervisorStatus,
): ProviderProfileSummary {
  if (!isPluginManifest(plugin.manifest)) {
    throw new Error("Installed provider manifest is invalid.");
  }
  return {
    profileId: profile.id,
    providerId: profile.providerId,
    providerName: plugin.manifest.name,
    version: plugin.version,
    displayName: profile.displayName,
    status,
    settings: profile.settings,
    credentialKeys: plugin.manifest.permissions.credentials,
  };
}

function launchDescriptor(
  installationRoot: string,
  profile: ProviderProfile,
  plugin: PluginRegistryEntry,
): ProviderUtilityLaunchDescriptor {
  if (!isPluginManifest(plugin.manifest)) {
    throw new Error("Installed provider manifest is invalid.");
  }
  return {
    installationPath: path.join(
      installationRoot,
      plugin.pluginId,
      plugin.version,
    ),
    entry: plugin.manifest.entry,
    pluginId: plugin.pluginId,
    version: plugin.version,
    permissions: plugin.manifest.permissions,
    settings: profile.settings,
  };
}

function checkedCredentials(
  plugin: PluginRegistryEntry,
  credentials: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (!isPluginManifest(plugin.manifest)) {
    throw new Error("Installed provider manifest is invalid.");
  }
  const allowed = new Set(plugin.manifest.permissions.credentials);
  if (Object.keys(credentials).some((key) => !allowed.has(key))) {
    throw new Error("Provider credentials are invalid.");
  }
  return credentials;
}

export function createProviderManagementService(
  options: ProviderManagementServiceOptions,
): ProviderManagementService {
  const now = options.now ?? (() => Date.now());
  const createProfileId =
    options.createProfileId ?? (() => `profile-${randomUUID()}`);

  const snapshot = async (): Promise<ProviderManagementSnapshot> => {
    const plugins = (await options.storage.listPlugins()).filter(
      (plugin) => plugin.kind === "provider" && plugin.status === "active",
    );
    const installedProviders = plugins.map((plugin) => {
      if (!isPluginManifest(plugin.manifest)) {
        throw new Error("Installed provider manifest is invalid.");
      }
      return {
        providerId: plugin.pluginId,
        providerName: plugin.manifest.name,
        version: plugin.version,
        credentialKeys: plugin.manifest.permissions.credentials,
      };
    });
    const profiles = await Promise.all(
      (await options.storage.listProviderProfiles()).map(async (profile) => {
        const plugin = await activeProviderPlugin(
          options.storage,
          profile.providerId,
        );
        return summary(profile, plugin, options.getStatus(profile.id));
      }),
    );
    return { installedProviders, profiles };
  };

  const loadSession = async (
    profile: ProviderProfile,
    plugin: PluginRegistryEntry,
    request?: ProviderSessionRequest,
  ): Promise<ImportedProviderSession> => {
    const [capabilities, instruments] = await Promise.all([
      options.controller.getProviderCapabilities(profile.id),
      options.controller.getProviderInstruments(profile.id),
    ]);
    const selector = createProviderSelectorData(capabilities, instruments);
    const availableTimeframeIds = selector.timeframes.map(({ id }) => id);
    const instrument =
      request === undefined
        ? selector.instruments[0]
        : selector.instruments.find(
            (value) => value.id === request.instrumentId,
          );
    const timeframe =
      request === undefined
        ? (selector.timeframes.find(({ id }) => id === "1m") ??
          selector.timeframes[0])
        : selector.timeframes.find(({ id }) => id === request.timeframeId);
    if (instrument === undefined || timeframe === undefined) {
      throw new Error("Provider does not expose chartable market data.");
    }
    const timeframeId = timeframe.id;
    if (request !== undefined && timeframeId !== request.timeframeId) {
      throw new Error("Provider timeframe is unavailable.");
    }
    const toMs = now();
    const candles = await options.controller.requestProviderHistory(
      profile.id,
      {
        instrumentId: instrument.id,
        timeframeId,
        fromMs: Math.max(0, toMs - timeframe.seconds * 1000 * 500),
        toMs,
        limit: 500,
      },
    );
    return {
      profileId: profile.id,
      providerId: profile.providerId,
      providerName: providerName(plugin),
      instrument: {
        id: instrument.id,
        symbol: instrument.symbol,
        name: instrument.name,
      },
      timeframeId,
      availableTimeframeIds,
      candles,
    };
  };

  const ensureStarted = async (
    profile: ProviderProfile,
    plugin: PluginRegistryEntry,
  ): Promise<void> => {
    if (options.getStatus(profile.id) !== "ready") {
      await options.controller.startProviderProfile(
        profile.id,
        launchDescriptor(options.installationRoot, profile, plugin),
      );
    }
  };

  const start = async (
    profileIdValue: string,
  ): Promise<ImportedProviderSession> => {
    const profileId = requireProfileId(profileIdValue);
    const profile = await options.storage.getProviderProfile(profileId);
    if (profile === undefined)
      throw new Error("Provider profile was not found.");
    const plugin = await activeProviderPlugin(
      options.storage,
      profile.providerId,
    );
    await ensureStarted(profile, plugin);
    return loadSession(profile, plugin);
  };

  return {
    snapshot,
    create: async (request): Promise<ImportedProviderSession> => {
      const plugin = await activeProviderPlugin(
        options.storage,
        request.providerId,
      );
      const profileId = requireProfileId(createProfileId());
      const credentialTarget = windowsCredentialTarget(
        plugin.pluginId,
        profileId,
      );
      const profile = await options.storage.createProviderProfile({
        id: profileId,
        providerId: plugin.pluginId,
        displayName: request.displayName,
        credentialReference: credentialTarget,
        settings: request.settings,
      });
      let credentialsWritten = false;
      try {
        const credentials = checkedCredentials(plugin, request.credentials);
        if (Object.keys(credentials).length > 0) {
          await options.credentialManager.write(
            credentialTarget,
            JSON.stringify(credentials),
          );
          credentialsWritten = true;
        }
        return await start(profile.id);
      } catch (error) {
        await options.controller
          .stopProviderProfile(profile.id)
          .catch(() => undefined);
        await options.storage
          .deleteProviderProfile(profile.id)
          .catch(() => false);
        if (credentialsWritten) {
          await options.credentialManager
            .delete(credentialTarget)
            .catch(() => undefined);
        }
        throw error;
      }
    },
    update: async (request): Promise<ProviderProfileSummary> => {
      const profileId = requireProfileId(request.profileId);
      const profile = await options.storage.getProviderProfile(profileId);
      if (profile === undefined)
        throw new Error("Provider profile was not found.");
      const plugin = await activeProviderPlugin(
        options.storage,
        profile.providerId,
      );
      let settings = request.settings;
      if (options.getStatus(profile.id) === "ready") {
        const change = await options.controller.reconfigureProviderProfile(
          profile.id,
          request.settings,
        );
        settings = change.settings;
      }
      const updated = await options.storage.updateProviderProfile(profile.id, {
        displayName: request.displayName,
        settings,
      });
      if (
        request.credentials !== undefined &&
        Object.keys(request.credentials).length > 0
      ) {
        const credentials = checkedCredentials(plugin, request.credentials);
        await options.credentialManager.write(
          updated.credentialReference,
          JSON.stringify(credentials),
        );
      }
      return summary(updated, plugin, options.getStatus(updated.id));
    },
    start,
    load: async (request): Promise<ImportedProviderSession> => {
      const profileId = requireProfileId(request.profileId);
      const profile = await options.storage.getProviderProfile(profileId);
      if (profile === undefined)
        throw new Error("Provider profile was not found.");
      const plugin = await activeProviderPlugin(
        options.storage,
        profile.providerId,
      );
      await ensureStarted(profile, plugin);
      return loadSession(profile, plugin, request);
    },
    stop: async (profileIdValue): Promise<void> => {
      const profileId = requireProfileId(profileIdValue);
      if ((await options.storage.getProviderProfile(profileId)) === undefined) {
        throw new Error("Provider profile was not found.");
      }
      const status = options.getStatus(profileId);
      if (status !== "idle" && status !== "stopped") {
        await options.controller.stopProviderProfile(profileId);
      }
    },
    delete: async (profileIdValue): Promise<void> => {
      const profileId = requireProfileId(profileIdValue);
      const profile = await options.storage.getProviderProfile(profileId);
      if (profile === undefined)
        throw new Error("Provider profile was not found.");
      const status = options.getStatus(profileId);
      if (status !== "idle" && status !== "stopped") {
        await options.controller.stopProviderProfile(profileId);
      }
      await options.credentialManager
        .delete(profile.credentialReference)
        .catch(() => undefined);
      if (!(await options.storage.deleteProviderProfile(profileId))) {
        throw new Error("Provider profile could not be removed.");
      }
    },
  };
}
