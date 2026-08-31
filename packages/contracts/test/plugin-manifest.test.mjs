import assert from "node:assert/strict";
import test from "node:test";
import {
  contractVersion,
  hostApiVersion,
  inspectPluginManifest,
  isPluginManifest,
  manifestVersion,
  pluginManifestSchema,
} from "../dist/index.js";

const digest = `sha256:${"a".repeat(64)}`;

function validManifest(overrides = {}) {
  return {
    manifestVersion,
    kind: "provider",
    id: "erc-chart.fixture-provider",
    name: "Fixture Provider",
    version: "1.2.3",
    hostCompatibility: {
      minimumHostApiVersion: hostApiVersion,
      maximumHostApiVersion: hostApiVersion,
    },
    entry: "dist/index.js",
    permissions: ["network.binomo"],
    capabilities: ["history", "live-data"],
    integrity: {
      "dist/index.js": digest,
      "plugin.json": digest,
    },
    ...overrides,
  };
}

test("exports a closed JSON Schema for plugin manifest v1", () => {
  assert.equal(
    pluginManifestSchema.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.equal(pluginManifestSchema.additionalProperties, false);
  assert.deepEqual(pluginManifestSchema.properties.kind.enum, [
    "provider",
    "indicator",
  ]);
  const entryPattern = new RegExp(
    pluginManifestSchema.properties.entry.pattern,
  );
  assert.equal(entryPattern.test("dist/index.js"), true);
  assert.equal(entryPattern.test("dist/index.mjs"), true);
  assert.equal(entryPattern.test("dist/index.cjs"), false);
  assert.equal(entryPattern.test("../index.js"), false);
  const namePattern = new RegExp(pluginManifestSchema.properties.name.pattern);
  assert.equal(namePattern.test("Fixture Provider"), true);
  assert.equal(namePattern.test(" Fixture Provider"), false);
  assert.equal(namePattern.test("Fixture Provider "), false);
});

test("accepts minimal provider and indicator manifests", () => {
  for (const manifest of [
    validManifest(),
    validManifest({
      kind: "indicator",
      id: "erc-chart.fixture-indicator",
      permissions: [],
      capabilities: ["candles"],
    }),
  ]) {
    assert.deepEqual(inspectPluginManifest(manifest), {
      ok: true,
      violations: [],
    });
    assert.equal(isPluginManifest(manifest), true);
  }
});

test("classifies unsupported manifest versions before other fields", () => {
  const result = inspectPluginManifest(
    validManifest({ manifestVersion: contractVersion(manifestVersion + 1) }),
  );

  assert.deepEqual(result.violations[0], {
    code: "UNSUPPORTED_MANIFEST_VERSION",
    path: "manifest.manifestVersion",
    message: `Expected plugin manifest version ${manifestVersion}.`,
  });
});

test("classifies incompatible host API ranges", () => {
  const unsupported = contractVersion(hostApiVersion + 1);
  const result = inspectPluginManifest(
    validManifest({
      hostCompatibility: {
        minimumHostApiVersion: unsupported,
        maximumHostApiVersion: unsupported,
      },
    }),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.violations[0], {
    code: "INCOMPATIBLE_HOST_API",
    path: "manifest.hostCompatibility",
    message: `Plugin must include host API ${hostApiVersion} in its compatibility range.`,
  });
});

test("rejects malformed manifest fields with precise paths", () => {
  const cases = [
    ["id", { id: "Fixture" }],
    ["version", { version: "v1.0.0" }],
    ["entry", { entry: "../index.js" }],
    ["entry", { entry: "dist/index.cjs" }],
    ["permissions", { permissions: ["network.binomo", "network.binomo"] }],
    ["capabilities", { capabilities: ["live-data", "history"] }],
    ["integrity", { integrity: { "../index.js": digest } }],
    ["integrity", { integrity: { "dist/index.js": "sha256:bad" } }],
    [null, { extra: true }],
  ];

  for (const [expectedPath, override] of cases) {
    const result = inspectPluginManifest(validManifest(override));
    assert.equal(result.ok, false, JSON.stringify(override));
    assert.equal(
      result.violations[0]?.code,
      "MALFORMED_PLUGIN_MANIFEST",
      JSON.stringify(override),
    );
    assert.equal(
      result.violations[0]?.path,
      expectedPath === null ? "manifest" : `manifest.${expectedPath}`,
      JSON.stringify(override),
    );
  }
});

test("rejects invalid compatibility bounds as malformed", () => {
  const result = inspectPluginManifest(
    validManifest({
      hostCompatibility: {
        minimumHostApiVersion: 2,
        maximumHostApiVersion: 1,
      },
    }),
  );

  assert.equal(result.violations[0]?.code, "MALFORMED_PLUGIN_MANIFEST");
  assert.equal(result.violations[0]?.path, "manifest.hostCompatibility");
});

test("contains hostile proxy failures as malformed manifests", () => {
  const value = new Proxy(validManifest(), {
    getPrototypeOf: () => {
      throw new Error("hostile proxy");
    },
  });

  assert.doesNotThrow(() => inspectPluginManifest(value));
  assert.deepEqual(inspectPluginManifest(value).violations[0], {
    code: "MALFORMED_PLUGIN_MANIFEST",
    path: "manifest",
    message:
      "Plugin manifest must be a plain object with only supported fields.",
  });
});

test("rejects non-plain and accessor-bearing runtime values", () => {
  const inherited = Object.create(validManifest());
  const accessor = validManifest();
  Object.defineProperty(accessor, "name", {
    enumerable: true,
    get: () => "Fixture Provider",
  });

  for (const value of [inherited, accessor]) {
    const result = inspectPluginManifest(value);
    assert.equal(result.ok, false);
    assert.equal(result.violations[0]?.path, "manifest");
  }
});
