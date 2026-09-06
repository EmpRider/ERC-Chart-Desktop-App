import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  isPluginManifest,
  type IndicatorImportPreview,
  type InstalledIndicatorSummary,
} from "@erc-chart/contracts";
import type { IndicatorRuntimeHost } from "@erc-chart/indicator-runtime";
import { createIndicatorRuntimeHost } from "@erc-chart/indicator-runtime";
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
  readonly runtimeHost: IndicatorRuntimeHost;
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
  definition: IndicatorImportPreview["definition"],
): InstalledIndicatorSummary {
  return { pluginId, pluginName, version, definition };
}

async function inspectStagedIndicator(
  staged: StagedPluginPackage,
): Promise<IndicatorImportPreview["definition"]> {
  const inspector = createIndicatorRuntimeHost();
  try {
    const loaded = await inspector.loadPlugin({
      installationPath: staged.stagingPath,
      manifest: staged.manifest,
    });
    return loaded.definition;
  } finally {
    inspector.dispose();
  }
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
    const activeIds = new Set(registry.map((entry) => entry.pluginId));
    for (const loaded of options.runtimeHost.listPlugins()) {
      if (!activeIds.has(loaded.pluginId)) {
        options.runtimeHost.unloadPlugin(loaded.pluginId);
      }
    }
    const summaries: InstalledIndicatorSummary[] = [];
    for (const entry of registry) {
      const manifest = entry.manifest;
      if (!isPluginManifest(manifest) || manifest.kind !== "indicator")
        continue;
      let loaded = options.runtimeHost
        .listPlugins()
        .find(
          (plugin) =>
            plugin.pluginId === entry.pluginId &&
            plugin.version === entry.version,
        );
      if (loaded === undefined) {
        loaded = await options.runtimeHost.loadPlugin({
          installationPath: path.join(
            options.installationRoot,
            entry.pluginId,
            entry.version,
          ),
          manifest,
        });
      }
      summaries.push(
        toSummary(
          entry.pluginId,
          manifest.name,
          entry.version,
          loaded.definition,
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
      const definition = await inspectStagedIndicator(staged);
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
      const loaded = await options.runtimeHost.loadPlugin({
        installationPath: installed.installationPath,
        manifest: installed.manifest,
      });
      activatePlugin(options.database, installed.pluginId, installed.version);
      return toSummary(
        installed.pluginId,
        installed.manifest.name,
        installed.version,
        loaded.definition,
      );
    } catch (error) {
      if (installed !== undefined) {
        options.runtimeHost.unloadPlugin(installed.pluginId);
      }
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
      options.runtimeHost.dispose();
    },
  };
}
