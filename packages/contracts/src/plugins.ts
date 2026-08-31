import {
  hostApiVersion,
  manifestVersion,
  type ContractVersion,
} from "./versions.js";

export type PluginKind = "provider" | "indicator";

export interface CompatibilityRange {
  readonly minimumHostApiVersion: ContractVersion;
  readonly maximumHostApiVersion: ContractVersion;
}

export type PluginManifestIntegrity = Readonly<Record<string, string>>;

export interface PluginManifest {
  readonly manifestVersion: ContractVersion;
  readonly kind: PluginKind;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly hostCompatibility: CompatibilityRange;
  readonly entry: string;
  readonly permissions: readonly string[];
  readonly capabilities: readonly string[];
  readonly integrity: PluginManifestIntegrity;
}

export type PluginManifestViolationCode =
  | "INCOMPATIBLE_HOST_API"
  | "MALFORMED_PLUGIN_MANIFEST"
  | "UNSUPPORTED_MANIFEST_VERSION";

export interface PluginManifestViolation {
  readonly code: PluginManifestViolationCode;
  readonly path: string;
  readonly message: string;
}

export interface PluginManifestReport {
  readonly ok: boolean;
  readonly violations: readonly PluginManifestViolation[];
}

const declarationPattern = "^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$";
const pluginIdPattern = "^[a-z0-9]+(?:[.-][a-z0-9]+)+$";
const semverPattern =
  "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*))*)?$";
const packagePathPattern =
  "^(?![A-Za-z]:)(?!/)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*\\\\)[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$";
const digestPattern = "^sha256:[a-f0-9]{64}$";

export const pluginManifestSchema: Readonly<Record<string, unknown>> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://erc-chart.local/schemas/plugin-manifest-v1.json",
  title: "ERC Chart Plugin Manifest v1",
  type: "object",
  additionalProperties: false,
  required: [
    "manifestVersion",
    "kind",
    "id",
    "name",
    "version",
    "hostCompatibility",
    "entry",
    "permissions",
    "capabilities",
    "integrity",
  ],
  properties: {
    manifestVersion: { type: "integer", const: manifestVersion },
    kind: { type: "string", enum: ["provider", "indicator"] },
    id: { type: "string", pattern: pluginIdPattern, maxLength: 128 },
    name: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^\\S(?:.*\\S)?$",
    },
    version: { type: "string", pattern: semverPattern, maxLength: 128 },
    hostCompatibility: {
      type: "object",
      additionalProperties: false,
      required: ["minimumHostApiVersion", "maximumHostApiVersion"],
      properties: {
        minimumHostApiVersion: {
          type: "integer",
          minimum: 1,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        maximumHostApiVersion: {
          type: "integer",
          minimum: 1,
          maximum: Number.MAX_SAFE_INTEGER,
        },
      },
    },
    entry: {
      type: "string",
      pattern: `${packagePathPattern.slice(0, -1)}\\.m?js$`,
      maxLength: 260,
    },
    permissions: {
      type: "array",
      maxItems: 128,
      uniqueItems: true,
      items: { type: "string", pattern: declarationPattern, maxLength: 128 },
    },
    capabilities: {
      type: "array",
      maxItems: 128,
      uniqueItems: true,
      items: { type: "string", pattern: declarationPattern, maxLength: 128 },
    },
    integrity: {
      type: "object",
      minProperties: 1,
      maxProperties: 4096,
      propertyNames: { pattern: packagePathPattern, maxLength: 260 },
      additionalProperties: {
        type: "string",
        pattern: digestPattern,
      },
    },
  },
} as const;

const declarationExpression = new RegExp(declarationPattern);
const pluginIdExpression = new RegExp(pluginIdPattern);
const semverExpression = new RegExp(semverPattern);
const packagePathExpression = new RegExp(packagePathPattern);
const digestExpression = new RegExp(digestPattern);
const manifestFields = new Set<string>([
  "manifestVersion",
  "kind",
  "id",
  "name",
  "version",
  "hostCompatibility",
  "entry",
  "permissions",
  "capabilities",
  "integrity",
]);
const compatibilityFields = new Set([
  "minimumHostApiVersion",
  "maximumHostApiVersion",
]);

function violation(
  code: PluginManifestViolationCode,
  path: string,
  message: string,
): PluginManifestViolation {
  return { code, path, message };
}

function report(
  violations: readonly PluginManifestViolation[],
): PluginManifestReport {
  return { ok: violations.length === 0, violations };
}

function isDataObject(value: unknown): value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined && descriptor.enumerable && "value" in descriptor
    );
  });
}

function hasExactFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    /^\S(?:[\s\S]*\S)?$/u.test(value)
  );
}

function isDenseStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > 128) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.at(-1) !== "length")
    return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    return (
      descriptor !== undefined &&
      descriptor.enumerable &&
      "value" in descriptor &&
      typeof descriptor.value === "string"
    );
  });
}

function isSortedDeclarations(value: unknown): value is string[] {
  if (!isDenseStringArray(value)) return false;
  return value.every((item, index) => {
    const previous = value[index - 1];
    return (
      item.length <= 128 &&
      declarationExpression.test(item) &&
      (previous === undefined || previous < item)
    );
  });
}

function isPackagePath(value: string): boolean {
  return value.length <= 260 && packagePathExpression.test(value);
}

function malformed(path: string, message: string): PluginManifestReport {
  return report([violation("MALFORMED_PLUGIN_MANIFEST", path, message)]);
}

export function inspectPluginManifest(
  value: unknown,
  currentHostApiVersion: ContractVersion = hostApiVersion,
): PluginManifestReport {
  try {
    return inspectPluginManifestValue(value, currentHostApiVersion);
  } catch {
    return malformed(
      "manifest",
      "Plugin manifest must be a plain object with only supported fields.",
    );
  }
}

function inspectPluginManifestValue(
  value: unknown,
  currentHostApiVersion: ContractVersion,
): PluginManifestReport {
  if (!isDataObject(value) || !hasExactFields(value, manifestFields))
    return malformed(
      "manifest",
      "Plugin manifest must be a plain object with only supported fields.",
    );

  if (!isPositiveSafeInteger(value.manifestVersion))
    return malformed(
      "manifest.manifestVersion",
      "Manifest version must be a positive safe integer.",
    );
  if (value.manifestVersion !== manifestVersion)
    return report([
      violation(
        "UNSUPPORTED_MANIFEST_VERSION",
        "manifest.manifestVersion",
        `Expected plugin manifest version ${manifestVersion}.`,
      ),
    ]);

  if (value.kind !== "provider" && value.kind !== "indicator")
    return malformed("manifest.kind", "Plugin kind is unsupported.");
  if (!isBoundedText(value.id, 128) || !pluginIdExpression.test(value.id))
    return malformed("manifest.id", "Plugin ID is malformed.");
  if (!isBoundedText(value.name, 128))
    return malformed("manifest.name", "Plugin name is malformed.");
  if (
    !isBoundedText(value.version, 128) ||
    !semverExpression.test(value.version)
  )
    return malformed("manifest.version", "Plugin version is malformed.");

  const compatibility = value.hostCompatibility;
  if (
    !isDataObject(compatibility) ||
    !hasExactFields(compatibility, compatibilityFields) ||
    !isPositiveSafeInteger(compatibility.minimumHostApiVersion) ||
    !isPositiveSafeInteger(compatibility.maximumHostApiVersion) ||
    compatibility.minimumHostApiVersion > compatibility.maximumHostApiVersion
  )
    return malformed(
      "manifest.hostCompatibility",
      "Host compatibility range is malformed.",
    );
  if (
    compatibility.minimumHostApiVersion > currentHostApiVersion ||
    compatibility.maximumHostApiVersion < currentHostApiVersion
  )
    return report([
      violation(
        "INCOMPATIBLE_HOST_API",
        "manifest.hostCompatibility",
        `Plugin must include host API ${currentHostApiVersion} in its compatibility range.`,
      ),
    ]);

  if (
    !isBoundedText(value.entry, 260) ||
    !isPackagePath(value.entry) ||
    !/\.m?js$/.test(value.entry)
  )
    return malformed("manifest.entry", "Plugin entry path is malformed.");
  if (!isSortedDeclarations(value.permissions))
    return malformed(
      "manifest.permissions",
      "Plugin permissions must be sorted unique identifiers.",
    );
  if (!isSortedDeclarations(value.capabilities))
    return malformed(
      "manifest.capabilities",
      "Plugin capabilities must be sorted unique identifiers.",
    );

  if (!isDataObject(value.integrity))
    return malformed(
      "manifest.integrity",
      "Plugin integrity map is malformed.",
    );
  const integrityEntries = Object.entries(value.integrity);
  if (
    integrityEntries.length === 0 ||
    integrityEntries.length > 4096 ||
    integrityEntries.some(
      ([packagePath, digest]) =>
        !isPackagePath(packagePath) ||
        typeof digest !== "string" ||
        !digestExpression.test(digest),
    ) ||
    !Object.hasOwn(value.integrity, value.entry)
  )
    return malformed(
      "manifest.integrity",
      "Plugin integrity map is malformed.",
    );

  return report([]);
}

export function isPluginManifest(
  value: unknown,
  currentHostApiVersion: ContractVersion = hostApiVersion,
): value is PluginManifest {
  return inspectPluginManifest(value, currentHostApiVersion).ok;
}
