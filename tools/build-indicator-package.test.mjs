import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isInstalledIndicatorDefinition } from "../packages/contracts/dist/index.js";
import {
  discardStagedPlugin,
  stagePluginPackage,
} from "../packages/provider-runtime/dist/index.js";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

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

test("packages Pine-style history syntax through the authoring transform", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "erc-history-package-"),
  );
  const sourceDirectory = await mkdtemp(
    path.join(repoRoot, ".history-syntax-source-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.after(() => rm(sourceDirectory, { recursive: true, force: true }));

  const source = path.join(sourceDirectory, "history.ts");
  await writeFile(
    source,
    `import { defineIndicator, history, plot } from "@erc-chart/indicator-sdk";

export default defineIndicator(
  { id: "erc.indicator.history-syntax.main", name: "History syntax" },
  ({ close }) => {
    plot.line(close[1], { key: "indexed" });
    plot.line(close.at(1), { key: "at" });
    plot.line(history(close, 1), { key: "explicit" });
  },
);
`,
    "utf8",
  );

  const { manifest, packageRoot } = await buildIndicatorPackage({
    source,
    outputRoot: path.join(directory, "package"),
    id: "erc.indicator.history-syntax",
    version: "0.1.0",
  });
  const entry = await readFile(path.join(packageRoot, manifest.entry));
  const { default: plugin } = await import(
    `data:text/javascript;base64,${entry.toString("base64")}`
  );
  const instance = plugin.createInstance(
    {},
    { instrumentId: "TEST", timeframeId: "1m" },
  );
  instance.onHistory(
    [10, 11, 12].map((close, index) => ({
      instrumentId: "TEST",
      timeframeId: "1m",
      openTimeMs: index * 60_000,
      open: close - 1,
      high: close + 1,
      low: close - 2,
      close,
      volume: 1,
    })),
  );
  const points = instance.snapshot().points;
  assert.deepEqual(
    points.map((point) => point.values.indexed),
    [null, 10, 11],
  );
  assert.deepEqual(
    points.map((point) => point.values.at),
    [null, 10, 11],
  );
  assert.deepEqual(
    points.map((point) => point.values.explicit),
    [null, 10, 11],
  );
  instance.dispose();
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
