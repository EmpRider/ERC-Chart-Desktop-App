import { createPublicKey, verify } from "node:crypto";
import type { PluginManifest } from "@erc-chart/contracts";
import type {
  StagedPluginFile,
  StagedPluginPackage,
} from "./plugin-staging.js";

export type PluginTrustMode = "production" | "developer";

export interface PluginTrustPolicy {
  readonly mode: PluginTrustMode;
  readonly trustedPublisherKeys: Readonly<Record<string, string>>;
}

export type PluginTrustResult =
  | {
      readonly kind: "trusted-signed";
      readonly publisherKeyId: string;
    }
  | {
      readonly kind: "unsigned-developer";
    };

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new Error("Plugin signature payload contains unsupported data.");
    }
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function createPluginSignaturePayload(manifest: PluginManifest): Buffer {
  const unsignedManifest = { ...manifest } as Record<string, unknown>;
  delete unsignedManifest.signature;
  return Buffer.from(canonicalJson(unsignedManifest), "utf8");
}

function assertIntegrity(
  manifest: PluginManifest,
  files: readonly StagedPluginFile[],
): void {
  const integrity = manifest.integrity;
  if (integrity === undefined) {
    throw new Error("Plugin package integrity metadata is required.");
  }

  const contentFiles = files.filter((file) => file.path !== "plugin.json");
  const declaredPaths = Object.keys(integrity.files).sort();
  const actualPaths = contentFiles.map((file) => file.path).sort();
  if (
    declaredPaths.length !== actualPaths.length ||
    declaredPaths.some((filePath, index) => filePath !== actualPaths[index])
  ) {
    throw new Error(
      "Plugin integrity metadata must cover every package file except plugin.json exactly once.",
    );
  }

  for (const file of contentFiles) {
    if (integrity.files[file.path] !== file.sha256) {
      throw new Error(`Plugin integrity check failed for ${file.path}.`);
    }
  }
}

function decodeSignature(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/u.test(value)) {
    throw new Error(
      "Plugin signature must be a canonical Ed25519 base64 value.",
    );
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== value) {
    throw new Error(
      "Plugin signature must be a canonical Ed25519 base64 value.",
    );
  }
  return decoded;
}

export function assertPluginPackageTrust(
  staged: StagedPluginPackage,
  policy: PluginTrustPolicy,
): PluginTrustResult {
  assertIntegrity(staged.manifest, staged.files);

  const signature = staged.manifest.signature;
  if (signature === undefined) {
    if (policy.mode === "production") {
      throw new Error(
        "Production Mode requires a trusted signed plugin package.",
      );
    }
    return { kind: "unsigned-developer" };
  }

  const publicKeyPem = policy.trustedPublisherKeys[signature.publisherKeyId];
  if (publicKeyPem === undefined) {
    throw new Error(
      `Plugin publisher key is not trusted: ${signature.publisherKeyId}.`,
    );
  }

  let publicKey;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch (error) {
    throw new Error("Configured plugin publisher key is invalid.", {
      cause: error,
    });
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Configured plugin publisher key must use Ed25519.");
  }

  const signatureBytes = decodeSignature(signature.value);
  if (
    !verify(
      null,
      createPluginSignaturePayload(staged.manifest),
      publicKey,
      signatureBytes,
    )
  ) {
    throw new Error("Plugin signature verification failed.");
  }

  return {
    kind: "trusted-signed",
    publisherKeyId: signature.publisherKeyId,
  };
}
