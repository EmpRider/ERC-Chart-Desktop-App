import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  resolveDesktopArtifacts,
  validateDesktopArtifacts,
} from "../dist/index.js";

test("resolves runtime artifacts independently of the working directory", () => {
  const root = path.resolve("/project");
  const moduleUrl = pathToFileURL(
    path.join(root, "apps", "desktop", "dist", "index.js"),
  ).href;

  assert.deepEqual(resolveDesktopArtifacts(moduleUrl), {
    preloadPath: path.join(
      root,
      "apps",
      "desktop",
      "dist",
      "runtime",
      "preload.cjs",
    ),
    rendererRootPath: path.join(root, "apps", "desktop", "dist", "runtime"),
    rendererEntryUrl: "erc-app://app/index.html",
    dataUtilityPath: path.join(
      root,
      "packages",
      "data-service",
      "dist",
      "utility-entry.js",
    ),
    providerUtilityPath: path.join(
      root,
      "packages",
      "provider-runtime",
      "dist",
      "utility-entry.js",
    ),
  });
});

test("validates every required artifact without exposing its path", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = {
    preloadPath: path.join(root, "preload.cjs"),
    rendererRootPath: root,
    rendererEntryUrl: "erc-app://app/index.html",
    dataUtilityPath: path.join(root, "data.js"),
    providerUtilityPath: path.join(root, "provider", "entry.js"),
  };
  await mkdir(path.dirname(paths.providerUtilityPath), { recursive: true });
  await Promise.all(
    [
      paths.preloadPath,
      path.join(paths.rendererRootPath, "index.html"),
      paths.dataUtilityPath,
      paths.providerUtilityPath,
    ].map((filePath) => writeFile(filePath, "")),
  );

  await validateDesktopArtifacts(paths);
  await assert.rejects(
    validateDesktopArtifacts({ ...paths, dataUtilityPath: `${root}/missing` }),
    new Error("Required desktop artifact is unavailable."),
  );
});
