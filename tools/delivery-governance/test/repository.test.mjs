import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateRepository, validateTrackedContent } from "../src/repository.mjs";

async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-governance-"));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return root;
}

test("valid structured files and relative links pass", async () => {
  const root = await fixture({
    "README.md": "[Guide](docs/guide.md)\n",
    "docs/guide.md": "# Guide\n",
    ".github/workflows/check.yml": "name: Check\non: push\njobs: {}\n",
    ".pr_agent.toml": "[config]\ndisable_auto_feedback = true\n",
    "config.json": '{"ok":true}\n',
  });
  assert.deepEqual(await validateRepository(root), []);
});

test("broken relative Markdown link fails", async () => {
  const root = await fixture({ "README.md": "[Missing](docs/missing.md)\n" });
  assert.ok((await validateRepository(root))[0].includes("broken relative link"));
});

test("current GitHub token families are detected without echoing values", async () => {
  const tokens = [
    `ghp_${"a".repeat(36)}`,
    `gho_${"b".repeat(36)}`,
    `ghu_${"c".repeat(36)}`,
    `ghr_${"d".repeat(36)}`,
    `github_pat_${"A1_".repeat(12)}`,
    `ghs_${"e".repeat(40)}`,
    `ghs_${"Ab._-".repeat(10)}`,
  ];
  const root = await fixture({ "fixture.txt": tokens.join("\n") });
  const errors = await validateTrackedContent(root);
  assert.equal(errors.length, tokens.length);
  for (const token of tokens) assert.equal(errors.some((error) => error.includes(token)), false);
});

test("forbidden binaries fail and excluded directories are skipped", async () => {
  const root = await fixture({
    "release/app.exe": "binary",
    "node_modules/ignored.dll": "binary",
    "src/native.dll": "binary",
  });
  const errors = await validateTrackedContent(root);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].startsWith("src/native.dll:"));
});

test("quoted passwords and private keys fail", async () => {
  const root = await fixture({
    "config.txt": 'password = "supersecretvalue"\n-----BEGIN PRIVATE KEY-----\n',
  });
  const errors = await validateTrackedContent(root);
  assert.equal(errors.length, 2);
});
