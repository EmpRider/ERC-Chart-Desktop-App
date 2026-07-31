import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  REQUIRED_APPLICATION_SCRIPTS,
  REQUIRED_WINDOWS_SCRIPTS,
} from "../src/application-contract.mjs";

const root = new URL("../../../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("review runbook contains the solo-maintainer order and capacity controls", async () => {
  const runbook = await read("docs/governance/REVIEW-RUNBOOK.md");
  const required = [
    "Deterministic checks run before any AI review",
    "CodeRabbit runs before Qodo",
    "/agentic_review",
    "stable head",
    "Code Review AI is reserved for epic-to-main",
    "eight first-pass epic reviews plus two re-reviews",
    "Any code commit invalidates prior review evidence",
    "Solo-maintainer mode permits `EmpRider` to author and merge",
    "`Delivery gates`, `semgrep-cloud-platform/scan`, and `CodeRabbit`",
    "all review conversations are resolved",
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

test("calibration procedure requires two levels and solo-maintainer evidence", async () => {
  const procedure = await read("docs/governance/CALIBRATION-PROCEDURE.md");
  for (const phrase of [
    "same `EmpRider` identity",
    "Level 1: Task-to-Epic",
    "Level 2: Epic-to-Main",
    "obvious injection sink",
    "/agentic_review",
    "Code Review AI once",
    "missing required status",
    "out-of-date branch",
    "unresolved conversation",
    "direct push",
    "non-fast-forward push",
    "previous seven days",
    "Day 1 of 14 · Trial",
  ]) assert.ok(procedure.includes(phrase), phrase);
});

test("calibration evidence schema requires solo-maintainer enforcement assertions", async () => {
  const schema = JSON.parse(await read("docs/governance/calibration-evidence.schema.json"));
  assert.deepEqual(schema.properties.maintainer, { const: "EmpRider" });
  assert.equal(schema.properties.codingAuthor, undefined);
  assert.equal(schema.properties.independentApprover, undefined);
  assert.ok(schema.properties.assertions.required.includes("requiredStatusesBlock"));
  assert.ok(schema.properties.assertions.required.includes("staleBranchBlocks"));
  assert.ok(schema.properties.assertions.required.includes("unresolvedConversationBlocks"));
  assert.ok(schema.properties.assertions.required.includes("mergeMethodsEnforced"));
  assert.equal(schema.properties.assertions.properties.soloMaintainer.const, true);
  assert.ok(schema.properties.reviewers.required.includes("codeReviewAi"));
});

test("calibration evidence includes representative solo-maintainer observations", async () => {
  const example = JSON.parse(await read("docs/governance/calibration-evidence.example.json"));
  assert.equal(example.maintainer, "EmpRider");
  assert.equal(example.qodoCapacity.displayText, "Day 1 of 14 · Trial");
  assert.equal(example.qodoCapacity.active, true);
  assert.equal(example.qodoCapacity.exactEndsOn, null);
  assert.deepEqual(example.reviewers.coderabbit.observedContexts, ["CodeRabbit"]);
  assert.deepEqual(example.reviewers.semgrep.observedContexts, ["semgrep-cloud-platform/scan"]);
  assert.equal(example.assertions.requiredStatusesBlock, true);
  assert.equal(example.assertions.documentationMergeCreatedNoRelease, true);
});
