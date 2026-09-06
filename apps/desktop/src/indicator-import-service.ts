import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  isInstalledIndicatorDefinition,
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
import {
  activatePlugin,
  deletePlugin,
  disablePlugin,
  listPlugins,
  putPlugin,
  type JsonObject,
} from "@erc-chart/storage";

export interface IndicatorImportServiceOptions {
  readonly database: DatabaseSync;
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
  definition: IndicatorImportPreview["definition"],
): InstalledIndicatorSummary {
  const runtimeEntryUrl = [
    "erc-plugin://plugin",
    encodeURIComponent(pluginId),
    encodeURIComponent(version),
    ...entry.split("/").map((part) => encodeURIComponent(part)),
  ].join("/");
  return { pluginId, pluginName, version, runtimeEntryUrl, definition };
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

function markIndicatorIncompatible(
  database: DatabaseSync,
  entry: ReturnType<typeof listPlugins>[number],
): void {
  putPlugin(database, {
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
    const registry = listPlugins(options.database).filter(
      (entry) => entry.kind === "indicator" && entry.status === "active",
    );
    const summaries: InstalledIndicatorSummary[] = [];
    for (const entry of registry) {
      const manifest = entry.manifest;
      if (!isPluginManifest(manifest) || manifest.kind !== "indicator") {
        markIndicatorIncompatible(options.database, entry);
        continue;
      }
      let definition: IndicatorImportPreview["definition"];
      try {
        definition = indicatorDefinitionFromManifest(manifest);
      } catch {
        markIndicatorIncompatible(options.database, entry);
        continue;
      }
      summaries.push(
        toSummary(
          entry.pluginId,
          manifest.name,
          entry.version,
          manifest.entry,
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
    pending.delete(requestId);
    const { staged } = request;
    let installed: Awaited<ReturnType<typeof installStagedPlugin>> | undefined;
    let registryCreated = false;
    try {
      installed = await installStagedPlugin(staged, {
        installationRoot: options.installationRoot,
      });
      putPlugin(options.database, {
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
      activatePlugin(options.database, installed.pluginId, installed.version);
      return toSummary(
        installed.pluginId,
        installed.manifest.name,
        installed.version,
        installed.manifest.entry,
        request.definition,
      );
    } catch (error) {
      if (registryCreated && installed !== undefined) {
        try {
          disablePlugin(
            options.database,
            installed.pluginId,
            installed.version,
          );
        } catch {
          // The registry can already be disabled when loading fails.
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
    list,
    shutdown: async (): Promise<void> => {
      const staged = [...pending.values()].map((request) => request.staged);
      pending.clear();
      await Promise.all(staged.map((item) => discardStagedPlugin(item)));
    },
  };
}
