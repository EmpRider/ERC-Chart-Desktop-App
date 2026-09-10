import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

function runNode(arguments_) {
  return spawnSync(process.execPath, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

test("ECDD-220 focused runtime identity fixture", () => {
  const build = runNode([
    path.join(repositoryRoot, "node_modules/@typescript/native/bin/tsc"),
    "-b",
    "--pretty",
    "false",
    "--force",
  ]);
  assert.equal(build.status, 0, `${build.stdout}${build.stderr}`);

  const focused = runNode([
    "--test",
    path.join(repositoryRoot, "tools/indicator-output-identity-package.test.mjs"),
  ]);
  assert.equal(focused.status, 0, `${focused.stdout}${focused.stderr}`);
});
