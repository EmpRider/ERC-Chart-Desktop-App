import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

function runNode(arguments_) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("NODE_TEST")),
  );
  return spawnSync(process.execPath, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env,
  });
}

function cleanBuildOutput() {
  for (const relativePath of [
    "packages/contracts/dist",
    "packages/indicator-sdk/dist",
  ]) {
    rmSync(path.join(repositoryRoot, relativePath), {
      recursive: true,
      force: true,
    });
  }
}

test("ECDD-220 focused runtime identity fixture", () => {
  let build;
  let focused;
  try {
    build = runNode([
      path.join(repositoryRoot, "node_modules/@typescript/native/bin/tsc"),
      "-b",
      "packages/indicator-sdk",
      "--pretty",
      "false",
      "--force",
    ]);
    if (build.status === 0) {
      focused = runNode([
        "--test",
        path.join(
          repositoryRoot,
          "tools/indicator-runtime-identity-package.test.mjs",
        ),
        path.join(
          repositoryRoot,
          "tools/indicator-output-identity-package.test.mjs",
        ),
        path.join(
          repositoryRoot,
          "tools/indicator-authoring-callsite-transform.test.mjs",
        ),
        path.join(
          repositoryRoot,
          "packages/indicator-sdk/test/authoring.test.mjs",
        ),
      ]);
    }
  } finally {
    cleanBuildOutput();
  }

  assert.equal(
    build?.status,
    0,
    `${build?.stdout ?? ""}${build?.stderr ?? ""}`,
  );
  assert.equal(
    focused?.status,
    0,
    `${focused?.stdout ?? ""}${focused?.stderr ?? ""}`,
  );
});
