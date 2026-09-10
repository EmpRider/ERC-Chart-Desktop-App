import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const targets = [
  "tools/indicator-runtime-identity-performance.mjs",
  "tools/delivery-governance/test/ecdd-220-runtime-validation.test.mjs",
];

test("ECDD-220 print canonical Prettier output", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(repositoryRoot, "node_modules/prettier/bin/prettier.cjs"),
      "--write",
      ...targets,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  console.log(result.stdout);
  console.error(result.stderr);
  for (const target of targets) {
    console.log(`--- ${target} ---`);
    console.log(readFileSync(path.join(repositoryRoot, target), "utf8"));
  }
  assert.equal(result.status, 0);
  assert.fail("ECDD-220 formatting diagnostic");
});
