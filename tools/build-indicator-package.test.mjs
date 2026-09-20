import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { isInstalledIndicatorDefinition } from "../packages/contracts/dist/index.js";
import {
  discardStagedPlugin,
  stagePluginPackage,
} from "../packages/provider-runtime/dist/index.js";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";
import { validateIndicatorAuthoringTypes } from "./indicator-authoring-transform.mjs";

test("package build requires compiler SDK declaration resolution", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "erc-missing-sdk-declaration-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.resolve(
    import.meta.dirname,
    "../packages/indicator-examples/src/atr-bands.ts",
  );
  const declarationPath = path.resolve(
    import.meta.dirname,
    "../packages/indicator-sdk/dist/index.d.ts",
  );
  const fileExists = ts.sys.fileExists;
  t.mock.method(ts.sys, "fileExists", (candidate) =>
    path.resolve(candidate) === declarationPath ? false : fileExists(candidate),
  );

  await assert.rejects(
    buildIndicatorPackage({
      source,
      outputRoot: path.join(directory, "package"),
      id: "erc.indicator.atr-bands",
      version: "0.1.0",
    }),
    /Authoring typecheck could not resolve compiler SDK declaration/u,
  );
});

test("package build validates imported authored helper modules", async (t) => {
  const sourceRoot = await mkdtemp(
    path.join(import.meta.dirname, ".typecheck-helper-source-"),
  );
  const outputRoot = await mkdtemp(
    path.join(os.tmpdir(), "erc-typecheck-helper-output-"),
  );
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  await writeFile(
    path.join(sourceRoot, "package.json"),
    '{"name":"typecheck-helper-fixture","private":true,"type":"module"}\n',
    "utf8",
  );
  const source = path.join(sourceRoot, "index.ts");
  const helper = path.join(sourceRoot, "helper.ts");
  await writeFile(
    source,
    `
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
import { helperValue } from "./helper.js";
export default defineIndicator({
  id: "erc.indicator.typecheck-helper.main",
  name: "Typecheck helper",
});
void helperValue;
plot.line(close);
`,
    "utf8",
  );
  await writeFile(helper, "export const helperValue: string = 42;\n", "utf8");

  await assert.rejects(
    buildIndicatorPackage({
      source,
      outputRoot: path.join(outputRoot, "invalid-package"),
      id: "erc.indicator.typecheck-helper",
      version: "0.1.0",
    }),
    /helper\.ts:\d+:\d+ Type 'number' is not assignable to type 'string'/u,
  );

  await writeFile(helper, 'export const helperValue = "valid";\n', "utf8");
  await buildIndicatorPackage({
    source,
    outputRoot: path.join(outputRoot, "valid-package"),
    id: "erc.indicator.typecheck-helper",
    version: "0.1.0",
  });
});

test("maintained indicator examples stay behind the authoring compiler boundary", async () => {
  const examplesRoot = path.resolve(
    import.meta.dirname,
    "../packages/indicator-examples",
  );
  const tsconfig = JSON.parse(
    await readFile(path.join(examplesRoot, "tsconfig.json"), "utf8"),
  );
  assert.deepEqual(tsconfig.include, ["src/index.ts"]);

  const authoredSources = (await readdir(path.join(examplesRoot, "src")))
    .filter((file) => file.endsWith(".ts") && file !== "index.ts")
    .sort();
  assert.ok(
    authoredSources.length > 0,
    "expected maintained indicator sources",
  );

  const publicEntry = await readFile(
    path.join(examplesRoot, "src/index.ts"),
    "utf8",
  );
  for (const file of authoredSources) {
    const moduleSpecifier = `./${path.parse(file).name}`;
    assert.equal(
      publicEntry.includes(moduleSpecifier),
      false,
      `${file} must stay behind the authoring compiler boundary`,
    );
  }

  for (const file of authoredSources) {
    const sourcePath = path.join(examplesRoot, "src", file);
    validateIndicatorAuthoringTypes(await readFile(sourcePath, "utf8"), {
      fileName: sourcePath,
    });
  }
});

test("packages a scalar-authored indicator with generated metadata and a self-contained runtime", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "erc-authored-package-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.resolve(
    import.meta.dirname,
    "../packages/indicator-examples/src/atr-bands.ts",
  );
  const outputRoot = path.join(directory, "package");
  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(outputRoot, "stale.txt"), "stale\n", "utf8");
  const { archivePath, manifest, packageRoot } = await buildIndicatorPackage({
    source,
    outputRoot,
    id: "erc.indicator.atr-bands",
    version: "0.1.0",
  });
  await assert.rejects(readFile(path.join(packageRoot, "stale.txt")), {
    code: "ENOENT",
  });
  assert.equal(
    isInstalledIndicatorDefinition(manifest.capabilities.indicatorDefinition),
    true,
  );
  assert.equal(manifest.capabilities.indicatorDefinition.outputs.length, 4);
  const entry = await readFile(path.join(packageRoot, manifest.entry));
  assert.equal(
    createHash("sha256").update(entry).digest("hex"),
    manifest.integrity.files[manifest.entry],
  );
  const { default: plugin } = await import(
    `data:text/javascript;base64,${entry.toString("base64")}`
  );
  assert.deepEqual(
    plugin.definition,
    manifest.capabilities.indicatorDefinition,
  );
  const instance = plugin.createInstance(
    {},
    { instrumentId: "TEST", timeframeId: "1m" },
  );
  instance.onHistory(
    Array.from({ length: 20 }, (_, index) => ({
      instrumentId: "TEST",
      timeframeId: "1m",
      openTimeMs: index * 60_000,
      open: index + 10,
      high: index + 12,
      low: index + 9,
      close: index + 11,
    })),
  );
  assert.equal(instance.snapshot().points.length, 20);
  assert.ok(Number.isFinite(instance.snapshot().points.at(-1).values.plot_0));
  instance.dispose();
  const staged = await stagePluginPackage(
    { kind: "zip", path: archivePath },
    {
      stagingRoot: path.join(directory, "staging"),
      trustPolicy: { mode: "developer", trustedPublisherKeys: {} },
    },
  );
  assert.equal(staged.sourceKind, "zip");
  assert.equal(staged.manifest.id, manifest.id);
  assert.deepEqual(
    staged.files.map((file) => file.path),
    ["dist/index.js", "plugin.json"],
  );
  await discardStagedPlugin(staged);
  await assert.rejects(
    buildIndicatorPackage({
      source,
      outputRoot: path.join(directory, "wrong-id"),
      id: "wrong",
      version: "0.1.0",
    }),
    /belong to the package id/,
  );
});

test("archive generation does not depend on locale-sensitive string comparison", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "erc-archive-order-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "b.txt"), "b", "utf8");
  await writeFile(path.join(directory, "A.txt"), "A", "utf8");
  const originalLocaleCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = function localeCompareDisabled() {
    throw new Error("localeCompare must not be used for package ordering");
  };
  try {
    const { writePluginPackageArchive } =
      await import("./plugin-package-archive.mjs");
    await writePluginPackageArchive(directory);
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
});
