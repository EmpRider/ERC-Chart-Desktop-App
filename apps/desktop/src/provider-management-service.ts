import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  isPluginManifest,
  type ImportedProviderSession,
  type ProviderManagementSnapshot,
  type ProviderProfileCreateRequest,
  type ProviderProfileSummary,
  type ProviderProfileUpdateRequest,
  type ProviderSessionRequest,
} from "@erc-chart/contracts";
import {
  windowsCredentialTarget,
  type DesktopApplicationController,
  type WindowsGenericCredentialManager,
} from "@erc-chart/electron-main";
import type {
  ProviderUtilityLaunchDescriptor,
  ProviderUtilitySupervisorStatus,
} from "@erc-chart/provider-runtime";
import {
  createProviderProfile,
  deleteProviderProfile,
  getProviderProfile,
  listPlugins,
  listProviderProfiles,
  updateProviderProfile,
  type PluginRegistryEntry,
  type ProviderProfile,
} from "@erc-chart/storage";

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
  readonly database: DatabaseSync;
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
  readonly snapshot: () => ProviderManagementSnapshot;
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

function activeProviderPlugin(
  database: DatabaseSync,
  providerId: string,
): PluginRegistryEntry {
  const plugin = listPlugins(database).find(
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

function timeframeDurationMs(timeframeId: string): number {
  const match = /^(\d+)(s|m|h|d)$/u.exec(timeframeId);
  if (match === null) return 60_000;
  const amount = Number(match[1]);
  const unit = match[2];
  return (
    amount *
    (unit === "s"
      ? 1_000
      : unit === "m"
        ? 60_000
        : unit === "h"
          ? 3_600_000
          : 86_400_000)
  );
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

  const snapshot = (): ProviderManagementSnapshot => {
    const plugins = listPlugins(options.database).filter(
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
    const profiles = listProviderProfiles(options.database).map((profile) => {
      const plugin = activeProviderPlugin(options.database, profile.providerId);
      return summary(profile, plugin, options.getStatus(profile.id));
    });
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
    const availableTimeframeIds = [
      ...capabilities.nativeTimeframes,
      ...(capabilities.derivedTimeframeIds ?? []),
    ].sort(
      (left, right) => timeframeDurationMs(left) - timeframeDurationMs(right),
    );
    const instrument =
      request === undefined
        ? instruments[0]
        : instruments.find((value) => value.id === request.instrumentId);
    const timeframeId =
      request === undefined
        ? (availableTimeframeIds.find((value) => value === "1m") ??
          availableTimeframeIds[0])
        : availableTimeframeIds.find((value) => value === request.timeframeId);
    if (instrument === undefined || timeframeId === undefined) {
      throw new Error("Provider does not expose chartable market data.");
    }
    if (request !== undefined && timeframeId !== request.timeframeId) {
      throw new Error("Provider timeframe is unavailable.");
    }
    const toMs = now();
    const candles = await options.controller.requestProviderHistory(
      profile.id,
      {
        instrumentId: instrument.id,
        timeframeId,
        fromMs: Math.max(0, toMs - timeframeDurationMs(timeframeId) * 500),
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
    const profile = getProviderProfile(options.database, profileId);
    if (profile === undefined)
      throw new Error("Provider profile was not found.");
    const plugin = activeProviderPlugin(options.database, profile.providerId);
    await ensureStarted(profile, plugin);
    return loadSession(profile, plugin);
  };

  return {
    snapshot,
    create: async (request): Promise<ImportedProviderSession> => {
      const plugin = activeProviderPlugin(options.database, request.providerId);
      const profileId = requireProfileId(createProfileId());
      const credentialTarget = windowsCredentialTarget(
        plugin.pluginId,
        profileId,
      );
      const profile = createProviderProfile(options.database, {
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
        deleteProviderProfile(options.database, profile.id);
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
      const profile = getProviderProfile(options.database, profileId);
      if (profile === undefined)
        throw new Error("Provider profile was not found.");
      const plugin = activeProviderPlugin(options.database, profile.providerId);
      let settings = request.settings;
      if (options.getStatus(profile.id) === "ready") {
        const change = await options.controller.reconfigureProviderProfile(
          profile.id,
          request.settings,
        );
        settings = change.settings;
      }
      const updated = updateProviderProfile(options.database, profile.id, {
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
      const profile = getProviderProfile(options.database, profileId);
      if (profile === undefined)
        throw new Error("Provider profile was not found.");
      const plugin = activeProviderPlugin(options.database, profile.providerId);
      await ensureStarted(profile, plugin);
      return loadSession(profile, plugin, request);
    },
    stop: async (profileIdValue): Promise<void> => {
      const profileId = requireProfileId(profileIdValue);
      if (getProviderProfile(options.database, profileId) === undefined) {
        throw new Error("Provider profile was not found.");
      }
      const status = options.getStatus(profileId);
      if (status !== "idle" && status !== "stopped") {
        await options.controller.stopProviderProfile(profileId);
      }
    },
    delete: async (profileIdValue): Promise<void> => {
      const profileId = requireProfileId(profileIdValue);
      const profile = getProviderProfile(options.database, profileId);
      if (profile === undefined)
        throw new Error("Provider profile was not found.");
      const status = options.getStatus(profileId);
      if (status !== "idle" && status !== "stopped") {
        await options.controller.stopProviderProfile(profileId);
      }
      await options.credentialManager
        .delete(profile.credentialReference)
        .catch(() => undefined);
      if (!deleteProviderProfile(options.database, profileId)) {
        throw new Error("Provider profile could not be removed.");
      }
    },
  };
}
