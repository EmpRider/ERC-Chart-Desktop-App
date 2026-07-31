import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  REQUIRED_APPLICATION_SCRIPTS,
  REQUIRED_WINDOWS_SCRIPTS,
  validateApplicationContract,
} from "../src/application-contract.mjs";

const ABSENT = Symbol("absent");

async function rootWith(manifest = ABSENT) {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-app-contract-"));
  if (manifest !== ABSENT)
    await writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
  return root;
}

test("absent root manifest is explicitly not applicable", async () => {
  assert.deepEqual(await validateApplicationContract(await rootWith()), {
    applicationPresent: false,
    errors: [],
    message: "Application gates: not applicable; root package.json is absent.",
  });
});

test("complete command contract passes", async () => {
  const scripts = Object.fromEntries(
    [...REQUIRED_APPLICATION_SCRIPTS, ...REQUIRED_WINDOWS_SCRIPTS].map(
      (name) => [name, "echo ok"],
    ),
  );
  const result = await validateApplicationContract(await rootWith({ scripts }));
  assert.equal(result.applicationPresent, true);
  assert.deepEqual(result.errors, []);
});

for (const manifest of [null, [], 1, "text"]) {
  test(`non-object root manifest ${JSON.stringify(manifest)} is a governance error`, async () => {
    assert.deepEqual(
      await validateApplicationContract(await rootWith(manifest)),
      {
        applicationPresent: true,
        errors: ["package.json must contain a JSON object."],
        message: "Application gates: invalid root package.json.",
      },
    );
  });
}

for (const missing of [
  ...REQUIRED_APPLICATION_SCRIPTS,
  ...REQUIRED_WINDOWS_SCRIPTS,
]) {
  test(`missing ${missing} fails`, async () => {
    const scripts = Object.fromEntries(
      [...REQUIRED_APPLICATION_SCRIPTS, ...REQUIRED_WINDOWS_SCRIPTS]
        .filter((name) => name !== missing)
        .map((name) => [name, "echo ok"]),
    );
    const result = await validateApplicationContract(
      await rootWith({ scripts }),
    );
    assert.deepEqual(result.errors, [
      `Root package.json must define script '${missing}'.`,
    ]);
  });
}
