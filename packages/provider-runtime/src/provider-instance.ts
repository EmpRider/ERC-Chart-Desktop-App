import { lstat, realpath } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  hostApiVersion,
  providerContractVersion,
  type PluginManifestPermissions,
} from "@erc-chart/contracts";
import type {
  ProviderAdapter,
  ProviderConfiguration,
  ProviderConfigurationField,
  ProviderConfigurationSchema,
  ProviderDefinition,
  ProviderHostServices,
  ProviderLogger,
  ProviderNetworkRequest,
  ProviderNetworkResponse,
  ProviderStatus,
} from "@erc-chart/provider-sdk";
import { isProviderNetworkRequestAllowed } from "./provider-permissions.js";

export type ProviderRuntimeErrorCode =
  | "PROVIDER_ADAPTER_INVALID"
  | "PROVIDER_CONFIG_INVALID"
  | "PROVIDER_DEFINITION_INVALID"
  | "PROVIDER_ENTRY_INVALID"
  | "PROVIDER_INCOMPATIBLE"
  | "PROVIDER_LOAD_FAILED"
  | "PROVIDER_PERMISSION_DENIED";

export class ProviderRuntimeError extends Error {
  readonly code: ProviderRuntimeErrorCode;

  constructor(code: ProviderRuntimeErrorCode, message: string) {
    super(message);
    this.name = "ProviderRuntimeError";
    this.code = code;
  }
}

export interface ProviderRuntimeHostBroker {
  readonly requestNetwork: (
    providerProfileId: string,
    request: ProviderNetworkRequest,
    signal?: AbortSignal,
  ) => Promise<ProviderNetworkResponse>;
  readonly getCredential: (
    providerProfileId: string,
    credentialKey: string,
  ) => Promise<string | null>;
  readonly log: (
    providerProfileId: string,
    level: "debug" | "info" | "warn" | "error",
    code: string,
    metadata?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly reportStatus: (
    providerProfileId: string,
    status: ProviderStatus,
  ) => void;
  readonly now?: () => number;
}

export interface InstalledProviderInstanceOptions {
  readonly providerProfileId: string;
  readonly installationPath: string;
  readonly entry: string;
  readonly pluginId: string;
  readonly version: string;
  readonly permissions: PluginManifestPermissions;
  readonly settings: Readonly<Record<string, boolean | number | string>>;
  readonly hostBroker: ProviderRuntimeHostBroker;
}

export interface InstalledProviderInstance {
  readonly providerProfileId: string;
  readonly definition: ProviderDefinition;
  readonly adapter: ProviderAdapter;
  readonly settings: ProviderConfiguration;
}

export type ProviderConfigurationChangeImpact =
  "none" | "restart" | "reconnect";

export interface ProviderConfigurationChangePlan {
  readonly impact: ProviderConfigurationChangeImpact;
  readonly settings: ProviderConfiguration;
  readonly changedKeys: readonly string[];
}

const sensitiveMetadataKey =
  /(authorization|cookie|credential|password|secret|token)/iu;
const providerEntrySpecifier = "erc-chart-provider-entry";
const providerSdkUrl = import.meta.resolve("@erc-chart/provider-sdk");
const installedProviderRoots = new Set<string>();
let providerEntryUrl: string | undefined;
let providerHooksRegistered = false;
let providerLoadTail: Promise<void> = Promise.resolve();
const providerIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u;
const versionPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function requireText(
  value: unknown,
  label: string,
  maximumLength = 512,
): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > maximumLength
  ) {
    throw new ProviderRuntimeError(
      "PROVIDER_DEFINITION_INVALID",
      `${label} is invalid.`,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function installedRootForUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  return [...installedProviderRoots]
    .filter((root) => url.startsWith(root))
    .sort((left, right) => right.length - left.length)[0];
}

function registerProviderModuleHooks(): void {
  if (providerHooksRegistered) return;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === providerEntrySpecifier) {
        if (providerEntryUrl === undefined) {
          throw new Error("Provider entry is not active.");
        }
        return {
          url: providerEntryUrl,
          format: "module",
          shortCircuit: true,
        };
      }

      const parentRoot = installedRootForUrl(context.parentURL);
      if (parentRoot === undefined) return nextResolve(specifier, context);
      if (specifier === "@erc-chart/provider-sdk") {
        return { url: providerSdkUrl, format: "module", shortCircuit: true };
      }
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        throw new Error(
          "Provider module import is outside the public SDK boundary.",
        );
      }
      const candidate = new URL(specifier, context.parentURL).href;
      if (!candidate.startsWith(parentRoot)) {
        throw new Error(
          "Provider module import escapes the installation root.",
        );
      }
      const resolved = nextResolve(specifier, context);
      if (!resolved.url.startsWith(parentRoot)) {
        throw new Error(
          "Provider module import resolves outside the installation root.",
        );
      }
      return resolved.url.endsWith(".js")
        ? { ...resolved, format: "module" }
        : resolved;
    },
  });
  providerHooksRegistered = true;
}

async function importInstalledProviderModule(
  installationPath: string,
  entryPath: string,
): Promise<unknown> {
  const previousLoad = providerLoadTail;
  let releaseLoad: () => void = () => undefined;
  providerLoadTail = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  await previousLoad;
  try {
    registerProviderModuleHooks();
    const rootUrl = pathToFileURL(`${installationPath}${path.sep}`).href;
    installedProviderRoots.add(rootUrl);
    providerEntryUrl = pathToFileURL(entryPath).href;
    return await import("erc-chart-provider-entry");
  } finally {
    providerEntryUrl = undefined;
    releaseLoad();
  }
}

function validateDefinition(
  value: unknown,
  expectedPluginId: string,
  expectedVersion: string,
): ProviderDefinition {
  if (!isRecord(value) || !isRecord(value.metadata)) {
    throw new ProviderRuntimeError(
      "PROVIDER_DEFINITION_INVALID",
      "Provider entry must default-export a ProviderDefinition.",
    );
  }

  const metadata = value.metadata;
  const id = requireText(metadata.id, "Provider definition ID", 128);
  const version = requireText(
    value.version,
    "Provider definition version",
    128,
  );
  if (!providerIdPattern.test(id) || id !== expectedPluginId) {
    throw new ProviderRuntimeError(
      "PROVIDER_DEFINITION_INVALID",
      "Provider definition ID does not match the installed plugin.",
    );
  }
  if (!versionPattern.test(version) || version !== expectedVersion) {
    throw new ProviderRuntimeError(
      "PROVIDER_DEFINITION_INVALID",
      "Provider definition version does not match the installed plugin.",
    );
  }
  if (metadata.providerContractVersion !== providerContractVersion) {
    throw new ProviderRuntimeError(
      "PROVIDER_INCOMPATIBLE",
      "Provider contract version is incompatible with this host.",
    );
  }
  if (!isRecord(metadata.hostCompatibility)) {
    throw new ProviderRuntimeError(
      "PROVIDER_INCOMPATIBLE",
      "Provider host compatibility metadata is invalid.",
    );
  }
  const minimum = metadata.hostCompatibility.minimumHostApiVersion;
  const maximum = metadata.hostCompatibility.maximumHostApiVersion;
  if (
    typeof minimum !== "number" ||
    !Number.isSafeInteger(minimum) ||
    typeof maximum !== "number" ||
    !Number.isSafeInteger(maximum) ||
    minimum > maximum
  ) {
    throw new ProviderRuntimeError(
      "PROVIDER_INCOMPATIBLE",
      "Provider host compatibility metadata is invalid.",
    );
  }
  if (minimum > hostApiVersion || maximum < hostApiVersion) {
    throw new ProviderRuntimeError(
      "PROVIDER_INCOMPATIBLE",
      "Provider does not support the current host API version.",
    );
  }
  requireText(metadata.name, "Provider definition name", 256);
  if (typeof value.create !== "function") {
    throw new ProviderRuntimeError(
      "PROVIDER_DEFINITION_INVALID",
      "Provider definition adapter factory is invalid.",
    );
  }
  if (value.config !== undefined && !isRecord(value.config)) {
    throw new ProviderRuntimeError(
      "PROVIDER_DEFINITION_INVALID",
      "Provider configuration schema is invalid.",
    );
  }
  return value as unknown as ProviderDefinition;
}

function validateConfigurationField(
  key: string,
  field: ProviderConfigurationField,
): void {
  if (!isRecord(field)) {
    throw new ProviderRuntimeError(
      "PROVIDER_DEFINITION_INVALID",
      `Provider configuration field ${key} is invalid.`,
    );
  }
  if (!["boolean", "number", "string", "secret"].includes(field.type)) {
    throw new ProviderRuntimeError(
      "PROVIDER_DEFINITION_INVALID",
      `Provider configuration field ${key} has an unsupported type.`,
    );
  }
  if (field.required !== undefined && typeof field.required !== "boolean") {
    throw new ProviderRuntimeError(
      "PROVIDER_DEFINITION_INVALID",
      `Provider configuration field ${key} has invalid required metadata.`,
    );
  }
  if (
    field.requiresReconnect !== undefined &&
    typeof field.requiresReconnect !== "boolean"
  ) {
    throw new ProviderRuntimeError(
      "PROVIDER_DEFINITION_INVALID",
      `Provider configuration field ${key} has invalid reconnect metadata.`,
    );
  }
}

function validateFieldValue(
  key: string,
  field: ProviderConfigurationField,
  value: boolean | number | string,
): void {
  if (field.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new ProviderRuntimeError(
        "PROVIDER_CONFIG_INVALID",
        `Provider configuration field ${key} must be a boolean.`,
      );
    }
    return;
  }
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ProviderRuntimeError(
        "PROVIDER_CONFIG_INVALID",
        `Provider configuration field ${key} must be a finite number.`,
      );
    }
    if (field.minimum !== undefined && value < field.minimum) {
      throw new ProviderRuntimeError(
        "PROVIDER_CONFIG_INVALID",
        `Provider configuration field ${key} is below its minimum.`,
      );
    }
    if (field.maximum !== undefined && value > field.maximum) {
      throw new ProviderRuntimeError(
        "PROVIDER_CONFIG_INVALID",
        `Provider configuration field ${key} is above its maximum.`,
      );
    }
    return;
  }
  if (field.type === "string") {
    if (typeof value !== "string") {
      throw new ProviderRuntimeError(
        "PROVIDER_CONFIG_INVALID",
        `Provider configuration field ${key} must be a string.`,
      );
    }
    if (field.minLength !== undefined && value.length < field.minLength) {
      throw new ProviderRuntimeError(
        "PROVIDER_CONFIG_INVALID",
        `Provider configuration field ${key} is shorter than allowed.`,
      );
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      throw new ProviderRuntimeError(
        "PROVIDER_CONFIG_INVALID",
        `Provider configuration field ${key} is longer than allowed.`,
      );
    }
    return;
  }
  throw new ProviderRuntimeError(
    "PROVIDER_CONFIG_INVALID",
    `Provider secret field ${key} must not contain a persisted value.`,
  );
}

export function normalizeProviderConfigurationSchema(
  schema: ProviderConfigurationSchema,
  supplied: Readonly<Record<string, boolean | number | string>>,
  permissions: PluginManifestPermissions,
): ProviderConfiguration {
  if (!isRecord(supplied)) {
    throw new ProviderRuntimeError(
      "PROVIDER_CONFIG_INVALID",
      "Provider configuration must be an object.",
    );
  }
  const unknown = Object.keys(supplied).find(
    (key) => !Object.hasOwn(schema, key),
  );
  if (unknown !== undefined) {
    throw new ProviderRuntimeError(
      "PROVIDER_CONFIG_INVALID",
      `Provider configuration field ${unknown} is not declared by the provider.`,
    );
  }

  const normalized: Record<string, boolean | number | string> = {};
  for (const [key, field] of Object.entries(schema)) {
    validateConfigurationField(key, field);
    if (field.type === "secret") {
      const credentialKey = requireText(
        field.credentialKey,
        `Provider credential key for ${key}`,
        64,
      );
      if (!permissions.credentials.includes(credentialKey)) {
        throw new ProviderRuntimeError(
          "PROVIDER_PERMISSION_DENIED",
          `Provider credential ${credentialKey} is not declared by the plugin manifest.`,
        );
      }
      if (Object.hasOwn(supplied, key)) {
        throw new ProviderRuntimeError(
          "PROVIDER_CONFIG_INVALID",
          `Provider secret field ${key} must be retrieved through the credential lease.`,
        );
      }
      continue;
    }

    const value = Object.hasOwn(supplied, key)
      ? supplied[key]
      : field.defaultValue;
    if (value === undefined) {
      if (field.required === true) {
        throw new ProviderRuntimeError(
          "PROVIDER_CONFIG_INVALID",
          `Provider configuration field ${key} is required.`,
        );
      }
      continue;
    }
    validateFieldValue(key, field, value);
    normalized[key] = value;
  }
  return Object.freeze(normalized);
}

export function normalizeProviderConfiguration(
  definition: ProviderDefinition,
  supplied: Readonly<Record<string, boolean | number | string>>,
  permissions: PluginManifestPermissions,
): ProviderConfiguration {
  return normalizeProviderConfigurationSchema(
    definition.config ?? {},
    supplied,
    permissions,
  );
}

export function planProviderConfigurationChange(
  definition: ProviderDefinition,
  current: ProviderConfiguration,
  supplied: Readonly<Record<string, boolean | number | string>>,
  permissions: PluginManifestPermissions,
): ProviderConfigurationChangePlan {
  const schema = definition.config ?? {};
  const settings = normalizeProviderConfigurationSchema(
    schema,
    supplied,
    permissions,
  );
  const changedKeys = [
    ...new Set([...Object.keys(current), ...Object.keys(settings)]),
  ]
    .filter((key) => current[key] !== settings[key])
    .sort();
  const impact: ProviderConfigurationChangeImpact =
    changedKeys.length === 0
      ? "none"
      : changedKeys.some((key) => schema[key]?.requiresReconnect === true)
        ? "reconnect"
        : "restart";
  return Object.freeze({
    impact,
    settings,
    changedKeys: Object.freeze(changedKeys),
  });
}

function redactMetadataValue(
  value: unknown,
  secrets: ReadonlySet<string>,
  depth = 0,
): unknown {
  if (depth > 4) return "[REDACTED]";
  if (typeof value === "string") {
    let redacted = value;
    for (const secret of secrets) {
      if (secret !== "" && redacted.includes(secret)) {
        redacted = redacted.replaceAll(secret, "[REDACTED]");
      }
    }
    return redacted;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 64)
      .map((item) => redactMetadataValue(item, secrets, depth + 1));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 64)
      .map(([key, item]) => [
        key,
        sensitiveMetadataKey.test(key)
          ? "[REDACTED]"
          : redactMetadataValue(item, secrets, depth + 1),
      ]),
  );
}

function createProviderHostServices(
  providerProfileId: string,
  definition: ProviderDefinition,
  permissions: PluginManifestPermissions,
  broker: ProviderRuntimeHostBroker,
): ProviderHostServices {
  const secretValues = new Set<string>();
  const credentialKeys = new Set(
    Object.values(definition.config ?? {})
      .filter((field) => field.type === "secret")
      .map((field) => field.credentialKey),
  );

  const logger = Object.fromEntries(
    (["debug", "info", "warn", "error"] as const).map((level) => [
      level,
      (code: string, metadata?: Readonly<Record<string, unknown>>): void => {
        const checkedCode =
          typeof code === "string" && /^[A-Z][A-Z0-9_.-]{0,127}$/u.test(code)
            ? code
            : "PROVIDER_LOG_INVALID_CODE";
        const redacted =
          metadata === undefined
            ? undefined
            : (redactMetadataValue(metadata, secretValues) as Readonly<
                Record<string, unknown>
              >);
        broker.log(providerProfileId, level, checkedCode, redacted);
      },
    ]),
  ) as unknown as ProviderLogger;

  return Object.freeze({
    network: Object.freeze({
      request: async (
        request: ProviderNetworkRequest,
      ): Promise<ProviderNetworkResponse> => {
        if (
          !isProviderNetworkRequestAllowed(request.url, permissions.network)
        ) {
          throw new ProviderRuntimeError(
            "PROVIDER_PERMISSION_DENIED",
            "Provider network request is outside the approved manifest permissions.",
          );
        }
        return broker.requestNetwork(providerProfileId, request);
      },
    }),
    credentials: Object.freeze({
      get: async (credentialKey: string): Promise<string | null> => {
        if (
          !credentialKeys.has(credentialKey) ||
          !permissions.credentials.includes(credentialKey)
        ) {
          throw new ProviderRuntimeError(
            "PROVIDER_PERMISSION_DENIED",
            "Provider credential request is outside the approved manifest permissions.",
          );
        }
        const value = await broker.getCredential(
          providerProfileId,
          credentialKey,
        );
        if (value !== null) secretValues.add(value);
        return value;
      },
    }),
    logger,
    now: (): number => broker.now?.() ?? Date.now(),
    reportStatus: (status: ProviderStatus): void =>
      broker.reportStatus(providerProfileId, status),
  } satisfies ProviderHostServices);
}

function validateAdapter(value: unknown): ProviderAdapter {
  if (!isRecord(value)) {
    throw new ProviderRuntimeError(
      "PROVIDER_ADAPTER_INVALID",
      "Provider adapter factory returned an invalid adapter.",
    );
  }
  const requiredMethods = [
    "connect",
    "disconnect",
    "getCapabilities",
    "getInstruments",
    "requestHistory",
    "subscribe",
  ] as const;
  for (const method of requiredMethods) {
    if (typeof value[method] !== "function") {
      throw new ProviderRuntimeError(
        "PROVIDER_ADAPTER_INVALID",
        `Provider adapter is missing ${method}().`,
      );
    }
  }
  return value as unknown as ProviderAdapter;
}

async function resolveInstalledEntry(
  installationPath: string,
  entry: string,
): Promise<{ readonly installationPath: string; readonly entryPath: string }> {
  if (installationPath.trim() === "" || entry.trim() === "") {
    throw new ProviderRuntimeError(
      "PROVIDER_ENTRY_INVALID",
      "Installed provider entry path is required.",
    );
  }
  let managedRoot: string;
  try {
    managedRoot = await realpath(path.resolve(installationPath));
  } catch {
    throw new ProviderRuntimeError(
      "PROVIDER_ENTRY_INVALID",
      "Installed provider directory is unavailable.",
    );
  }
  const candidate = path.resolve(managedRoot, entry);
  const relative = path.relative(managedRoot, candidate);
  if (
    relative === "" ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new ProviderRuntimeError(
      "PROVIDER_ENTRY_INVALID",
      "Installed provider entry must remain inside the installation directory.",
    );
  }
  let info;
  try {
    info = await lstat(candidate);
  } catch {
    throw new ProviderRuntimeError(
      "PROVIDER_ENTRY_INVALID",
      "Installed provider entry is unavailable.",
    );
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new ProviderRuntimeError(
      "PROVIDER_ENTRY_INVALID",
      "Installed provider entry must be a regular file.",
    );
  }
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new ProviderRuntimeError(
      "PROVIDER_ENTRY_INVALID",
      "Installed provider entry is unavailable.",
    );
  }
  const resolvedRelative = path.relative(managedRoot, resolved);
  if (
    resolvedRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(resolvedRelative)
  ) {
    throw new ProviderRuntimeError(
      "PROVIDER_ENTRY_INVALID",
      "Installed provider entry resolves outside the installation directory.",
    );
  }
  return { installationPath: managedRoot, entryPath: resolved };
}

export async function instantiateInstalledProvider(
  options: InstalledProviderInstanceOptions,
): Promise<InstalledProviderInstance> {
  const providerProfileId = requireText(
    options.providerProfileId,
    "Provider profile ID",
    128,
  );
  const pluginId = requireText(options.pluginId, "Installed plugin ID", 128);
  const version = requireText(options.version, "Installed plugin version", 128);
  const resolvedEntry = await resolveInstalledEntry(
    options.installationPath,
    options.entry,
  );

  let imported: unknown;
  try {
    imported = await importInstalledProviderModule(
      resolvedEntry.installationPath,
      resolvedEntry.entryPath,
    );
  } catch {
    throw new ProviderRuntimeError(
      "PROVIDER_LOAD_FAILED",
      "Installed provider entry could not be loaded.",
    );
  }
  if (!isRecord(imported) || !("default" in imported)) {
    throw new ProviderRuntimeError(
      "PROVIDER_DEFINITION_INVALID",
      "Provider entry must have a default export.",
    );
  }
  const definition = validateDefinition(imported.default, pluginId, version);
  const settings = normalizeProviderConfiguration(
    definition,
    options.settings,
    options.permissions,
  );
  const host = createProviderHostServices(
    providerProfileId,
    definition,
    options.permissions,
    options.hostBroker,
  );

  let adapterValue: unknown;
  try {
    adapterValue = await definition.create(host, settings);
  } catch (error) {
    if (error instanceof ProviderRuntimeError) throw error;
    throw new ProviderRuntimeError(
      "PROVIDER_LOAD_FAILED",
      "Provider adapter factory failed.",
    );
  }
  return Object.freeze({
    providerProfileId,
    definition,
    adapter: validateAdapter(adapterValue),
    settings,
  });
}
