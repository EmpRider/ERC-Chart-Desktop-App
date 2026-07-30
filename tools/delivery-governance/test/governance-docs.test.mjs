import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  REQUIRED_APPLICATION_SCRIPTS,
  REQUIRED_WINDOWS_SCRIPTS,
} from "../src/application-contract.mjs";

const root = new URL("../../../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("review runbook contains the approved order and capacity controls", async () => {
  const runbook = await read("docs/governance/REVIEW-RUNBOOK.md");
  const required = [
    "Deterministic checks run before any AI review",
    "CodeRabbit runs before Qodo",
    "/agentic_review",
    "stable head",
    "Code Review AI is reserved for epic-to-main",
    "eight first-pass epic reviews plus two re-reviews",
    "Any code commit invalidates prior review evidence",
    "approval from `@EmpRider` is requested last",
    "fail-closed",
    "no administrator bypass",
    "A bot comment is evidence, not a GitHub approval",
  ];
  for (const phrase of required) assert.ok(runbook.includes(phrase), phrase);
});

test("application contract declares every stable script and handoff", async () => {
  const contract = await read("docs/governance/APPLICATION-GATE-CONTRACT.md");
  for (const script of [...REQUIRED_APPLICATION_SCRIPTS, ...REQUIRED_WINDOWS_SCRIPTS]) {
    assert.ok(contract.includes(`\`${script}\``), script);
  }
  for (const phrase of [
    "ECDD-54",
    "ECDD-56",
    "ECDD-62",
    "checksum generation",
    "tag creation",
    "GitHub Release publication",
    "single root `package-lock.json`",
  ]) assert.ok(contract.includes(phrase), phrase);
});

test("calibration procedure requires two levels and observed evidence", async () => {
  const procedure = await read("docs/governance/CALIBRATION-PROCEDURE.md");
  for (const phrase of [
    "separate coding GitHub identity",
    "Level 1: Task-to-Epic",
    "Level 2: Epic-to-Main",
    "obvious injection sink",
    "/agentic_review",
    "Code Review AI once",
    "direct push",
    "non-fast-forward push",
    "previous seven days",
  ]) assert.ok(procedure.includes(phrase), phrase);
});

test("calibration evidence schema requires all approved assertions", async () => {
  const schema = JSON.parse(await read("docs/governance/calibration-evidence.schema.json"));
  assert.deepEqual(schema.properties.independentApprover, { const: "EmpRider" });
  assert.deepEqual(schema.properties.assertions.properties.separateAuthor, { const: true });
  assert.ok(schema.properties.assertions.required.includes("documentationMergeCreatedNoRelease"));
  assert.ok(schema.properties.reviewers.required.includes("codeReviewAi"));
});

test("calibration evidence includes a representative checked example", async () => {
  const example = JSON.parse(await read("docs/governance/calibration-evidence.example.json"));
  assert.equal(example.independentApprover, "EmpRider");
  assert.equal(example.assertions.documentationMergeCreatedNoRelease, true);
  assert.ok(example.reviewers.semgrep.observedContexts.length > 0);
});
