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

export type PluginAuthoringLanguage = "javascript" | "typescript";
export type PluginStoragePermission = "plugin-settings" | "provider-cache";

export interface PluginManifestPublisher {
  readonly name: string;
  readonly id?: string;
}

export interface PluginManifestPermissions {
  readonly network: readonly string[];
  readonly credentials: readonly string[];
  readonly storage: readonly PluginStoragePermission[];
}

export type PluginManifestJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly PluginManifestJsonValue[]
  | PluginManifestJsonObject;

export interface PluginManifestJsonObject {
  readonly [key: string]: PluginManifestJsonValue;
}

export interface PluginManifestIntegrity {
  readonly algorithm: "sha256";
  readonly files: Readonly<Record<string, string>>;
}

export interface PluginManifestSignature {
  readonly algorithm: "ed25519";
  readonly publisherKeyId: string;
  readonly value: string;
}

export interface PluginManifest {
  readonly manifestVersion: ContractVersion;
  readonly id: string;
  readonly kind: PluginKind;
  readonly name: string;
  readonly description?: string;
  readonly publisher?: PluginManifestPublisher;
  readonly version: string;
  readonly apiVersion: string;
  readonly entry: string;
  readonly authoringLanguage: PluginAuthoringLanguage;
  readonly permissions: PluginManifestPermissions;
  readonly capabilities?: PluginManifestJsonObject;
  readonly integrity?: PluginManifestIntegrity;
  readonly signature?: PluginManifestSignature;
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

export const pluginManifestSchema: Readonly<Record<string, unknown>> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://erc-chart.local/schemas/plugin-manifest-v1.json",
  title: "ERC-chart Plugin Manifest v1",
  type: "object",
  additionalProperties: false,
  required: [
    "manifestVersion",
    "id",
    "kind",
    "name",
    "version",
    "apiVersion",
    "entry",
    "authoringLanguage",
    "permissions",
  ],
  properties: {
    manifestVersion: { const: 1 },
    id: {
      type: "string",
      pattern: "^[a-z0-9]+(?:[.-][a-z0-9]+)+$",
      minLength: 3,
      maxLength: 128,
    },
    kind: { enum: ["provider", "indicator"] },
    name: { type: "string", minLength: 1, maxLength: 100 },
    description: { type: "string", maxLength: 500 },
    publisher: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 100 },
        id: {
          type: "string",
          pattern: "^[a-z0-9]+(?:[.-][a-z0-9]+)+$",
        },
      },
    },
    version: {
      type: "string",
      pattern:
        "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$",
    },
    apiVersion: { type: "string", minLength: 1, maxLength: 50 },
    entry: {
      allOf: [
        {
          type: "string",
          pattern: "^dist/[A-Za-z0-9._/-]+\\.m?js$",
          maxLength: 240,
        },
        { not: { type: "string", pattern: "(^|/)\\.\\.(/|$)" } },
      ],
    },
    authoringLanguage: { enum: ["javascript", "typescript"] },
    permissions: { $ref: "#/$defs/permissions" },
    capabilities: { type: "object", additionalProperties: true },
    integrity: { $ref: "#/$defs/integrity" },
    signature: { $ref: "#/$defs/signature" },
  },
  $defs: {
    permissions: {
      type: "object",
      additionalProperties: false,
      properties: {
        network: {
          type: "array",
          uniqueItems: true,
          maxItems: 32,
          items: {
            type: "string",
            pattern: "^(https|wss)://[A-Za-z0-9.-]+(?::[0-9]+)?(?:/.*)?$",
            maxLength: 300,
          },
          default: [],
        },
        credentials: {
          type: "array",
          uniqueItems: true,
          maxItems: 32,
          items: {
            type: "string",
            pattern: "^[a-z][a-z0-9_-]{0,63}$",
          },
          default: [],
        },
        storage: {
          type: "array",
          uniqueItems: true,
          maxItems: 8,
          items: { enum: ["plugin-settings", "provider-cache"] },
          default: [],
        },
      },
      required: ["network", "credentials", "storage"],
    },
    integrity: {
      type: "object",
      additionalProperties: false,
      required: ["algorithm", "files"],
      properties: {
        algorithm: { const: "sha256" },
        files: {
          type: "object",
          minProperties: 1,
          additionalProperties: {
            type: "string",
            pattern: "^[A-Fa-f0-9]{64}$",
          },
          propertyNames: {
            allOf: [
              { type: "string", maxLength: 240 },
              { not: { type: "string", pattern: "(^|/)\\.\\.(/|$)" } },
            ],
          },
        },
      },
    },
    signature: {
      type: "object",
      additionalProperties: false,
      required: ["algorithm", "publisherKeyId", "value"],
      properties: {
        algorithm: { enum: ["ed25519"] },
        publisherKeyId: { type: "string", minLength: 1, maxLength: 128 },
        value: { type: "string", minLength: 1, maxLength: 1024 },
      },
    },
  },
};

interface SemanticVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const pluginIdExpression = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u;
const semanticVersionExpression =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const stableSemanticVersionExpression =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const packagePathExpression =
  /^(?!\/)(?![A-Za-z]:)(?!.*\\)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u;
const networkPermissionExpression =
  /^(https|wss):\/\/[A-Za-z0-9.-]+(?::[0-9]+)?(?:\/.*)?$/u;
const credentialPermissionExpression = /^[a-z][a-z0-9_-]{0,63}$/u;
const digestExpression = /^[A-Fa-f0-9]{64}$/u;
const requiredManifestFields = new Set<string>([
  "manifestVersion",
  "id",
  "kind",
  "name",
  "version",
  "apiVersion",
  "entry",
  "authoringLanguage",
  "permissions",
]);
const allowedManifestFields = new Set<string>([
  ...requiredManifestFields,
  "description",
  "publisher",
  "capabilities",
  "integrity",
  "signature",
]);
const permissionFields = new Set<string>(["network", "credentials", "storage"]);
const publisherFields = new Set<string>(["name", "id"]);
const integrityFields = new Set<string>(["algorithm", "files"]);
const signatureFields = new Set<string>([
  "algorithm",
  "publisherKeyId",
  "value",
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

function malformed(path: string, message: string): PluginManifestReport {
  return report([violation("MALFORMED_PLUGIN_MANIFEST", path, message)]);
}

function isPlainDataObject(value: unknown): value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined && descriptor.enumerable && "value" in descriptor
    );
  });
}

function hasRequiredAllowedFields(
  value: Record<string, unknown>,
  required: ReadonlySet<string>,
  allowed: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  return (
    keys.every((key) => allowed.has(key)) &&
    [...required].every((key) => Object.hasOwn(value, key))
  );
}

function hasExactFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function isBoundedString(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimumLength &&
    value.length <= maximumLength
  );
}

function isDenseArray(
  value: unknown,
  maximumLength: number,
): value is unknown[] {
  if (!Array.isArray(value) || value.length > maximumLength) return false;
  if (Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      return false;
    }
  }
  return true;
}

function isUniqueStringArray(
  value: unknown,
  maximumLength: number,
  predicate: (item: string) => boolean,
): value is string[] {
  if (!isDenseArray(value, maximumLength)) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !predicate(item) || seen.has(item)) {
      return false;
    }
    seen.add(item);
  }
  return true;
}

function isJsonValue(
  value: unknown,
  ancestors: ReadonlySet<object> = new Set<object>(),
  depth = 0,
): value is PluginManifestJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || depth >= 32 || ancestors.has(value)) {
    return false;
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    return (
      isDenseArray(value, 1024) &&
      value.every((item) => isJsonValue(item, nextAncestors, depth + 1))
    );
  }
  if (!isPlainDataObject(value)) return false;
  return Object.values(value).every((item) =>
    isJsonValue(item, nextAncestors, depth + 1),
  );
}

function parseStableSemanticVersion(value: string): SemanticVersion | null {
  const match = stableSemanticVersionExpression.exec(value);
  if (match === null) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return { major, minor, patch };
}

function compareSemanticVersions(
  left: SemanticVersion,
  right: SemanticVersion,
): number {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return 0;
}

function incrementVersion(
  version: SemanticVersion,
  component: "major" | "minor" | "patch",
): SemanticVersion {
  if (component === "major") {
    return { major: version.major + 1, minor: 0, patch: 0 };
  }
  if (component === "minor") {
    return { major: version.major, minor: version.minor + 1, patch: 0 };
  }
  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch + 1,
  };
}

function satisfiesComparator(
  current: SemanticVersion,
  token: string,
): boolean | null {
  const wildcardMatch =
    /^(0|[1-9][0-9]*)\.(x|\*|0|[1-9][0-9]*)(?:\.(x|\*|0|[1-9][0-9]*))?$/u.exec(
      token,
    );
  if (wildcardMatch !== null && /[x*]/u.test(token)) {
    const major = Number(wildcardMatch[1]);
    if (current.major !== major) return false;
    const minorToken = wildcardMatch[2];
    if (minorToken === "x" || minorToken === "*") return true;
    if (current.minor !== Number(minorToken)) return false;
    const patchToken = wildcardMatch[3];
    return patchToken === undefined || patchToken === "x" || patchToken === "*";
  }

  const shorthand = /^(\^|~)(.+)$/u.exec(token);
  if (shorthand !== null) {
    const base = parseStableSemanticVersion(shorthand[2] ?? "");
    if (base === null) return null;
    if (compareSemanticVersions(current, base) < 0) return false;
    const upper =
      shorthand[1] === "~"
        ? incrementVersion(base, "minor")
        : base.major > 0
          ? incrementVersion(base, "major")
          : base.minor > 0
            ? incrementVersion(base, "minor")
            : incrementVersion(base, "patch");
    return compareSemanticVersions(current, upper) < 0;
  }

  const comparator = /^(>=|<=|>|<|=)?(.+)$/u.exec(token);
  if (comparator === null) return null;
  const target = parseStableSemanticVersion(comparator[2] ?? "");
  if (target === null) return null;
  const comparison = compareSemanticVersions(current, target);
  switch (comparator[1] ?? "=") {
    case ">=":
      return comparison >= 0;
    case "<=":
      return comparison <= 0;
    case ">":
      return comparison > 0;
    case "<":
      return comparison < 0;
    case "=":
      return comparison === 0;
  }
  return null;
}

function inspectApiVersionRange(
  range: string,
  currentHostVersion: SemanticVersion,
): "compatible" | "incompatible" | "malformed" {
  const alternatives = range.split("||").map((part) => part.trim());
  if (alternatives.some((part) => part.length === 0)) return "malformed";
  let sawValidAlternative = false;
  for (const alternative of alternatives) {
    const tokens = alternative.split(/\s+/u);
    let alternativeMatches = true;
    for (const token of tokens) {
      const result = satisfiesComparator(currentHostVersion, token);
      if (result === null) return "malformed";
      sawValidAlternative = true;
      alternativeMatches &&= result;
    }
    if (alternativeMatches) return "compatible";
  }
  return sawValidAlternative ? "incompatible" : "malformed";
}

function isPackagePath(value: string): boolean {
  return value.length <= 240 && packagePathExpression.test(value);
}

function isPublisher(value: unknown): value is PluginManifestPublisher {
  if (
    !isPlainDataObject(value) ||
    !hasRequiredAllowedFields(value, new Set(["name"]), publisherFields)
  ) {
    return false;
  }
  if (!isBoundedString(value.name, 1, 100)) return false;
  if (value.id === undefined) return true;
  return isBoundedString(value.id, 1, 128) && pluginIdExpression.test(value.id);
}

function isPermissions(value: unknown): value is PluginManifestPermissions {
  if (!isPlainDataObject(value) || !hasExactFields(value, permissionFields)) {
    return false;
  }
  return (
    isUniqueStringArray(
      value.network,
      32,
      (item) => item.length <= 300 && networkPermissionExpression.test(item),
    ) &&
    isUniqueStringArray(value.credentials, 32, (item) =>
      credentialPermissionExpression.test(item),
    ) &&
    isUniqueStringArray(
      value.storage,
      8,
      (item) => item === "plugin-settings" || item === "provider-cache",
    )
  );
}

function isIntegrity(
  value: unknown,
  entry: string,
): value is PluginManifestIntegrity {
  if (!isPlainDataObject(value) || !hasExactFields(value, integrityFields)) {
    return false;
  }
  if (value.algorithm !== "sha256" || !isPlainDataObject(value.files)) {
    return false;
  }
  const entries = Object.entries(value.files);
  return (
    entries.length >= 1 &&
    entries.length <= 4096 &&
    entries.every(
      ([path, digest]) =>
        isPackagePath(path) &&
        typeof digest === "string" &&
        digestExpression.test(digest),
    ) &&
    Object.hasOwn(value.files, entry)
  );
}

function isSignature(value: unknown): value is PluginManifestSignature {
  if (!isPlainDataObject(value) || !hasExactFields(value, signatureFields)) {
    return false;
  }
  return (
    value.algorithm === "ed25519" &&
    isBoundedString(value.publisherKeyId, 1, 128) &&
    isBoundedString(value.value, 1, 1024)
  );
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
      "Plugin manifest must be plain JSON data using only supported fields.",
    );
  }
}

function inspectPluginManifestValue(
  value: unknown,
  currentHostApiVersion: ContractVersion,
): PluginManifestReport {
  if (
    !isPlainDataObject(value) ||
    !hasRequiredAllowedFields(
      value,
      requiredManifestFields,
      allowedManifestFields,
    )
  ) {
    return malformed(
      "manifest",
      "Plugin manifest must be plain JSON data using only supported fields.",
    );
  }
  if (
    typeof value.manifestVersion !== "number" ||
    !Number.isSafeInteger(value.manifestVersion) ||
    value.manifestVersion < 1
  ) {
    return malformed(
      "manifest.manifestVersion",
      "Manifest version must be a positive safe integer.",
    );
  }
  if (value.manifestVersion !== manifestVersion) {
    return report([
      violation(
        "UNSUPPORTED_MANIFEST_VERSION",
        "manifest.manifestVersion",
        `Expected plugin manifest version ${manifestVersion}.`,
      ),
    ]);
  }
  if (
    !isBoundedString(value.id, 3, 128) ||
    !pluginIdExpression.test(value.id)
  ) {
    return malformed("manifest.id", "Plugin ID is malformed.");
  }
  if (value.kind !== "provider" && value.kind !== "indicator") {
    return malformed("manifest.kind", "Plugin kind is unsupported.");
  }
  if (!isBoundedString(value.name, 1, 100)) {
    return malformed("manifest.name", "Plugin name is malformed.");
  }
  if (
    value.description !== undefined &&
    !isBoundedString(value.description, 0, 500)
  ) {
    return malformed(
      "manifest.description",
      "Plugin description is malformed.",
    );
  }
  if (value.publisher !== undefined && !isPublisher(value.publisher)) {
    return malformed("manifest.publisher", "Plugin publisher is malformed.");
  }
  if (
    typeof value.version !== "string" ||
    !semanticVersionExpression.test(value.version)
  ) {
    return malformed(
      "manifest.version",
      "Plugin version must be valid SemVer.",
    );
  }
  if (!isBoundedString(value.apiVersion, 1, 50)) {
    return malformed("manifest.apiVersion", "Host API range is malformed.");
  }
  const apiVersionResult = inspectApiVersionRange(value.apiVersion, {
    major: currentHostApiVersion,
    minor: 0,
    patch: 0,
  });
  if (apiVersionResult === "malformed") {
    return malformed("manifest.apiVersion", "Host API range is malformed.");
  }
  if (apiVersionResult === "incompatible") {
    return report([
      violation(
        "INCOMPATIBLE_HOST_API",
        "manifest.apiVersion",
        `Plugin must include host API ${currentHostApiVersion}.0.0.`,
      ),
    ]);
  }
  if (
    !isBoundedString(value.entry, 1, 240) ||
    !value.entry.startsWith("dist/") ||
    !isPackagePath(value.entry) ||
    !/\.m?js$/u.test(value.entry)
  ) {
    return malformed(
      "manifest.entry",
      "Plugin entry must be a safe precompiled ESM JavaScript path under dist/.",
    );
  }
  if (
    value.authoringLanguage !== "javascript" &&
    value.authoringLanguage !== "typescript"
  ) {
    return malformed(
      "manifest.authoringLanguage",
      "Plugin authoring language is unsupported.",
    );
  }
  if (!isPermissions(value.permissions)) {
    return malformed(
      "manifest.permissions",
      "Plugin permissions are malformed.",
    );
  }
  if (
    value.capabilities !== undefined &&
    (!isPlainDataObject(value.capabilities) || !isJsonValue(value.capabilities))
  ) {
    return malformed(
      "manifest.capabilities",
      "Plugin capabilities must contain plain JSON data.",
    );
  }
  if (
    value.integrity !== undefined &&
    !isIntegrity(value.integrity, value.entry)
  ) {
    return malformed(
      "manifest.integrity",
      "Plugin integrity metadata is malformed.",
    );
  }
  if (value.signature !== undefined && !isSignature(value.signature)) {
    return malformed(
      "manifest.signature",
      "Plugin signature metadata is malformed.",
    );
  }
  return report([]);
}

export function isPluginManifest(
  value: unknown,
  currentHostApiVersion: ContractVersion = hostApiVersion,
): value is PluginManifest {
  return inspectPluginManifest(value, currentHostApiVersion).ok;
}
