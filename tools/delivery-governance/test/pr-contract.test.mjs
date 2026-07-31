import assert from "node:assert/strict";
import test from "node:test";
import { validatePullRequestBody } from "../src/pr-contract.mjs";

function body(jira) {
  return `## Jira\n\n${jira}\n\n## Acceptance criteria\n\n- [x] Required behavior is complete.\n\n## Out of scope\n\nNo unrelated work.\n\n## Design\n\nMinimal implementation.\n\n## Verification\n\n\`\`\`text\nnpm test\nPASS\n\`\`\`\n\n## Performance\n\nNot performance-sensitive.\n\n## Dependencies\n\nNo runtime dependency added.\n\n## Risk and rollback\n\nRevert the commit.\n\n## Screenshots\n\nNot applicable.\n\n## Security declaration\n\n- [x] No secrets, credentials, installers, generated binaries, or local state are included.\n`;
}

test("accepts task contract", () => {
  const errors = validatePullRequestBody(
    body(
      "- Issue: [ECDD-54](https://erc-chart.atlassian.net/browse/ECDD-54)\n- Parent epic: [ECDD-53](https://erc-chart.atlassian.net/browse/ECDD-53)",
    ),
    {
      number: 22,
      head: "task/ECDD-54-typescript-monorepo",
      base: "epic/ECDD-53-shell",
    },
  );
  assert.deepEqual(errors, []);
});

test("accepts epic contract", () => {
  const errors = validatePullRequestBody(
    body("- Epic: [ECDD-53](https://erc-chart.atlassian.net/browse/ECDD-53)"),
    { number: 23, head: "epic/ECDD-53-shell", base: "main" },
  );
  assert.deepEqual(errors, []);
});

test("accepts one-time bootstrap Jira exception", () => {
  const errors = validatePullRequestBody(
    body("Not applicable — one-time bootstrap PR #1"),
    { number: 1, head: "bootstrap/delivery-governance", base: "main" },
  );
  assert.deepEqual(errors, []);
});

test("rejects unchecked acceptance criteria", () => {
  const invalid = body("Not applicable — one-time bootstrap PR #1").replace(
    "- [x] Required",
    "- [ ] Required",
  );
  assert.ok(
    validatePullRequestBody(invalid, {
      number: 1,
      head: "bootstrap/delivery-governance",
      base: "main",
    }).length > 0,
  );
});

test("rejects pull-request template instructions", () => {
  const invalid = `${body("Not applicable — one-time bootstrap PR #1")}\n<!-- Replace with linked Jira acceptance criteria and check each completed item. -->`;
  assert.ok(
    validatePullRequestBody(invalid, {
      number: 1,
      head: "bootstrap/delivery-governance",
      base: "main",
    }).includes("Pull-request body still contains template instructions."),
  );
});

test("accepts reviewer-generated hidden comments", () => {
  const reviewed = `${body("Not applicable — one-time bootstrap PR #1")}\n<!-- This is an auto-generated comment: release notes by coderabbit.ai -->`;
  assert.deepEqual(
    validatePullRequestBody(reviewed, {
      number: 1,
      head: "bootstrap/delivery-governance",
      base: "main",
    }),
    [],
  );
});
