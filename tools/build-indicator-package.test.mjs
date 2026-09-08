import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isInstalledIndicatorDefinition } from "../packages/contracts/dist/index.js";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

test("packages a scalar-authored indicator with generated metadata and a self-contained runtime", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "erc-authored-package-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.resolve(
    import.meta.dirname,
    "../packages/indicator-examples/src/atr-bands.ts",
  );
  const { manifest, packageRoot } = await buildIndicatorPackage({
    source,
    outputRoot: path.join(directory, "package"),
    id: "erc.indicator.atr-bands",
    version: "0.1.0",
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
