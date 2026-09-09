import { randomUUID } from "node:crypto";
import {
  isInstalledIndicatorDefinition,
  isPluginId,
  isPluginManifest,
  type IndicatorImportPreview,
  type InstalledIndicatorSummary,
  type PluginManifest,
} from "@erc-chart/contracts";
import {
  discardStagedPlugin,
  installStagedPlugin,
  removeInstalledPlugin,
  stagePluginPackage,
  type PluginPackageSource,
  type StagedPluginPackage,
} from "@erc-chart/provider-runtime";
import type { JsonObject, PluginRegistryEntry } from "@erc-chart/storage";
import type { DataUtilityStorage } from "./data-utility-storage.js";

export interface IndicatorImportServiceOptions {
  readonly storage: DataUtilityStorage;
  readonly stagingRoot: string;
  readonly installationRoot: string;
  readonly createRequestId?: () => string;
}

export interface IndicatorImportService {
  readonly preview: (
    source: PluginPackageSource,
  ) => Promise<IndicatorImportPreview>;
  readonly approve: (requestId: string) => Promise<InstalledIndicatorSummary>;
  readonly cancel: (requestId: string) => Promise<void>;
  readonly list: () => Promise<readonly InstalledIndicatorSummary[]>;
  readonly remove: (pluginId: string) => Promise<boolean>;
  readonly shutdown: () => Promise<void>;
}

interface PendingIndicatorImport {
  readonly staged: StagedPluginPackage;
  readonly definition: IndicatorImportPreview["definition"];
}

function requireRequestId(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 128
  ) {
    throw new Error("Indicator import request is invalid.");
  }
  return value;
}

function assertIndicatorPermissions(staged: StagedPluginPackage): void {
  const permissions = staged.manifest.permissions;
  if (
    permissions.network.length > 0 ||
    permissions.credentials.length > 0 ||
    permissions.storage.includes("provider-cache")
  ) {
    throw new Error(
      "Indicator plugins may only request scoped plugin-settings storage. Network, credential, and provider-cache permissions are not available to indicator code.",
    );
  }
}

function registryPermissions(staged: StagedPluginPackage): readonly string[] {
  return staged.manifest.permissions.storage.map(
    (permission) => `storage:${permission}`,
  );
}

function toSummary(
  pluginId: string,
  pluginName: string,
  version: string,
  entry: string,
  packageHash: string,
  definition: IndicatorImportPreview["definition"],
): InstalledIndicatorSummary {
  const runtimeEntryPath = [
    "erc-plugin://plugin",
    encodeURIComponent(pluginId),
    encodeURIComponent(version),
    ...entry.split("/").map((part) => encodeURIComponent(part)),
  ].join("/");
  const runtimeEntryUrl = `${runtimeEntryPath}?revision=${packageHash}`;
  return { pluginId, pluginName, version, runtimeEntryUrl, definition };
}

function packageHashFromIntegrity(integrityHash: string): string {
  const prefix = "sha256:";
  const packageHash = integrityHash.startsWith(prefix)
    ? integrityHash.slice(prefix.length)
    : "";
  if (!/^[a-f0-9]{64}$/u.test(packageHash)) {
    throw new Error("Indicator registry integrity metadata is invalid.");
  }
  return packageHash;
}

function requirePluginId(value: string): string {
  if (!isPluginId(value)) {
    throw new Error("Indicator plugin ID is invalid.");
  }
  return value;
}

function indicatorDefinitionFromManifest(
  manifest: PluginManifest,
): IndicatorImportPreview["definition"] {
  const definition = manifest.capabilities?.indicatorDefinition;
  if (!isInstalledIndicatorDefinition(definition)) {
    throw new Error(
      "Indicator manifest must declare capabilities.indicatorDefinition using the supported indicator definition contract.",
    );
  }
  if (!definition.id.startsWith(`${manifest.id}.`)) {
    throw new Error(
      "Indicator definition does not belong to the plugin manifest.",
    );
  }
  return definition;
}

async function markIndicatorIncompatible(
  storage: DataUtilityStorage,
  entry: PluginRegistryEntry,
): Promise<void> {
  await storage.putPlugin({
    pluginId: entry.pluginId,
    version: entry.version,
    kind: entry.kind,
    trust: entry.trust,
    status: "incompatible",
    manifest: entry.manifest,
    integrityHash: entry.integrityHash,
    permissions: entry.permissions,
  });
}

export function createIndicatorImportService(
  options: IndicatorImportServiceOptions,
): IndicatorImportService {
  const pending = new Map<string, PendingIndicatorImport>();
  const createRequestId = options.createRequestId ?? randomUUID;

  const list = async (): Promise<readonly InstalledIndicatorSummary[]> => {
    const registry = (await options.storage.listPlugins()).filter(
      (entry) => entry.kind === "indicator" && entry.status === "active",
    );
    const summaries: InstalledIndicatorSummary[] = [];
    for (const entry of registry) {
      const manifest = entry.manifest;
      if (!isPluginManifest(manifest) || manifest.kind !== "indicator") {
        await markIndicatorIncompatible(options.storage, entry);
        continue;
      }
      let definition: IndicatorImportPreview["definition"];
      try {
        definition = indicatorDefinitionFromManifest(manifest);
      } catch {
        await markIndicatorIncompatible(options.storage, entry);
        continue;
      }
      summaries.push(
        toSummary(
          entry.pluginId,
          manifest.name,
          entry.version,
          manifest.entry,
          packageHashFromIntegrity(entry.integrityHash),
          definition,
        ),
      );
    }
    return summaries;
  };

  const preview = async (
    source: PluginPackageSource,
  ): Promise<IndicatorImportPreview> => {
    const staged = await stagePluginPackage(source, {
      stagingRoot: options.stagingRoot,
      trustPolicy: { mode: "developer", trustedPublisherKeys: {} },
    });
    try {
      if (staged.manifest.kind !== "indicator") {
        throw new Error("Selected package is not an indicator plugin.");
      }
      assertIndicatorPermissions(staged);
      const definition = indicatorDefinitionFromManifest(staged.manifest);
      const requestId = requireRequestId(createRequestId());
      if (pending.has(requestId)) {
        throw new Error("Indicator import request ID collided.");
      }
      pending.set(requestId, { staged, definition });
      return {
        requestId,
        pluginId: staged.manifest.id,
        pluginName: staged.manifest.name,
        pluginVersion: staged.manifest.version,
        mode: "developer",
        trust: "unsigned",
        permissions: staged.manifest.permissions,
        definition,
      };
    } catch (error) {
      await discardStagedPlugin(staged).catch(() => undefined);
      throw error;
    }
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
  ): Promise<InstalledIndicatorSummary> => {
    const requestId = requireRequestId(requestIdValue);
    const request = pending.get(requestId);
    if (request === undefined) {
      throw new Error("Indicator import request is no longer available.");
    }
    const { staged } = request;
    let installed: Awaited<ReturnType<typeof installStagedPlugin>> | undefined;
    let registryCreated = false;
    const existingEntry = (await options.storage.listPlugins()).find(
      (entry) =>
        entry.kind === "indicator" &&
        entry.pluginId === staged.manifest.id &&
        entry.version === staged.manifest.version,
    );
    try {
      if (existingEntry !== undefined) {
        await options.storage.putPlugin({
          pluginId: staged.manifest.id,
          version: staged.manifest.version,
          kind: "indicator",
          trust: "unsigned",
          status: "disabled",
          manifest: staged.manifest as unknown as JsonObject,
          integrityHash: `sha256:${staged.packageHash}`,
          permissions: registryPermissions(staged),
        });
        registryCreated = true;
        await options.storage.activatePlugin(
          staged.manifest.id,
          staged.manifest.version,
        );
        try {
          installed = await installStagedPlugin(staged, {
            installationRoot: options.installationRoot,
            replaceExisting: true,
          });
        } catch (error) {
          await options.storage.putPlugin(existingEntry);
          throw error;
        }
      } else {
        installed = await installStagedPlugin(staged, {
          installationRoot: options.installationRoot,
          replaceExisting: true,
        });
        await options.storage.putPlugin({
          pluginId: installed.pluginId,
          version: installed.version,
          kind: "indicator",
          trust: "unsigned",
          status: "disabled",
          manifest: installed.manifest as unknown as JsonObject,
          integrityHash: `sha256:${installed.packageHash}`,
          permissions: registryPermissions(staged),
        });
        registryCreated = true;
        await options.storage.activatePlugin(
          installed.pluginId,
          installed.version,
        );
      }
      pending.delete(requestId);
      return toSummary(
        installed.pluginId,
        installed.manifest.name,
        installed.version,
        installed.manifest.entry,
        installed.packageHash,
        request.definition,
      );
    } catch (error) {
      pending.delete(requestId);
      if (
        existingEntry !== undefined &&
        registryCreated &&
        installed === undefined
      ) {
        await options.storage.putPlugin(existingEntry).catch(() => undefined);
      }
      if (
        existingEntry === undefined &&
        registryCreated &&
        installed !== undefined
      ) {
        await options.storage
          .disablePlugin(installed.pluginId, installed.version)
          .catch(() => undefined);
        await options.storage
          .deletePlugin(installed.pluginId, installed.version)
          .catch(() => false);
      }
      if (existingEntry === undefined && installed !== undefined) {
        await removeInstalledPlugin(
          { installationRoot: options.installationRoot },
          installed.pluginId,
          installed.version,
        ).catch(() => undefined);
      } else if (installed === undefined) {
        await discardStagedPlugin(staged).catch(() => undefined);
      }
      throw error;
    }
  };

  const remove = async (pluginIdValue: string): Promise<boolean> => {
    const pluginId = requirePluginId(pluginIdValue);
    const entries = (await options.storage.listPlugins())
      .filter(
        (entry) => entry.kind === "indicator" && entry.pluginId === pluginId,
      )
      .sort((left, right) => {
        if (left.status === "active" && right.status !== "active") return 1;
        if (right.status === "active" && left.status !== "active") return -1;
        return left.version.localeCompare(right.version);
      });
    if (entries.length === 0) return false;

    for (const entry of entries) {
      const wasActive = entry.status === "active";
      if (wasActive)
        await options.storage.disablePlugin(pluginId, entry.version);
      try {
        await removeInstalledPlugin(
          { installationRoot: options.installationRoot },
          pluginId,
          entry.version,
        );
      } catch (error) {
        if (wasActive) {
          await options.storage
            .activatePlugin(pluginId, entry.version)
            .catch(() => undefined);
        }
        throw error;
      }
      await options.storage.deletePlugin(pluginId, entry.version);
    }
    return true;
  };

  return {
    preview,
    approve,
    cancel,
    list,
    remove,
    shutdown: async (): Promise<void> => {
      const staged = [...pending.values()].map((request) => request.staged);
      pending.clear();
      await Promise.all(staged.map((item) => discardStagedPlugin(item)));
    },
  };
}
