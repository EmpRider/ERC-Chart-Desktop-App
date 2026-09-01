import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  hostApiVersion,
  inspectPluginManifest,
  isPluginManifest,
  manifestVersion,
  pluginManifestSchema,
} from "../dist/index.js";

const digest = "a".repeat(64);

function validManifest(overrides = {}) {
  return {
    manifestVersion,
    id: "com.erc-chart.provider.fixture",
    kind: "provider",
    name: "Fixture Provider",
    version: "1.2.3",
    apiVersion: `^${hostApiVersion}.0.0`,
    entry: "dist/index.js",
    authoringLanguage: "typescript",
    permissions: {
      network: ["https://api.example.com/v1/", "wss://stream.example.com/"],
      credentials: ["auth_token", "device_id"],
      storage: ["plugin-settings", "provider-cache"],
    },
    ...overrides,
  };
}

test("exports the architecture JSON Schema without contract drift", async () => {
  const documented = JSON.parse(
    await readFile(
      new URL(
        "../../../docs/architecture/v1/contracts/plugin-manifest.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  assert.deepEqual(pluginManifestSchema, documented);
  assert.equal(pluginManifestSchema.additionalProperties, false);
  assert.deepEqual(pluginManifestSchema.properties.kind.enum, [
    "provider",
    "indicator",
  ]);
});

test("accepts provider and indicator manifests using the reconciled contract", () => {
  const manifests = [
    validManifest(),
    validManifest({
      id: "com.erc-chart.indicator.fixture",
      kind: "indicator",
      authoringLanguage: "javascript",
      permissions: { network: [], credentials: [], storage: [] },
      capabilities: { plots: ["main"], overlay: false },
      integrity: {
        algorithm: "sha256",
        files: { "dist/index.js": digest },
      },
      signature: {
        algorithm: "ed25519",
        publisherKeyId: "erc-chart-release-1",
        value: "fixture-signature",
      },
    }),
  ];

  for (const manifest of manifests) {
    assert.deepEqual(inspectPluginManifest(manifest), {
      ok: true,
      violations: [],
    });
    assert.equal(isPluginManifest(manifest), true);
  }
});

test("rejects unsupported manifest versions and incompatible host API ranges", () => {
  const unsupportedManifest = inspectPluginManifest(
    validManifest({ manifestVersion: manifestVersion + 1 }),
  );
  assert.equal(unsupportedManifest.ok, false);
  assert.equal(
    unsupportedManifest.violations[0]?.code,
    "UNSUPPORTED_MANIFEST_VERSION",
  );
  assert.equal(
    unsupportedManifest.violations[0]?.path,
    "manifest.manifestVersion",
  );

  const incompatible = inspectPluginManifest(
    validManifest({ apiVersion: `^${hostApiVersion + 1}.0.0` }),
  );
  assert.equal(incompatible.ok, false);
  assert.equal(incompatible.violations[0]?.code, "INCOMPATIBLE_HOST_API");
  assert.equal(incompatible.violations[0]?.path, "manifest.apiVersion");
});

test("rejects versions outside strict SemVer syntax", () => {
  for (const version of ["01.0.0", "1.0.0-alpha..1", "1.0.0-01"]) {
    const result = inspectPluginManifest(validManifest({ version }));
    assert.equal(result.ok, false, version);
    assert.equal(result.violations[0]?.path, "manifest.version", version);
  }

  assert.equal(
    inspectPluginManifest(validManifest({ version: "1.0.0-rc.1+build.7" })).ok,
    true,
  );
});

test("supports bounded standard host API range forms", () => {
  for (const apiVersion of [
    `${hostApiVersion}.0.0`,
    `^${hostApiVersion}.0.0`,
    `~${hostApiVersion}.0.0`,
    `>=${hostApiVersion}.0.0 <${hostApiVersion + 1}.0.0`,
    `${hostApiVersion}.x`,
  ]) {
    assert.equal(
      inspectPluginManifest(validManifest({ apiVersion })).ok,
      true,
      apiVersion,
    );
  }

  const malformed = inspectPluginManifest(
    validManifest({ apiVersion: "not-a-semver-range" }),
  );
  assert.equal(malformed.violations[0]?.code, "MALFORMED_PLUGIN_MANIFEST");
  assert.equal(malformed.violations[0]?.path, "manifest.apiVersion");
});

test("validates dist entry paths and structured permissions", () => {
  const cases = [
    ["entry", { entry: "../index.js" }],
    ["entry", { entry: "index.js" }],
    ["entry", { entry: "dist/index.cjs" }],
    ["entry", { entry: "dist\\index.js" }],
    [
      "permissions",
      {
        permissions: {
          network: ["http://api.example.com/"],
          credentials: [],
          storage: [],
        },
      },
    ],
    [
      "permissions",
      {
        permissions: {
          network: [],
          credentials: ["AuthToken"],
          storage: [],
        },
      },
    ],
    [
      "permissions",
      {
        permissions: {
          network: [],
          credentials: [],
          storage: ["filesystem"],
        },
      },
    ],
  ];

  for (const [field, override] of cases) {
    const result = inspectPluginManifest(validManifest(override));
    assert.equal(result.ok, false, JSON.stringify(override));
    assert.equal(result.violations[0]?.code, "MALFORMED_PLUGIN_MANIFEST");
    assert.equal(result.violations[0]?.path, `manifest.${field}`);
  }
});

test("validates optional integrity and Ed25519 signature structures", () => {
  const invalidIntegrity = inspectPluginManifest(
    validManifest({
      integrity: {
        algorithm: "sha256",
        files: { "../dist/index.js": digest },
      },
    }),
  );
  assert.equal(invalidIntegrity.ok, false);
  assert.equal(invalidIntegrity.violations[0]?.path, "manifest.integrity");

  const missingEntryDigest = inspectPluginManifest(
    validManifest({
      integrity: {
        algorithm: "sha256",
        files: { "dist/other.js": digest },
      },
    }),
  );
  assert.equal(missingEntryDigest.ok, false);
  assert.equal(missingEntryDigest.violations[0]?.path, "manifest.integrity");

  const invalidSignature = inspectPluginManifest(
    validManifest({
      signature: {
        algorithm: "rsa",
        publisherKeyId: "release-key",
        value: "signature",
      },
    }),
  );
  assert.equal(invalidSignature.ok, false);
  assert.equal(invalidSignature.violations[0]?.path, "manifest.signature");
});

test("rejects extra fields, accessors, cycles, and hostile proxies without throwing", () => {
  const withExtra = inspectPluginManifest(validManifest({ unexpected: true }));
  assert.equal(withExtra.ok, false);
  assert.equal(withExtra.violations[0]?.path, "manifest");

  const accessor = validManifest();
  Object.defineProperty(accessor, "name", {
    enumerable: true,
    get: () => "Fixture Provider",
  });
  assert.equal(inspectPluginManifest(accessor).ok, false);

  const capabilities = {};
  capabilities.self = capabilities;
  assert.equal(
    inspectPluginManifest(validManifest({ capabilities })).ok,
    false,
  );

  const hostile = new Proxy(validManifest(), {
    getPrototypeOf: () => {
      throw new Error("hostile proxy");
    },
  });
  assert.doesNotThrow(() => inspectPluginManifest(hostile));
  assert.equal(inspectPluginManifest(hostile).ok, false);
});
