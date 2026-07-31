import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  REQUIRED_APPLICATION_SCRIPTS,
  REQUIRED_WINDOWS_SCRIPTS,
} from "../src/application-contract.mjs";

const root = new URL("../../../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("review runbook distinguishes machine gates from manual AI evidence", async () => {
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
    "GitHub rulesets do not enforce Qodo or Code Review AI",
    "manual, non-blocking review evidence",
    "machine-enforced merge contract",
    "return to step 4",
    "request fresh manual reviews",
    "record the approved unavailability explicitly",
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

test("calibration procedure requires two levels and honest provider evidence", async () => {
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
    "manual review evidence",
    "not machine-enforced merge conditions",
  ]) assert.ok(procedure.includes(phrase), phrase);
});

test("solo-maintainer amendment preserves the enforceable boundary", async () => {
  const design = await read(
    "docs/superpowers/specs/2026-07-31-solo-maintainer-review-governance-design.md",
  );
  for (const phrase of [
    "GitHub-enforced merge conditions",
    "manual, non-blocking evidence",
    "does not claim that Qodo or Code Review AI blocks a GitHub merge",
    "original version and release policy remains unchanged",
  ]) assert.ok(design.includes(phrase), phrase);
});

test("delivery workflow executes every governance verification command", async () => {
  const workflow = await read(".github/workflows/delivery-gates.yml");
  for (const command of [
    "npm ci --prefix tools/delivery-governance --ignore-scripts",
    "npm --prefix tools/delivery-governance test",
    "npm --prefix tools/delivery-governance run validate:pr",
    "npm --prefix tools/delivery-governance run validate:repository",
    "npm --prefix tools/delivery-governance run lint:markdown",
    "node tools/delivery-governance/src/github-admin.mjs",
  ]) assert.ok(workflow.includes(command), command);
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
