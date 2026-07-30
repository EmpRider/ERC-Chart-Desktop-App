import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  validateRepository,
  validateSchemaExamples,
  validateTrackedContent,
} from "../src/repository.mjs";

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

test("schema examples accept valid standard format values", async () => {
  const root = await fixture({
    "docs/architecture/v1/contracts/plugin-manifest.schema.json": JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["createdAt"],
      properties: { createdAt: { type: "string", format: "date-time" } },
    }),
    "docs/architecture/v1/examples/binomo-provider.plugin.json": JSON.stringify({
      createdAt: "2026-07-30T18:00:00Z",
    }),
  });
  assert.deepEqual(await validateSchemaExamples(root), []);
});

test("schema examples reject invalid standard format values", async () => {
  const root = await fixture({
    "docs/architecture/v1/contracts/plugin-manifest.schema.json": JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["createdAt"],
      properties: { createdAt: { type: "string", format: "date-time" } },
    }),
    "docs/architecture/v1/examples/binomo-provider.plugin.json": JSON.stringify({
      createdAt: "not-a-date",
    }),
  });
  const errors = await validateSchemaExamples(root);
  assert.ok(errors.some((error) => error.includes("does not satisfy")));
});

test("calibration evidence example is part of schema validation", async () => {
  const root = await fixture({
    "docs/governance/calibration-evidence.schema.json": JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["independentApprover"],
      properties: { independentApprover: { const: "EmpRider" } },
    }),
    "docs/governance/calibration-evidence.example.json": JSON.stringify({
      independentApprover: "wrong-user",
    }),
  });
  const errors = await validateSchemaExamples(root);
  assert.ok(errors.some((error) => error.includes("calibration-evidence.example.json")));
});

test("broken relative Markdown link fails", async () => {
  const root = await fixture({ "README.md": "[Missing](docs/missing.md)\n" });
  assert.ok((await validateRepository(root))[0].includes("broken relative link"));
});

test("Markdown links cannot escape the repository root", async () => {
  const root = await fixture({});
  const outside = `${root}-outside.md`;
  await writeFile(outside, "# Outside\n");
  await writeFile(path.join(root, "README.md"), `[Outside](../${path.basename(outside)})\n`);
  const errors = await validateRepository(root);
  assert.ok(errors.some((error) => error.includes("escapes repository root")));
});

test("absolute Markdown links are rejected as local filesystem paths", async () => {
  const root = await fixture({ "README.md": "[Host file](/etc/passwd)\n" });
  const errors = await validateRepository(root);
  assert.ok(errors.some((error) => error.includes("absolute local path")));
});

test("malformed Markdown percent encoding is a deterministic validation error", async () => {
  const root = await fixture({ "README.md": "[Bad](docs/bad%ZZ.md)\n" });
  const errors = await validateRepository(root);
  assert.ok(errors.some((error) => error.includes("malformed percent-encoding")));
});

test("symlinks fail closed instead of bypassing repository scans", async () => {
  const root = await fixture({});
  const outside = `${root}-target.txt`;
  await writeFile(outside, "outside\n");
  await symlink(outside, path.join(root, "linked.txt"));
  const errors = await validateRepository(root);
  assert.ok(errors.some((error) => error === "linked.txt: symlinks are forbidden"));
});

test("oversized structured files fail before parsing", async () => {
  const root = await fixture({
    "large.json": JSON.stringify({ payload: "x".repeat(2_000_000) }),
  });
  const errors = await validateRepository(root);
  assert.ok(errors.some((error) => error.includes("large.json: structured file exceeds")));
});

test("root package-lock receives a bounded higher structured-file limit", async () => {
  const root = await fixture({
    "package-lock.json": JSON.stringify({
      name: "large-workspace",
      lockfileVersion: 3,
      packages: {},
      padding: "x".repeat(2_100_000),
    }),
  });
  assert.deepEqual(await validateRepository(root), []);
});

test("oversized Markdown files fail before link scanning", async () => {
  const root = await fixture({ "large.md": `# Large\n${"x".repeat(2_000_000)}` });
  const errors = await validateRepository(root);
  assert.ok(errors.some((error) => error.includes("large.md: Markdown file exceeds")));
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

test("generated output directories and committed binaries fail", async () => {
  const root = await fixture({
    "release/app.exe": "binary",
    "node_modules/ignored.dll": "binary",
    "src/native.dll": "binary",
  });
  const errors = await validateRepository(root);
  assert.ok(errors.some((error) => error === "release: generated output directory is forbidden"));
  assert.ok(errors.some((error) => error.startsWith("src/native.dll:")));
  assert.equal(errors.some((error) => error.includes("node_modules")), false);
});

test("quoted passwords and private keys fail", async () => {
  const passwordName = ["pass", "word"].join("");
  const privateKeyMarker = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
  const root = await fixture({
    "config.txt": `${passwordName} = "supersecretvalue"\n${privateKeyMarker}\n`,
  });
  const errors = await validateTrackedContent(root);
  assert.equal(errors.length, 2);
});
