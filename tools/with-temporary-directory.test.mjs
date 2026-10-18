import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { withTemporaryDirectory } from "./with-temporary-directory.mjs";

async function assertRemoved(directory) {
  await assert.rejects(access(directory), { code: "ENOENT" });
}

test("removes the temporary directory when setup fails before package build completes", async () => {
  let directory;
  await assert.rejects(
    withTemporaryDirectory(
      path.join(os.tmpdir(), "erc-temp-directory-build-failure-"),
      async (createdDirectory) => {
        directory = createdDirectory;
        await writeFile(
          path.join(createdDirectory, "partial-build"),
          "partial",
        );
        throw new Error("simulated package build failure");
      },
    ),
    /simulated package build failure/u,
  );
  await assertRemoved(directory);
});

test("removes the temporary directory when dynamic import setup fails", async () => {
  let directory;
  await assert.rejects(
    withTemporaryDirectory(
      path.join(os.tmpdir(), "erc-temp-directory-import-failure-"),
      async (createdDirectory) => {
        directory = createdDirectory;
        await import(
          pathToFileURL(path.join(createdDirectory, "missing-module.mjs")).href
        );
      },
    ),
    { code: "ERR_MODULE_NOT_FOUND" },
  );
  await assertRemoved(directory);
});
