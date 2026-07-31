import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateSchemaExamples } from "../src/repository.mjs";

const repositoryRoot = new URL("../../../", import.meta.url);

async function calibrationFixture(mutator) {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-qodo-capacity-"));
  const schema = await readFile(
    new URL("docs/governance/calibration-evidence.schema.json", repositoryRoot),
    "utf8",
  );
  const example = JSON.parse(
    await readFile(
      new URL("docs/governance/calibration-evidence.example.json", repositoryRoot),
      "utf8",
    ),
  );
  mutator(example.qodoCapacity);

  const directory = path.join(root, "docs/governance");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "calibration-evidence.schema.json"), schema);
  await writeFile(
    path.join(directory, "calibration-evidence.example.json"),
    JSON.stringify(example),
  );
  return root;
}

test("Qodo capacity accepts a later trial day when day and display text agree", async () => {
  const root = await calibrationFixture((capacity) => {
    capacity.active = true;
    capacity.trialDay = 2;
    capacity.displayText = "Day 2 of 14 · Trial";
  });
  assert.deepEqual(await validateSchemaExamples(root), []);
});

test("Qodo capacity accepts an inactive provider observation", async () => {
  const root = await calibrationFixture((capacity) => {
    capacity.active = false;
    capacity.displayText = "Unavailable — review quota exhausted";
    capacity.exactEndsOn = null;
    delete capacity.trialDay;
  });
  assert.deepEqual(await validateSchemaExamples(root), []);
});

test("Qodo capacity rejects mismatched trial day evidence", async () => {
  const root = await calibrationFixture((capacity) => {
    capacity.active = true;
    capacity.trialDay = 1;
    capacity.displayText = "Day 2 of 14 · Trial";
  });
  const errors = await validateSchemaExamples(root);
  assert.ok(errors.some((error) => error.includes("calibration-evidence.example.json")));
});
