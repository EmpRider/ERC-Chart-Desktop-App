import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  resolveDesktopArtifacts,
  validateDesktopArtifacts,
} from "../dist/index.js";

test("resolves runtime artifacts independently of the working directory", () => {
  const moduleUrl = pathToFileURL(
    path.join("/project", "apps", "desktop", "dist", "index.js"),
  ).href;

  assert.deepEqual(resolveDesktopArtifacts(moduleUrl), {
    preloadPath: path.join(
      "/project",
      "apps",
      "desktop",
      "dist",
      "runtime",
      "preload.cjs",
    ),
    rendererHtmlPath: path.join(
      "/project",
      "apps",
      "desktop",
      "dist",
      "runtime",
      "index.html",
    ),
    dataUtilityPath: path.join(
      "/project",
      "packages",
      "data-service",
      "dist",
      "utility-entry.js",
    ),
    providerUtilityPath: path.join(
      "/project",
      "packages",
      "provider-runtime",
      "dist",
      "utility-entry.js",
    ),
  });
});

test("validates every required artifact without exposing its path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-artifacts-"));
  const paths = {
    preloadPath: path.join(root, "preload.cjs"),
    rendererHtmlPath: path.join(root, "index.html"),
    dataUtilityPath: path.join(root, "data.js"),
    providerUtilityPath: path.join(root, "provider", "entry.js"),
  };
  await mkdir(path.dirname(paths.providerUtilityPath), { recursive: true });
  await Promise.all(
    Object.values(paths).map((filePath) => writeFile(filePath, "")),
  );

  await validateDesktopArtifacts(paths);
  await writeFile(paths.preloadPath, "present");
  await assert.rejects(
    validateDesktopArtifacts({ ...paths, dataUtilityPath: `${root}/missing` }),
    new Error("Required desktop artifact is unavailable."),
  );
});
