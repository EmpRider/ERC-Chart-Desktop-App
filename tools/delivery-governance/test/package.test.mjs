import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const markdownLintRunner = fileURLToPath(
  new URL("../src/markdown-lint.mjs", import.meta.url),
);

async function runMarkdownLintFixture(config, markdown) {
  const repositoryRoot = await mkdtemp(
    path.join(tmpdir(), "erc-markdown-lint-test-"),
  );
  const governanceDirectory = path.join(
    repositoryRoot,
    "tools",
    "delivery-governance",
  );

  try {
    await mkdir(governanceDirectory, { recursive: true });
    await writeFile(
      path.join(repositoryRoot, ".markdownlint-cli2.jsonc"),
      config,
      "utf8",
    );
    await writeFile(path.join(repositoryRoot, "README.md"), markdown, "utf8");

    return spawnSync(process.execPath, [markdownLintRunner], {
      cwd: governanceDirectory,
      encoding: "utf8",
    });
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

test("governance package pins its runtime and commands", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(packageJson.private, true);
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.engines.node, "26.8.1");
  assert.equal(
    packageJson.scripts["lint:markdown"],
    "node src/markdown-lint.mjs",
  );
  assert.equal(packageJson.devDependencies.markdownlint, "0.41.1");
  assert.equal(packageJson.devDependencies["jsonc-parser"], "3.3.1");
  assert.deepEqual(Object.keys(packageJson.scripts).sort(), [
    "lint:markdown",
    "test",
    "validate:pr",
    "validate:repository",
  ]);
});

test("markdown lint runner accepts a valid isolated repository", async () => {
  const result = await runMarkdownLintFixture(
    '{"config":{"default":true,"MD013":false,"MD040":true}}',
    "# Valid fixture\n",
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Markdown lint passed \(1 files\)\./);
});

test("markdown lint runner rejects malformed JSONC", async () => {
  const result = await runMarkdownLintFixture(
    '{"config":{"MD040":true}',
    "# Fixture\n",
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unable to parse/);
});

test("markdown lint runner rejects fenced code without a language", async () => {
  const result = await runMarkdownLintFixture(
    '{"config":{"default":true,"MD013":false,"MD040":true}}',
    "# Invalid fence\n\n```\ntext\n```\n",
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /MD040/);
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
