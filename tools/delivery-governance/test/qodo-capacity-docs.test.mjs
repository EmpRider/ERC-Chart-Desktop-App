import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../../../", import.meta.url);
const read = (path) => readFile(new URL(path, repositoryRoot), "utf8");

const requiredCapacityGuidance = [
  "`trialDay`",
  "`Day N of 14 · Trial`",
  "`active: false`",
  "omit `trialDay`",
  "non-empty explanatory `displayText`",
];

test("calibration procedure explains active and unavailable Qodo capacity evidence", async () => {
  const procedure = await read("docs/governance/CALIBRATION-PROCEDURE.md");
  for (const phrase of requiredCapacityGuidance) {
    assert.ok(procedure.includes(phrase), phrase);
  }
});

test("review runbook explains active and unavailable Qodo capacity evidence", async () => {
  const runbook = await read("docs/governance/REVIEW-RUNBOOK.md");
  for (const phrase of requiredCapacityGuidance) {
    assert.ok(runbook.includes(phrase), phrase);
  }
});
