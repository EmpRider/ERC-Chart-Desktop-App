import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("governance package pins its runtime and commands", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const markdownLintRunner = await readFile(
    new URL("../src/markdown-lint.mjs", import.meta.url),
    "utf8",
  );

  assert.equal(packageJson.private, true);
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.engines.node, "26.8.1");
  assert.equal(packageJson.scripts["lint:markdown"], "node src/markdown-lint.mjs");
  assert.equal(packageJson.devDependencies.markdownlint, "0.41.1");
  assert.equal(packageJson.devDependencies["jsonc-parser"], "3.3.1");
  assert.match(
    markdownLintRunner,
    /excludedDirectories = new Set\(\["\.git", "node_modules"\]\)/,
  );
  assert.deepEqual(Object.keys(packageJson.scripts).sort(), [
    "lint:markdown",
    "test",
    "validate:pr",
    "validate:repository",
  ]);
});

test("root quality commands include the governance workspace", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  );

  assert.match(
    packageJson.scripts["format:check"],
    /tools\/delivery-governance/,
  );
  assert.match(packageJson.scripts.lint, /tools\/delivery-governance/);
});
