import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createContext, Script, type Context } from "node:vm";
import {
  hostApiVersion,
  indicatorContractVersion,
  isIndicatorRuntimeSnapshot,
  isInstalledIndicatorDefinition,
  type IndicatorParameterValues,
  type IndicatorRuntimeSnapshot,
  type IndicatorRuntimeSyncRequest,
  type IndicatorRuntimeUpdateRequest,
  type InstalledIndicatorDefinition,
  type PluginManifest,
} from "@erc-chart/contracts";
import type {
  IndicatorDefinition,
  IndicatorInputDefinition,
  IndicatorInputValue,
  IndicatorSnapshot,
} from "@erc-chart/indicator-sdk";

const maximumPluginEntryBytes = 8 * 1024 * 1024;
const lifecycleTimeoutMs = 1_000;
const pluginGlobalName = "__ERC_INDICATOR_PLUGIN__";

export type IndicatorRuntimeErrorCode =
  | "INDICATOR_DEFINITION_INVALID"
  | "INDICATOR_INSTANCE_INVALID"
  | "INDICATOR_PARAMETERS_INVALID"
  | "INDICATOR_PLUGIN_INVALID"
  | "INDICATOR_PLUGIN_TIMEOUT"
  | "INDICATOR_SNAPSHOT_INVALID";

export class IndicatorRuntimeError extends Error {
  readonly code: IndicatorRuntimeErrorCode;

  constructor(
    code: IndicatorRuntimeErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "IndicatorRuntimeError";
    this.code = code;
  }
}

export interface InstalledIndicatorPluginDescriptor {
  readonly installationPath: string;
  readonly manifest: PluginManifest;
}

export interface LoadedIndicatorPlugin {
  readonly pluginId: string;
  readonly version: string;
  readonly definition: InstalledIndicatorDefinition;
}

export interface IndicatorRuntimeHost {
  readonly loadPlugin: (
    descriptor: InstalledIndicatorPluginDescriptor,
  ) => Promise<LoadedIndicatorPlugin>;
  readonly unloadPlugin: (pluginId: string) => void;
  readonly listPlugins: () => readonly LoadedIndicatorPlugin[];
  readonly sync: (
    request: IndicatorRuntimeSyncRequest,
  ) => IndicatorRuntimeSnapshot;
  readonly update: (
    request: IndicatorRuntimeUpdateRequest,
  ) => IndicatorRuntimeSnapshot;
  readonly disposeInstance: (instanceId: string) => void;
  readonly dispose: () => void;
}

interface RuntimePlugin {
  readonly publicPlugin: LoadedIndicatorPlugin;
  readonly context: Context;
  readonly sandbox: Record<string, unknown>;
  readonly instanceIds: Set<string>;
}

function plainClone<T>(value: T): T {
  return structuredClone(value);
}

function isSafeEntryPath(value: string): boolean {
  return (
    value.startsWith("dist/") &&
    !value.includes("\\") &&
    !value.split("/").some((segment) => segment === ".." || segment === ".") &&
    /\.m?js$/u.test(value)
  );
}

async function readInstalledEntry(
  descriptor: InstalledIndicatorPluginDescriptor,
): Promise<string> {
  if (descriptor.manifest.kind !== "indicator") {
    throw new IndicatorRuntimeError(
      "INDICATOR_PLUGIN_INVALID",
      "Installed plugin is not an indicator plugin.",
    );
  }
  if (!isSafeEntryPath(descriptor.manifest.entry)) {
    throw new IndicatorRuntimeError(
      "INDICATOR_PLUGIN_INVALID",
      "Indicator plugin entry path is invalid.",
    );
  }
  const installationRoot = await realpath(
    path.resolve(descriptor.installationPath),
  );
  const info = await lstat(installationRoot);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new IndicatorRuntimeError(
      "INDICATOR_PLUGIN_INVALID",
      "Indicator installation path must be a real directory.",
    );
  }
  const entryPath = path.resolve(
    installationRoot,
    ...descriptor.manifest.entry.split("/"),
  );
  const relative = path.relative(installationRoot, entryPath);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new IndicatorRuntimeError(
      "INDICATOR_PLUGIN_INVALID",
      "Indicator plugin entry escapes its installation directory.",
    );
  }
  const resolvedEntry = await realpath(entryPath);
  const resolvedRelative = path.relative(installationRoot, resolvedEntry);
  if (
    resolvedRelative === ".." ||
    resolvedRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(resolvedRelative)
  ) {
    throw new IndicatorRuntimeError(
      "INDICATOR_PLUGIN_INVALID",
      "Indicator plugin entry resolves outside its installation directory.",
    );
  }
  const entryInfo = await lstat(resolvedEntry);
  if (!entryInfo.isFile() || entryInfo.isSymbolicLink()) {
    throw new IndicatorRuntimeError(
      "INDICATOR_PLUGIN_INVALID",
      "Indicator plugin entry must be a real file.",
    );
  }
  if (entryInfo.size > maximumPluginEntryBytes) {
    throw new IndicatorRuntimeError(
      "INDICATOR_PLUGIN_INVALID",
      "Indicator plugin entry exceeds the execution size limit.",
    );
  }
  return readFile(resolvedEntry, "utf8");
}

function runScript(plugin: RuntimePlugin, source: string, label: string): void {
  try {
    new Script(source, {
      filename: `${plugin.publicPlugin.pluginId}:${label}`,
    }).runInContext(plugin.context, { timeout: lifecycleTimeoutMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /Script execution timed out/u.test(message)
      ? "INDICATOR_PLUGIN_TIMEOUT"
      : "INDICATOR_PLUGIN_INVALID";
    throw new IndicatorRuntimeError(
      code,
      `Indicator plugin ${label} failed: ${message}`,
      error,
    );
  }
}

function projectDefinition(
  value: IndicatorDefinition,
): InstalledIndicatorDefinition {
  const projected: InstalledIndicatorDefinition = {
    id: value.id,
    name: value.name,
    ...(value.description === undefined
      ? {}
      : { description: value.description }),
    placement: value.placement ?? "overlay",
    inputs: value.inputs.map((input) => plainClone(input)),
    outputs: value.outputs.map((output) => plainClone(output)),
    plots: value.plots.map((plot) => plainClone(plot)),
    requiresLiveTicks: value.requiresLiveTicks,
  };
  if (!isInstalledIndicatorDefinition(projected)) {
    throw new IndicatorRuntimeError(
      "INDICATOR_DEFINITION_INVALID",
      "Indicator definition contains unsupported metadata.",
    );
  }
  return projected;
}

function validateDefinition(
  value: unknown,
  expectedPluginId: string,
): InstalledIndicatorDefinition {
  if (typeof value !== "object" || value === null) {
    throw new IndicatorRuntimeError(
      "INDICATOR_DEFINITION_INVALID",
      "Indicator plugin did not export a definition.",
    );
  }
  const candidate = value as Partial<IndicatorDefinition>;
  if (
    candidate.indicatorContractVersion !== indicatorContractVersion ||
    candidate.hostCompatibility === undefined ||
    candidate.hostCompatibility.minimumHostApiVersion > hostApiVersion ||
    candidate.hostCompatibility.maximumHostApiVersion < hostApiVersion ||
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    !Array.isArray(candidate.inputs) ||
    !Array.isArray(candidate.outputs) ||
    !Array.isArray(candidate.plots) ||
    typeof candidate.requiresLiveTicks !== "boolean"
  ) {
    throw new IndicatorRuntimeError(
      "INDICATOR_DEFINITION_INVALID",
      "Indicator definition is incompatible with this host.",
    );
  }
  if (!candidate.id.startsWith(`${expectedPluginId}.`)) {
    throw new IndicatorRuntimeError(
      "INDICATOR_DEFINITION_INVALID",
      "Indicator definition ID must be namespaced by the plugin ID.",
    );
  }
  return projectDefinition(candidate as IndicatorDefinition);
}

function normalizeInput(
  input: IndicatorInputDefinition,
  supplied: IndicatorInputValue | undefined,
): IndicatorInputValue {
  const value = supplied ?? input.defaultValue;
  if (input.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new IndicatorRuntimeError(
        "INDICATOR_PARAMETERS_INVALID",
        `Indicator input ${input.key} must be boolean.`,
      );
    }
    return value;
  }
  if (input.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new IndicatorRuntimeError(
        "INDICATOR_PARAMETERS_INVALID",
        `Indicator input ${input.key} must be a finite number.`,
      );
    }
    if (input.min !== undefined && value < input.min) {
      throw new IndicatorRuntimeError(
        "INDICATOR_PARAMETERS_INVALID",
        `Indicator input ${input.key} is below its minimum.`,
      );
    }
    if (input.max !== undefined && value > input.max) {
      throw new IndicatorRuntimeError(
        "INDICATOR_PARAMETERS_INVALID",
        `Indicator input ${input.key} is above its maximum.`,
      );
    }
    return value;
  }
  if (typeof value !== "string" || value.length > 8_192) {
    throw new IndicatorRuntimeError(
      "INDICATOR_PARAMETERS_INVALID",
      `Indicator input ${input.key} must be a string.`,
    );
  }
  if (
    input.options !== undefined &&
    !input.options.some((option) => option.value === value)
  ) {
    throw new IndicatorRuntimeError(
      "INDICATOR_PARAMETERS_INVALID",
      `Indicator input ${input.key} is not one of its supported options.`,
    );
  }
  return value;
}

function normalizeParameters(
  definition: InstalledIndicatorDefinition,
  supplied: IndicatorParameterValues,
): Readonly<Record<string, IndicatorInputValue>> {
  const allowed = new Set(definition.inputs.map((input) => input.key));
  if (Object.keys(supplied).some((key) => !allowed.has(key))) {
    throw new IndicatorRuntimeError(
      "INDICATOR_PARAMETERS_INVALID",
      "Indicator parameters contain an unknown input.",
    );
  }
  const normalized: Record<string, IndicatorInputValue> = {};
  for (const input of definition.inputs) {
    normalized[input.key] = normalizeInput(
      input as IndicatorInputDefinition,
      supplied[input.key],
    );
  }
  return Object.freeze(normalized);
}

function projectSnapshot(value: IndicatorSnapshot): IndicatorRuntimeSnapshot {
  const projected: IndicatorRuntimeSnapshot = {
    points: value.points.map((point) => ({
      openTimeMs: point.openTimeMs,
      values: plainClone(point.values),
      ...(point.colors === undefined
        ? {}
        : { colors: plainClone(point.colors) }),
      ...(point.sizes === undefined ? {} : { sizes: plainClone(point.sizes) }),
    })),
    overlays: value.overlays.map((overlay) => plainClone(overlay)),
    signals: (value.signals ?? []).map((signal) => ({
      id: signal.id,
      occurredAtMs: signal.occurredAtMs,
      direction: signal.direction,
      finalized: signal.finalized,
      ...(signal.confidence === undefined
        ? {}
        : { confidence: signal.confidence }),
    })),
  };
  if (!isIndicatorRuntimeSnapshot(projected)) {
    throw new IndicatorRuntimeError(
      "INDICATOR_SNAPSHOT_INVALID",
      "Indicator plugin returned an invalid or oversized snapshot.",
    );
  }
  return projected;
}

function readSnapshot(
  plugin: RuntimePlugin,
  instanceId: string,
): IndicatorRuntimeSnapshot {
  plugin.sandbox.__erc_instance_id__ = instanceId;
  runScript(
    plugin,
    "globalThis.__erc_snapshot__ = globalThis.__erc_instances__.get(globalThis.__erc_instance_id__)?.snapshot();",
    "snapshot",
  );
  const value = plainClone(
    plugin.sandbox.__erc_snapshot__,
  ) as IndicatorSnapshot;
  delete plugin.sandbox.__erc_snapshot__;
  delete plugin.sandbox.__erc_instance_id__;
  if (typeof value !== "object" || value === null) {
    throw new IndicatorRuntimeError(
      "INDICATOR_SNAPSHOT_INVALID",
      "Indicator plugin did not return a snapshot.",
    );
  }
  return projectSnapshot(value);
}

function disposeInstance(plugin: RuntimePlugin, instanceId: string): void {
  if (!plugin.instanceIds.has(instanceId)) return;
  plugin.sandbox.__erc_instance_id__ = instanceId;
  try {
    runScript(
      plugin,
      `{
        const instance = globalThis.__erc_instances__.get(globalThis.__erc_instance_id__);
        if (instance !== undefined) instance.dispose();
        globalThis.__erc_instances__.delete(globalThis.__erc_instance_id__);
      }`,
      "dispose",
    );
  } finally {
    plugin.instanceIds.delete(instanceId);
    delete plugin.sandbox.__erc_instance_id__;
  }
}

async function createRuntimePlugin(
  descriptor: InstalledIndicatorPluginDescriptor,
): Promise<RuntimePlugin> {
  const source = await readInstalledEntry(descriptor);
  const sandbox = Object.create(null) as Record<string, unknown>;
  const context = createContext(sandbox, {
    name: `erc-indicator:${descriptor.manifest.id}`,
    codeGeneration: { strings: false, wasm: false },
  });
  const placeholder: RuntimePlugin = {
    publicPlugin: {
      pluginId: descriptor.manifest.id,
      version: descriptor.manifest.version,
      definition: {
        id: `${descriptor.manifest.id}.loading`,
        name: "Loading",
        placement: "overlay",
        inputs: [],
        outputs: [],
        plots: [],
        requiresLiveTicks: false,
      },
    },
    context,
    sandbox,
    instanceIds: new Set(),
  };
  try {
    new Script(source, {
      filename: `${descriptor.manifest.id}/${descriptor.manifest.entry}`,
    }).runInContext(context, { timeout: lifecycleTimeoutMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new IndicatorRuntimeError(
      /Script execution timed out/u.test(message)
        ? "INDICATOR_PLUGIN_TIMEOUT"
        : "INDICATOR_PLUGIN_INVALID",
      `Indicator plugin could not be loaded: ${message}`,
      error,
    );
  }
  runScript(
    placeholder,
    `{
      const exported = typeof ${pluginGlobalName} === "undefined" ? undefined : ${pluginGlobalName};
      const candidate = exported?.default ?? exported;
      if (candidate === undefined || typeof candidate.createInstance !== "function") {
        throw new Error("Indicator bundle must export definition and createInstance.");
      }
      globalThis.__erc_plugin__ = candidate;
      globalThis.__erc_definition__ = candidate.definition;
      globalThis.__erc_instances__ = new Map();
    }`,
    "bootstrap",
  );
  const definition = validateDefinition(
    plainClone(sandbox.__erc_definition__),
    descriptor.manifest.id,
  );
  delete sandbox.__erc_definition__;
  return {
    ...placeholder,
    publicPlugin: {
      pluginId: descriptor.manifest.id,
      version: descriptor.manifest.version,
      definition,
    },
  };
}

export function createIndicatorRuntimeHost(): IndicatorRuntimeHost {
  const plugins = new Map<string, RuntimePlugin>();
  const instanceOwners = new Map<string, string>();

  const unloadPlugin = (pluginId: string): void => {
    const plugin = plugins.get(pluginId);
    if (plugin === undefined) return;
    for (const instanceId of [...plugin.instanceIds]) {
      disposeInstance(plugin, instanceId);
      instanceOwners.delete(instanceId);
    }
    plugins.delete(pluginId);
  };

  return {
    loadPlugin: async (
      descriptor: InstalledIndicatorPluginDescriptor,
    ): Promise<LoadedIndicatorPlugin> => {
      const plugin = await createRuntimePlugin(descriptor);
      unloadPlugin(plugin.publicPlugin.pluginId);
      plugins.set(plugin.publicPlugin.pluginId, plugin);
      return plugin.publicPlugin;
    },
    unloadPlugin,
    listPlugins: (): readonly LoadedIndicatorPlugin[] =>
      [...plugins.values()].map((plugin) => plugin.publicPlugin),
    sync: (request: IndicatorRuntimeSyncRequest): IndicatorRuntimeSnapshot => {
      const plugin = plugins.get(request.pluginId);
      if (plugin === undefined) {
        throw new IndicatorRuntimeError(
          "INDICATOR_PLUGIN_INVALID",
          "Indicator plugin is not loaded.",
        );
      }
      if (plugin.publicPlugin.definition.id !== request.definitionId) {
        throw new IndicatorRuntimeError(
          "INDICATOR_DEFINITION_INVALID",
          "Indicator definition does not belong to the selected plugin.",
        );
      }
      const existingOwner = instanceOwners.get(request.instanceId);
      if (existingOwner !== undefined) {
        const existingPlugin = plugins.get(existingOwner);
        if (existingPlugin !== undefined) {
          disposeInstance(existingPlugin, request.instanceId);
        }
        instanceOwners.delete(request.instanceId);
      }
      const parameters = normalizeParameters(
        plugin.publicPlugin.definition,
        request.parameters,
      );
      plugin.sandbox.__erc_instance_id__ = request.instanceId;
      plugin.sandbox.__erc_parameters__ = plainClone(parameters);
      plugin.sandbox.__erc_context__ = {
        instrumentId: request.instrumentId,
        timeframeId: request.timeframeId,
      };
      plugin.sandbox.__erc_candles__ = plainClone(request.candles);
      try {
        runScript(
          plugin,
          `{
            const instance = globalThis.__erc_plugin__.createInstance(
              globalThis.__erc_parameters__,
              globalThis.__erc_context__,
            );
            if (
              instance === undefined ||
              typeof instance.onHistory !== "function" ||
              typeof instance.onBuildingBar !== "function" ||
              typeof instance.onFinalizedBar !== "function" ||
              typeof instance.snapshot !== "function" ||
              typeof instance.dispose !== "function"
            ) {
              throw new Error("createInstance returned an invalid indicator instance.");
            }
            globalThis.__erc_instances__.set(globalThis.__erc_instance_id__, instance);
            instance.onHistory(globalThis.__erc_candles__);
          }`,
          "initialize",
        );
      } finally {
        delete plugin.sandbox.__erc_parameters__;
        delete plugin.sandbox.__erc_context__;
        delete plugin.sandbox.__erc_candles__;
        delete plugin.sandbox.__erc_instance_id__;
      }
      plugin.instanceIds.add(request.instanceId);
      instanceOwners.set(request.instanceId, request.pluginId);
      return readSnapshot(plugin, request.instanceId);
    },
    update: (
      request: IndicatorRuntimeUpdateRequest,
    ): IndicatorRuntimeSnapshot => {
      const pluginId = instanceOwners.get(request.instanceId);
      const plugin = pluginId === undefined ? undefined : plugins.get(pluginId);
      if (plugin === undefined || !plugin.instanceIds.has(request.instanceId)) {
        throw new IndicatorRuntimeError(
          "INDICATOR_INSTANCE_INVALID",
          "Indicator instance is not active.",
        );
      }
      plugin.sandbox.__erc_instance_id__ = request.instanceId;
      plugin.sandbox.__erc_candle__ = plainClone(request.candle);
      try {
        runScript(
          plugin,
          `{
            const instance = globalThis.__erc_instances__.get(globalThis.__erc_instance_id__);
            if (instance === undefined) throw new Error("Indicator instance is unavailable.");
            instance.${request.phase === "building" ? "onBuildingBar" : "onFinalizedBar"}(globalThis.__erc_candle__);
          }`,
          request.phase,
        );
      } finally {
        delete plugin.sandbox.__erc_instance_id__;
        delete plugin.sandbox.__erc_candle__;
      }
      return readSnapshot(plugin, request.instanceId);
    },
    disposeInstance: (instanceId: string): void => {
      const pluginId = instanceOwners.get(instanceId);
      if (pluginId === undefined) return;
      const plugin = plugins.get(pluginId);
      if (plugin !== undefined) disposeInstance(plugin, instanceId);
      instanceOwners.delete(instanceId);
    },
    dispose: (): void => {
      for (const pluginId of [...plugins.keys()]) unloadPlugin(pluginId);
      instanceOwners.clear();
    },
  };
}
