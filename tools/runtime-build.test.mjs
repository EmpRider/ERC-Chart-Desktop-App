import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRuntime } from "./build-runtime.mjs";

test("builds sandbox preload, browser renderer, and static assets", async (t) => {
  const root = path.resolve(import.meta.dirname, "..");
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "erc-runtime-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));

  await buildRuntime({ root, outputRoot });

  const preload = await readFile(path.join(outputRoot, "preload.cjs"), "utf8");
  const renderer = await readFile(path.join(outputRoot, "renderer.js"), "utf8");
  const html = await readFile(path.join(outputRoot, "index.html"), "utf8");
  const styles = await readFile(path.join(outputRoot, "styles.css"), "utf8");

  assert.match(preload, /contextBridge/);
  assert.match(preload, /erc-chart:runtime-info/);
  assert.match(renderer, /Secure bridge connected/);
  assert.doesNotMatch(renderer, /node:process|require\(["']electron["']\)/);
  assert.match(html, /<main id="app"><\/main>/);
  assert.match(html, /<script type="module" src="\.\/renderer\.js"><\/script>/);
  assert.match(styles, /color-scheme: dark/);
});

test("rejects an output directory that contains the repository root", async (t) => {
  const outputRoot = await mkdtemp(
    path.join(os.tmpdir(), "erc-unsafe-output-"),
  );
  const root = path.join(outputRoot, "repository");
  await mkdir(root);
  t.after(() => rm(outputRoot, { recursive: true, force: true }));

  await assert.rejects(
    buildRuntime({ root, outputRoot }),
    new Error("Runtime output directory is unsafe."),
  );
});
