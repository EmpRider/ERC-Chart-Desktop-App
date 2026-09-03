import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  ImportedProviderSession,
  ProviderImportCredentialValues,
  ProviderImportPreview,
} from "@erc-chart/contracts";
import {
  windowsCredentialTarget,
  type DesktopApplicationController,
  type WindowsGenericCredentialManager,
} from "@erc-chart/electron-main";
import {
  discardStagedPlugin,
  installStagedPlugin,
  removeInstalledPlugin,
  stagePluginPackage,
  type PluginPackageSource,
  type ProviderUtilityLaunchDescriptor,
  type StagedPluginPackage,
} from "@erc-chart/provider-runtime";
import {
  activatePlugin,
  createProviderProfile,
  deletePlugin,
  deleteProviderProfile,
  disablePlugin,
  getProviderProfile,
  putPlugin,
  type JsonObject,
} from "@erc-chart/storage";

type ProviderController = Pick<
  DesktopApplicationController<ProviderUtilityLaunchDescriptor>,
  | "startProviderProfile"
  | "stopProviderProfile"
  | "getProviderCapabilities"
  | "getProviderInstruments"
  | "requestProviderHistory"
>;

export interface ProviderImportServiceOptions {
  readonly database: DatabaseSync;
  readonly controller: ProviderController;
  readonly credentialManager: Pick<
    WindowsGenericCredentialManager,
    "write" | "read" | "delete"
  >;
  readonly stagingRoot: string;
  readonly installationRoot: string;
  readonly now?: () => number;
  readonly createRequestId?: () => string;
}

export interface ProviderImportService {
  readonly preview: (
    source: PluginPackageSource,
  ) => Promise<ProviderImportPreview>;
  readonly approve: (
    requestId: string,
    credentials?: ProviderImportCredentialValues,
  ) => Promise<ImportedProviderSession>;
  readonly cancel: (requestId: string) => Promise<void>;
  readonly shutdown: () => Promise<void>;
}

interface PendingProviderImport {
  readonly staged: StagedPluginPackage;
}

function requireRequestId(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 128
  ) {
    throw new Error("Provider import request is invalid.");
  }
  return value;
}

function registryPermissions(staged: StagedPluginPackage): readonly string[] {
  return staged.manifest.permissions.storage.map(
    (permission) => `storage:${permission}`,
  );
}

function normalizeCredentialValues(
  staged: StagedPluginPackage,
  credentials: ProviderImportCredentialValues,
): ProviderImportCredentialValues {
  const allowed = new Set(staged.manifest.permissions.credentials);
  const entries = Object.entries(credentials);
  if (
    entries.length > 32 ||
    !entries.every(
      ([key, value]) =>
        allowed.has(key) &&
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 16_384,
    )
  ) {
    throw new Error("Provider credentials are invalid.");
  }
  return Object.freeze(Object.fromEntries(entries));
}

function timeframeDurationMs(timeframeId: string): number {
  const match = /^(\d+)(s|m|h|d)$/u.exec(timeframeId);
  if (match === null) return 60_000;
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === "s"
      ? 1_000
      : unit === "m"
        ? 60_000
        : unit === "h"
          ? 3_600_000
          : 86_400_000;
  return amount * multiplier;
}

export function createProviderImportService(
  options: ProviderImportServiceOptions,
): ProviderImportService {
  const pending = new Map<string, PendingProviderImport>();
  const now = options.now ?? (() => Date.now());
  const createRequestId = options.createRequestId ?? randomUUID;

  const preview = async (
    source: PluginPackageSource,
  ): Promise<ProviderImportPreview> => {
    const staged = await stagePluginPackage(source, {
      stagingRoot: options.stagingRoot,
      trustPolicy: { mode: "developer", trustedPublisherKeys: {} },
    });
    if (staged.manifest.kind !== "provider") {
      await discardStagedPlugin(staged);
      throw new Error("Selected package is not a provider plugin.");
    }
    const requestId = requireRequestId(createRequestId());
    if (pending.has(requestId)) {
      await discardStagedPlugin(staged);
      throw new Error("Provider import request ID collided.");
    }
    pending.set(requestId, { staged });
    return {
      requestId,
      pluginId: staged.manifest.id,
      pluginName: staged.manifest.name,
      pluginVersion: staged.manifest.version,
      mode: "developer",
      trust: "unsigned",
      permissions: staged.manifest.permissions,
    };
  };

  const cancel = async (requestIdValue: string): Promise<void> => {
    const requestId = requireRequestId(requestIdValue);
    const request = pending.get(requestId);
    if (request === undefined) return;
    pending.delete(requestId);
    await discardStagedPlugin(request.staged);
  };

  const approve = async (
    requestIdValue: string,
    credentialValues: ProviderImportCredentialValues = {},
  ): Promise<ImportedProviderSession> => {
    const requestId = requireRequestId(requestIdValue);
    const request = pending.get(requestId);
    if (request === undefined) {
      throw new Error("Provider import request is no longer available.");
    }
    pending.delete(requestId);
    const { staged } = request;
    const credentials = normalizeCredentialValues(staged, credentialValues);
    let installed: Awaited<ReturnType<typeof installStagedPlugin>> | undefined;
    let profileCreated = false;
    let registryCreated = false;
    let providerStarted = false;
    let credentialsWritten = false;
    let previousCredentialValue: string | undefined;
    let credentialTarget: string | undefined;
    const profileId = `${staged.manifest.id}.default`;
    try {
      installed = await installStagedPlugin(staged, {
        installationRoot: options.installationRoot,
      });
      putPlugin(options.database, {
        pluginId: installed.pluginId,
        version: installed.version,
        kind: installed.manifest.kind,
        trust: "unsigned",
        status: "disabled",
        manifest: installed.manifest as unknown as JsonObject,
        integrityHash: `sha256:${installed.packageHash}`,
        permissions: registryPermissions(staged),
      });
      registryCreated = true;
      activatePlugin(options.database, installed.pluginId, installed.version);

      let profile = getProviderProfile(options.database, profileId);
      if (profile === undefined) {
        const credentialReference = windowsCredentialTarget(
          installed.pluginId,
          profileId,
        );
        profile = createProviderProfile(options.database, {
          id: profileId,
          providerId: installed.pluginId,
          displayName: installed.manifest.name,
          credentialReference,
          settings: {},
        });
        profileCreated = true;
      } else if (profile.providerId !== installed.pluginId) {
        throw new Error("Existing provider profile belongs to another plugin.");
      }

      if (Object.keys(credentials).length > 0) {
        const serializedCredentials = JSON.stringify(credentials);
        if (Buffer.byteLength(serializedCredentials, "utf8") > 2_560) {
          throw new Error("Provider credentials exceed secure storage limits.");
        }
        credentialTarget = windowsCredentialTarget(
          installed.pluginId,
          profileId,
        );
        previousCredentialValue =
          await options.credentialManager.read(credentialTarget);
        await options.credentialManager.write(
          credentialTarget,
          serializedCredentials,
        );
        credentialsWritten = true;
      }

      await options.controller.startProviderProfile(profile.id, {
        installationPath: installed.installationPath,
        entry: installed.manifest.entry,
        pluginId: installed.pluginId,
        version: installed.version,
        permissions: installed.manifest.permissions,
        settings: profile.settings,
      });
      providerStarted = true;

      const [capabilities, instruments] = await Promise.all([
        options.controller.getProviderCapabilities(profile.id),
        options.controller.getProviderInstruments(profile.id),
      ]);
      const instrument = instruments[0];
      if (instrument === undefined) {
        throw new Error("Provider did not expose an instrument.");
      }
      const timeframeId =
        capabilities.nativeTimeframes.find((value) => value === "1m") ??
        capabilities.nativeTimeframes[0];
      if (timeframeId === undefined) {
        throw new Error("Provider did not expose a native timeframe.");
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
        providerId: installed.pluginId,
        providerName: installed.manifest.name,
        instrument: {
          id: instrument.id,
          symbol: instrument.symbol,
          name: instrument.name,
        },
        timeframeId,
        candles,
      };
    } catch (error) {
      if (providerStarted) {
        await options.controller
          .stopProviderProfile(profileId)
          .catch(() => undefined);
      }
      if (profileCreated) {
        deleteProviderProfile(options.database, profileId);
      }
      if (credentialsWritten && credentialTarget !== undefined) {
        if (previousCredentialValue === undefined) {
          await options.credentialManager
            .delete(credentialTarget)
            .catch(() => undefined);
        } else {
          await options.credentialManager
            .write(credentialTarget, previousCredentialValue)
            .catch(() => undefined);
        }
      }
      if (registryCreated && installed !== undefined) {
        try {
          disablePlugin(
            options.database,
            installed.pluginId,
            installed.version,
          );
        } catch {
          // A failed activation can leave the registry disabled already.
        }
        try {
          deletePlugin(options.database, installed.pluginId, installed.version);
        } catch {
          // Preserve the original import failure.
        }
      }
      if (installed !== undefined) {
        await removeInstalledPlugin(
          { installationRoot: options.installationRoot },
          installed.pluginId,
          installed.version,
        ).catch(() => undefined);
      } else {
        await discardStagedPlugin(staged).catch(() => undefined);
      }
      throw error;
    }
  };

  return {
    preview,
    approve,
    cancel,
    shutdown: async (): Promise<void> => {
      const staged = [...pending.values()].map((request) => request.staged);
      pending.clear();
      await Promise.all(staged.map((item) => discardStagedPlugin(item)));
    },
  };
}
