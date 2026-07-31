import assert from "node:assert/strict";
import test from "node:test";
import { validateBranchPolicy } from "../src/policy.mjs";

const SHA1 = "1".repeat(40);
const SHA2 = "2".repeat(40);

function task(overrides = {}) {
  return {
    number: 22,
    title: "ECDD-54: create TypeScript monorepo boundaries",
    head: "task/ECDD-54-typescript-monorepo",
    base: "epic/ECDD-53-repository-build-secure-shell",
    baseSha: SHA1,
    headSha: SHA2,
    baseIsAncestor: true,
    body: "- Issue: [ECDD-54](https://erc-chart.atlassian.net/browse/ECDD-54)\n- Parent epic: [ECDD-53](https://erc-chart.atlassian.net/browse/ECDD-53)",
    changedFiles: ["src/index.ts"],
    ...overrides,
  };
}

test("accepts task-to-declared-epic", () =>
  assert.deepEqual(validateBranchPolicy(task()), []));
test("rejects task targeting main", () =>
  assert.ok(
    validateBranchPolicy(task({ base: "main" })).includes(
      "Task branches must target their declared epic branch.",
    ),
  ));
test("accepts epic-to-main", () =>
  assert.deepEqual(
    validateBranchPolicy({
      ...task(),
      title: "ECDD-53: merge repository build and secure shell",
      head: "epic/ECDD-53-repository-build-secure-shell",
      base: "main",
      body: "- Epic: [ECDD-53](https://erc-chart.atlassian.net/browse/ECDD-53)",
    }),
    [],
  ));
test("accepts bootstrap PR 1 exact scope", () =>
  assert.deepEqual(
    validateBranchPolicy({
      ...task(),
      number: 1,
      title: "Plan GitHub delivery governance bootstrap",
      head: "bootstrap/delivery-governance",
      base: "main",
      changedFiles: [
        ".markdownlint-cli2.jsonc",
        ".github/workflows/delivery-gates.yml",
        "tools/delivery-governance/src/policy.mjs",
      ],
    }),
    [],
  ));
test("rejects broad bootstrap scope", () =>
  assert.ok(
    validateBranchPolicy({
      ...task(),
      number: 1,
      head: "bootstrap/delivery-governance",
      base: "main",
      changedFiles: ["src/app.ts"],
    })[0].includes("disallowed path"),
  ));
test("bootstrap fails closed when changed files are missing", () =>
  assert.ok(
    validateBranchPolicy({
      ...task(),
      number: 1,
      head: "bootstrap/delivery-governance",
      base: "main",
      changedFiles: null,
    }).includes("Bootstrap validation requires non-empty PR_CHANGED_FILES."),
  ));
test("bootstrap fails closed when changed files are empty", () =>
  assert.ok(
    validateBranchPolicy({
      ...task(),
      number: 1,
      head: "bootstrap/delivery-governance",
      base: "main",
      changedFiles: [],
    }).includes("Bootstrap validation requires non-empty PR_CHANGED_FILES."),
  ));
test("rejects invalid ancestry", () =>
  assert.ok(
    validateBranchPolicy(task({ baseIsAncestor: false })).includes(
      "The pull-request branch must be based on the current target branch.",
    ),
  ));
