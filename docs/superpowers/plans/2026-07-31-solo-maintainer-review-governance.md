# Solo-Maintainer Review Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace impossible self-approval requirements with fail-closed, current-head automated review enforcement for the single-maintainer GitHub MCP workflow.

**Architecture:** GitHub rulesets enforce only stable machine-readable contexts: `Delivery gates`, `semgrep-cloud-platform/scan`, and `CodeRabbit`. Qodo and Code Review AI remain mandatory operational gates in the review runbook because they may publish reviews or comments instead of stable pass/fail checks. Desired-state JSON, schema-checked calibration evidence, tests, and governance documents remain the repository source of truth; live ruleset changes are applied through the GitHub UI and verified before merging.

**Tech Stack:** Node.js `24.18.1`, ECMAScript modules, `node:test`, JSON Schema draft 2020-12, GitHub repository rulesets, GitHub Actions, Semgrep, CodeRabbit, Qodo, Code Review AI.

## Global Constraints

- Repository: `EmpRider/ERC-Chart-Desktop-App`.
- Coding, review coordination, and merge operations use the sole GitHub identity `EmpRider` through `@GitHub` MCP.
- Branches already created: `epic/ECDD-53-repository-build` from `main`, and `task/ECDD-56-solo-maintainer-review` from that epic branch.
- Task pull requests target the declared epic branch and use squash merge.
- Epic pull requests target `main` and use merge commits.
- Both rulesets retain empty bypass actor lists.
- Both rulesets block branch deletion and non-fast-forward updates.
- Both rulesets require all review conversations to be resolved.
- Required stable contexts are exactly `Delivery gates`, `semgrep-cloud-platform/scan`, and `CodeRabbit` unless a current-head calibration run proves that GitHub emits a different exact name.
- Strict required-status-check policy remains enabled, so the head must be current with the target branch.
- Required approving review count is `0`; Code Owner and last-push approval are not required.
- `CODEOWNERS` remains `* @EmpRider` for ownership routing, but it is not a merge approval gate.
- Qodo `/agentic_review` remains required for task-to-epic while the current 14-day trial is active and for epic-to-main under the approved capacity policy.
- Code Review AI remains epic-to-main only, with eight first-pass reviews plus two re-reviews reserved monthly.
- No custom workflow parses AI comment text.
- No administrator bypass is introduced.
- No dependency is added.
- All GitHub writes are performed through `@GitHub` MCP; a temporary local checkout may be used only to run tests and must not push directly.

---

### Task 1: Encode the solo-maintainer ruleset contract with failing tests

**Files:**
- Create: `tools/delivery-governance/test/rulesets.test.mjs`
- Modify: `.github/rulesets/main.json`
- Modify: `.github/rulesets/epic.json`

**Interfaces:**
- Consumes: desired-state JSON documents loaded directly from `.github/rulesets/`.
- Produces: a deterministic test contract for approval count, status contexts, branch freshness, review-thread resolution, bypass actors, deletion/force-push protection, and allowed merge methods.

- [ ] **Step 1: Create the failing ruleset contract test**

Create `tools/delivery-governance/test/rulesets.test.mjs` with this content:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const REQUIRED_CONTEXTS = [
  "CodeRabbit",
  "Delivery gates",
  "semgrep-cloud-platform/scan",
];

async function ruleset(name) {
  return JSON.parse(await readFile(new URL(`.github/rulesets/${name}.json`, root), "utf8"));
}

function rule(document, type) {
  return document.rules.find((entry) => entry.type === type);
}

function contexts(document) {
  return rule(document, "required_status_checks")
    .parameters.required_status_checks
    .map(({ context }) => context)
    .sort();
}

function assertSoloMaintainer(document, mergeMethod) {
  const pullRequest = rule(document, "pull_request").parameters;
  assert.equal(pullRequest.required_approving_review_count, 0);
  assert.equal(pullRequest.require_code_owner_review, false);
  assert.equal(pullRequest.require_last_push_approval, false);
  assert.equal(pullRequest.required_review_thread_resolution, true);
  assert.equal(pullRequest.dismiss_stale_reviews_on_push, true);
  assert.deepEqual(pullRequest.allowed_merge_methods, [mergeMethod]);

  const statusChecks = rule(document, "required_status_checks").parameters;
  assert.equal(statusChecks.strict_required_status_checks_policy, true);
  assert.deepEqual(contexts(document), REQUIRED_CONTEXTS);

  assert.deepEqual(document.bypass_actors, []);
  assert.ok(rule(document, "deletion"));
  assert.ok(rule(document, "non_fast_forward"));
}

test("main ruleset enforces solo-maintainer epic review gates", async () => {
  const document = await ruleset("main");
  assert.equal(document.name, "ERC main");
  assert.equal(document.enforcement, "active");
  assert.deepEqual(document.conditions.ref_name.include, ["refs/heads/main"]);
  assertSoloMaintainer(document, "merge");
});

test("epic ruleset enforces solo-maintainer task review gates", async () => {
  const document = await ruleset("epic");
  assert.equal(document.name, "ERC epic branches");
  assert.equal(document.enforcement, "active");
  assert.deepEqual(document.conditions.ref_name.include, ["refs/heads/epic/*"]);
  assertSoloMaintainer(document, "squash");
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run from `tools/delivery-governance`:

```bash
node --test test/rulesets.test.mjs
```

Expected: both tests fail because the current JSON requires one approval, Code Owner review, and last-push approval, and requires only `Delivery gates`.

- [ ] **Step 3: Update the `ERC main` desired-state rule**

In `.github/rulesets/main.json`, replace the pull-request parameters with:

```json
{
  "allowed_merge_methods": ["merge"],
  "dismiss_stale_reviews_on_push": true,
  "require_code_owner_review": false,
  "require_last_push_approval": false,
  "required_approving_review_count": 0,
  "required_review_thread_resolution": true
}
```

Replace `required_status_checks` with:

```json
[
  { "context": "Delivery gates" },
  { "context": "semgrep-cloud-platform/scan" },
  { "context": "CodeRabbit" }
]
```

Keep `strict_required_status_checks_policy: true`, `do_not_enforce_on_create: false`, `bypass_actors: []`, deletion protection, and non-fast-forward protection unchanged.

- [ ] **Step 4: Update the `ERC epic branches` desired-state rule**

In `.github/rulesets/epic.json`, apply the same solo-maintainer approval parameters and required contexts. Keep:

```json
"allowed_merge_methods": ["squash"]
```

Keep `strict_required_status_checks_policy: true`, `do_not_enforce_on_create: true`, `bypass_actors: []`, deletion protection, and non-fast-forward protection unchanged.

- [ ] **Step 5: Run the focused test and verify green**

```bash
node --test test/rulesets.test.mjs
```

Expected: `2` tests pass, `0` fail.

- [ ] **Step 6: Run structured-file validation**

```bash
npm run validate:repository
```

Expected: exit code `0` and no JSON validation error for either ruleset.

- [ ] **Step 7: Commit the ruleset contract**

```bash
git add .github/rulesets/main.json .github/rulesets/epic.json tools/delivery-governance/test/rulesets.test.mjs
git commit -m "ECDD-56: enforce solo-maintainer review rules"
```

---

### Task 2: Replace independent-author calibration evidence with solo-maintainer evidence

**Files:**
- Modify: `tools/delivery-governance/test/governance-docs.test.mjs`
- Modify: `tools/delivery-governance/test/repository.test.mjs`
- Modify: `docs/governance/calibration-evidence.schema.json`
- Modify: `docs/governance/calibration-evidence.example.json`

**Interfaces:**
- Consumes: JSON Schema validation performed by `validateSchemaExamples()`.
- Produces: schema-checked evidence for the sole maintainer, Qodo trial state, exact reviewer representations, and merge-blocking assertions.

- [ ] **Step 1: Replace the schema assertions with failing solo-maintainer assertions**

In `tools/delivery-governance/test/governance-docs.test.mjs`, replace the calibration schema and example tests with:

```js
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
```

- [ ] **Step 2: Update the repository schema-validation fixture to the new required identity field**

In `tools/delivery-governance/test/repository.test.mjs`, replace the `calibration evidence example is part of schema validation` fixture with:

```js
test("calibration evidence example is part of schema validation", async () => {
  const root = await fixture({
    "docs/governance/calibration-evidence.schema.json": JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["maintainer"],
      properties: { maintainer: { const: "EmpRider" } },
    }),
    "docs/governance/calibration-evidence.example.json": JSON.stringify({
      maintainer: "wrong-user",
    }),
  });
  const errors = await validateSchemaExamples(root);
  assert.ok(errors.some((error) => error.includes("calibration-evidence.example.json")));
});
```

- [ ] **Step 3: Run the focused tests and verify the red state**

```bash
node --test test/governance-docs.test.mjs test/repository.test.mjs
```

Expected: failures reference missing `maintainer`, `qodoCapacity`, and the new assertion names.

- [ ] **Step 4: Replace the calibration evidence top-level contract**

In `docs/governance/calibration-evidence.schema.json`, set the top-level required properties to:

```json
[
  "calibratedAt",
  "maintainer",
  "taskPullRequest",
  "epicPullRequest",
  "qodoCapacity",
  "reviewers",
  "assertions"
]
```

Remove `codingAuthor`, `independentApprover`, and `qodoTrialEndsOn`.

Add:

```json
"maintainer": { "const": "EmpRider" },
"qodoCapacity": {
  "type": "object",
  "additionalProperties": false,
  "required": ["observedAt", "displayText", "active", "exactEndsOn"],
  "properties": {
    "observedAt": { "type": "string", "format": "date-time" },
    "displayText": {
      "type": "string",
      "pattern": "^Day [0-9]+ of 14 · Trial$"
    },
    "active": { "const": true },
    "exactEndsOn": {
      "anyOf": [
        { "type": "string", "format": "date" },
        { "type": "null" }
      ]
    }
  }
}
```

`exactEndsOn` is nullable because the Qodo portal currently exposes `Day 1 of 14 · Trial` but not a trustworthy exact expiry date.

- [ ] **Step 5: Replace the calibration assertion contract**

Set `assertions.required` to:

```json
[
  "soloMaintainer",
  "coderabbitComprehensive",
  "semgrepBlocks",
  "qodoTaskAndEpic",
  "codeReviewAiEpicOnly",
  "requiredStatusesBlock",
  "staleBranchBlocks",
  "unresolvedConversationBlocks",
  "mergeMethodsEnforced",
  "directPushRejected",
  "forcePushRejected",
  "documentationMergeCreatedNoRelease"
]
```

Define every listed assertion as:

```json
{ "const": true }
```

Remove `separateAuthor` and `staleApprovalDismissed`.

- [ ] **Step 6: Replace the representative evidence example**

Use this structure in `docs/governance/calibration-evidence.example.json`:

```json
{
  "calibratedAt": "2026-07-31T04:30:00Z",
  "maintainer": "EmpRider",
  "taskPullRequest": 2,
  "epicPullRequest": 3,
  "qodoCapacity": {
    "observedAt": "2026-07-31T04:30:00Z",
    "displayText": "Day 1 of 14 · Trial",
    "active": true,
    "exactEndsOn": null
  },
  "reviewers": {
    "coderabbit": {
      "login": "coderabbitai[bot]",
      "representation": "check",
      "observedContexts": ["CodeRabbit"]
    },
    "semgrep": {
      "login": "semgrep-cloud-platform",
      "representation": "check",
      "observedContexts": ["semgrep-cloud-platform/scan"]
    },
    "qodo": {
      "login": "qodo-merge-pro[bot]",
      "representation": "review",
      "observedContexts": []
    },
    "codeReviewAi": {
      "login": "code-review-ai",
      "representation": "comment",
      "observedContexts": []
    }
  },
  "assertions": {
    "soloMaintainer": true,
    "coderabbitComprehensive": true,
    "semgrepBlocks": true,
    "qodoTaskAndEpic": true,
    "codeReviewAiEpicOnly": true,
    "requiredStatusesBlock": true,
    "staleBranchBlocks": true,
    "unresolvedConversationBlocks": true,
    "mergeMethodsEnforced": true,
    "directPushRejected": true,
    "forcePushRejected": true,
    "documentationMergeCreatedNoRelease": true
  }
}
```

The file remains an example until real task and epic PR numbers replace the representative values during calibration.

- [ ] **Step 7: Run focused tests and schema validation**

```bash
node --test test/governance-docs.test.mjs test/repository.test.mjs
npm run validate:repository
```

Expected: all focused tests pass and the example satisfies the schema.

- [ ] **Step 8: Commit the evidence contract**

```bash
git add docs/governance/calibration-evidence.schema.json docs/governance/calibration-evidence.example.json tools/delivery-governance/test/governance-docs.test.mjs tools/delivery-governance/test/repository.test.mjs
git commit -m "ECDD-56: model solo-maintainer calibration evidence"
```

---

### Task 3: Rewrite the operational review and calibration documents

**Files:**
- Modify: `docs/governance/REVIEW-RUNBOOK.md`
- Modify: `docs/governance/CALIBRATION-PROCEDURE.md`
- Modify: `docs/superpowers/specs/2026-07-30-github-delivery-workflow-design.md`
- Modify: `tools/delivery-governance/test/governance-docs.test.mjs`

**Interfaces:**
- Consumes: exact ruleset contexts and evidence schema from Tasks 1 and 2.
- Produces: the human-operational contract for task-to-epic and epic-to-main review without self-approval.

- [ ] **Step 1: Replace runbook phrase assertions with the solo-maintainer contract**

In the runbook test, use this required phrase list:

```js
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
```

- [ ] **Step 2: Replace calibration procedure phrase assertions**

Use:

```js
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
```

- [ ] **Step 3: Run the documentation test and verify red**

```bash
node --test test/governance-docs.test.mjs
```

Expected: failures identify old independent-approval language and missing solo-maintainer enforcement language.

- [ ] **Step 4: Rewrite the review runbook evidence rules**

`docs/governance/REVIEW-RUNBOOK.md` must state all of the following explicitly:

1. Solo-maintainer mode permits `EmpRider` to author and merge a PR after all required evidence is current.
2. `Delivery gates`, `semgrep-cloud-platform/scan`, and `CodeRabbit` are required GitHub status contexts.
3. A missing, skipped, cancelled, stale, or failed required context blocks merge.
4. Strict branch freshness requires the PR head to be current with its target branch.
5. Every actionable review conversation must be resolved.
6. `CODEOWNERS` routes ownership but does not require a self-approval.
7. CodeRabbit runs before Qodo.
8. Qodo `/agentic_review` is requested only on the stable head.
9. Code Review AI remains epic-to-main only and is invoked after all earlier gates clear.
10. Any code commit invalidates earlier affected reviewer evidence.
11. A bot comment is evidence, not a GitHub approval.
12. There is no administrator bypass.

The task-to-epic sequence must end with squash merge after current-head deterministic checks, Semgrep, CodeRabbit, Qodo during the trial, and resolved conversations.

The epic-to-main sequence must end with a merge commit after current-head deterministic checks, Semgrep, CodeRabbit, Qodo, one Code Review AI invocation, and resolved conversations.

Remove every instruction to request or obtain independent approval from `@EmpRider`.

- [ ] **Step 5: Rewrite the calibration procedure**

`docs/governance/CALIBRATION-PROCEDURE.md` must use the same `EmpRider` identity for branch creation, commits, PR authorship, review coordination, and merge. Retain two levels:

**Level 1: Task-to-Epic**

1. Open the task PR as draft.
2. Add a temporary non-production JavaScript fixture containing an obvious injection sink.
3. Mark ready and record that Semgrep blocks and CodeRabbit reviews it.
4. Return to draft, remove the fixture, and commit the safe governance implementation.
5. Wait for `Delivery gates`, `semgrep-cloud-platform/scan`, and `CodeRabbit` on the new stable head.
6. Request Qodo `/agentic_review` and resolve every actionable finding.
7. Confirm Code Review AI was not invoked.
8. Confirm an unresolved conversation blocks merge.
9. Resolve it and squash merge.

**Level 2: Epic-to-Main**

1. Open the epic PR to `main`.
2. Confirm all three required contexts on the current head.
3. Request Qodo on the stable head.
4. Invoke Code Review AI once after earlier gates clear.
5. Create a harmless commit on the epic branch and prove earlier required contexts are no longer current for the new head.
6. Rerun checks/reviews and resolve all conversations.
7. Merge with a merge commit.

**Enforcement tests** must include missing required status, out-of-date branch, unresolved conversation, disallowed merge method, direct push, non-fast-forward push, and deletion attempts. No test may rely on a second identity or stale human approval.

Record the Qodo portal observation exactly as `Day 1 of 14 · Trial`; keep `exactEndsOn` null unless Qodo exposes a trustworthy date.

- [ ] **Step 6: Amend the original delivery workflow design**

In `docs/superpowers/specs/2026-07-30-github-delivery-workflow-design.md`:

- Change the purpose from “independent review” to “current-head automated and AI review”.
- In the reviewer matrix, replace `Independent Code Owner review` with `Resolved conversations and current required statuses` for all PR levels.
- Remove the independent approver steps from the review sequence.
- Replace the separate-author calibration section with solo-maintainer calibration using `EmpRider`.
- State that `CODEOWNERS` is advisory routing in solo-maintainer mode.
- Replace repository-rule requirements for approval count, Code Owner approval, and last-push approval with zero approvals plus the exact required contexts.
- Replace stale-approval tests with stale-status/head-freshness tests.
- Update acceptance criteria so task PRs require `Delivery gates`, Semgrep, CodeRabbit, Qodo during the trial, and resolved conversations; epic PRs additionally require Code Review AI.
- Preserve all branch, release, quota, performance, and no-bypass rules.

- [ ] **Step 7: Run documentation tests and Markdown lint**

```bash
node --test test/governance-docs.test.mjs
npm run lint:markdown
```

Expected: all documentation tests pass and Markdown lint exits `0`.

- [ ] **Step 8: Commit the operational contract**

```bash
git add docs/governance/REVIEW-RUNBOOK.md docs/governance/CALIBRATION-PROCEDURE.md docs/superpowers/specs/2026-07-30-github-delivery-workflow-design.md tools/delivery-governance/test/governance-docs.test.mjs
git commit -m "ECDD-56: document solo-maintainer review flow"
```

---

### Task 4: Verify the complete governance package before opening the PR

**Files:**
- Verify: `tools/delivery-governance/package.json`
- Verify: all files changed in Tasks 1–3
- Update only when actual verification evidence requires it: `docs/superpowers/plans/2026-07-31-solo-maintainer-review-governance.md`

**Interfaces:**
- Consumes: rulesets, schema/example, runbook, calibration procedure, design documents, and tests.
- Produces: complete current-head verification evidence for the task PR body.

- [ ] **Step 1: Install the pinned governance dependencies**

From `tools/delivery-governance`:

```bash
npm ci
```

Expected: exit code `0`; no lockfile change.

- [ ] **Step 2: Run the complete test suite**

```bash
npm test
```

Expected: every test passes with `0` failures. Record the exact pass count rather than copying the previous `74`-test bootstrap count.

- [ ] **Step 3: Run repository validation**

```bash
npm run validate:repository
```

Expected: exit code `0`; no schema, link, secret, generated-output, or structured-file error.

- [ ] **Step 4: Run Markdown lint**

```bash
npm run lint:markdown
```

Expected: exit code `0`.

- [ ] **Step 5: Run the administration client in dry-run mode**

```bash
node src/github-admin.mjs
```

Expected output includes:

```text
DRY RUN PATCH https://api.github.com/repos/EmpRider/ERC-Chart-Desktop-App
DRY RUN PUT https://api.github.com/repos/EmpRider/ERC-Chart-Desktop-App/actions/permissions/workflow
DRY RUN ruleset ERC main
DRY RUN ruleset ERC epic branches
```

No network write or token is used.

- [ ] **Step 6: Inspect the branch diff**

Compare `epic/ECDD-53-repository-build...task/ECDD-56-solo-maintainer-review` and confirm only these categories changed:

- solo-maintainer design and plan documents;
- desired-state rulesets;
- governance tests;
- review/calibration documents;
- calibration schema and example.

No application code, dependency, installer, release asset, or generated output may appear.

- [ ] **Step 7: Stop on any verification failure**

Do not open or update the PR body with passing claims until the failing command has been rerun successfully on the final head. Do not infer one command’s success from another command.

---

### Task 5: Open the task PR and calibrate exact current-head review contexts

**Files:**
- PR metadata only; no file is changed unless a context name differs from the exact expected contract.

**Interfaces:**
- Consumes: verified task branch head from Task 4.
- Produces: a task-to-epic PR whose current head exposes the exact stable status and reviewer evidence used by the live ruleset.

- [ ] **Step 1: Open a draft task PR through `@GitHub` MCP**

Use:

```text
Title: ECDD-56: adopt solo-maintainer review governance
Head: task/ECDD-56-solo-maintainer-review
Base: epic/ECDD-53-repository-build
Draft: true
```

Use this PR body, replacing only the exact current head SHA, GitHub Actions run ID, and measured test count with fresh evidence:

```markdown
## Jira

- Issue: [ECDD-56](https://erc-chart.atlassian.net/browse/ECDD-56)
- Parent epic: [ECDD-53](https://erc-chart.atlassian.net/browse/ECDD-53)

## Acceptance criteria

- [x] Solo-maintainer PRs require zero human approvals.
- [x] `Delivery gates`, `semgrep-cloud-platform/scan`, and `CodeRabbit` are required on the current head.
- [x] Strict branch freshness and resolved conversations remain mandatory.
- [x] Qodo remains required during the trial and Code Review AI remains epic-to-main only.
- [x] Deletion, force push, bypass, and merge-method protections remain unchanged.
- [x] Calibration evidence and governance documentation no longer require a second GitHub identity.

## Out of scope

Application code, build implementation, installer production, release publication, custom parsing of AI comments, and reviewer-provider replacement are not changed.

## Design

The desired-state rulesets enforce stable machine-readable checks and unresolved-conversation blocking. Comment-only or review-only AI evidence remains fail-closed in the runbook instead of being converted into a brittle custom status parser.

## Verification

```text
Current head: <40-character task head SHA>
GitHub Actions run: <run ID after ready-for-review>

npm ci: passed
npm test: <exact count> passed, 0 failed
npm run validate:repository: passed
npm run lint:markdown: passed
github-admin dry-run: passed with no writes
```

## Performance

This change parses the same two small ruleset documents and governance files. It adds no runtime path, polling loop, API call, or application dependency.

## Dependencies

No dependency is added or changed.

## Risk and rollback

The primary risk is allowing merge without sufficient evidence or requiring an unstable context. Roll back by restoring the previous desired-state JSON and governance documents, importing the prior rulesets, and verifying the live state before allowing another merge.

## Screenshots

Not applicable. This change affects repository governance only.

## Security declaration

- [x] No secrets, credentials, installers, generated binaries, or local state are included.
```

- [ ] **Step 2: Mark the PR ready only after Task 4 is green**

Use `@GitHub` MCP to transition the draft PR to ready for review.

- [ ] **Step 3: Wait for deterministic and stable reviewer contexts**

For the exact current head, verify:

```text
Delivery gates                  success
semgrep-cloud-platform/scan     success
CodeRabbit                      success
```

Also verify the CodeRabbit review is comprehensive rather than a draft-skip or summary-only result.

- [ ] **Step 4: Fail closed on a context-name mismatch**

Compare the exact emitted names with:

```text
Delivery gates
semgrep-cloud-platform/scan
CodeRabbit
```

When a name differs, do not edit the live ruleset. Update both desired-state JSON files and `REQUIRED_CONTEXTS` in `rulesets.test.mjs` to the exact observed stable name, rerun all Task 4 commands, commit:

```bash
git commit -m "ECDD-56: calibrate required review context names"
```

Then wait for all checks on the new head again.

- [ ] **Step 5: Request Qodo only after the head is stable**

Post exactly:

```text
/agentic_review
```

Confirm Qodo reviewed the current head and has no unresolved actionable finding. Confirm Code Review AI was not invoked on this task PR.

- [ ] **Step 6: Resolve every actionable thread**

Any code or document fix creates a new head and invalidates prior affected evidence. Repeat Steps 3–5 after each fix commit. Do not merge while any review thread remains unresolved.

---

### Task 6: Apply and verify the live solo-maintainer rulesets

**Files:**
- Live GitHub repository settings only.
- Evidence captured in the task PR body and `ECDD-56` Jira comment.

**Interfaces:**
- Consumes: calibrated exact context names from Task 5.
- Produces: active GitHub protection that permits the sole maintainer to merge only after strict automated evidence is current.

- [ ] **Step 1: Edit `ERC epic branches` through GitHub UI**

Set:

```text
Enforcement: Active
Bypass list: empty
Target: refs/heads/epic/*
Allowed merge method: Squash
Required approvals: 0
Require Code Owner review: Off
Require approval of most recent push: Off
Require conversation resolution: On
Dismiss stale reviews: On
Require status checks: On
Require branches to be up to date: On
Required checks:
  Delivery gates
  semgrep-cloud-platform/scan
  CodeRabbit
Restrict deletions: On
Block force pushes: On
```

Save only after the exact context names match Task 5 evidence.

- [ ] **Step 2: Edit `ERC main` through GitHub UI**

Use the same values except:

```text
Target: refs/heads/main
Allowed merge method: Merge
```

- [ ] **Step 3: Verify the ruleset list**

Expected:

```text
ERC main             Active   1 branch
ERC epic branches    Active   at least 1 branch after epic/ECDD-53-repository-build exists
```

There must be no `main-protect` ruleset and no bypass actor.

- [ ] **Step 4: Prove unresolved conversation blocking**

Create or retain one review conversation on the task PR and confirm GitHub reports it as a merge blocker. Resolve the conversation and confirm that blocker clears without adding a human approval requirement.

- [ ] **Step 5: Prove required-context blocking**

Use the current PR checks view to confirm merge remains blocked until all three exact required contexts are successful. Do not bypass or dismiss a missing check.

- [ ] **Step 6: Prove branch freshness**

When the epic base advances, confirm the task PR becomes out-of-date and cannot merge until updated and all required checks rerun on the resulting head.

- [ ] **Step 7: Record live evidence**

Update the task PR verification block and add a Jira comment to `ECDD-56` containing:

- task PR number;
- current head SHA;
- exact required context names;
- Qodo portal text `Day 1 of 14 · Trial`;
- ruleset screenshots/read-back;
- unresolved-conversation blocker result;
- stale-branch blocker result;
- confirmation that approval count is zero and bypass lists are empty.

---

### Task 7: Complete task-to-epic integration and preserve epic-to-main calibration

**Files:**
- No source file change unless final review findings require a fix.
- Update real values in `docs/governance/calibration-evidence.example.json` only when both task and epic PR observations are complete; until then it remains a representative example.

**Interfaces:**
- Consumes: current-head checks, AI review evidence, resolved threads, and live `ERC epic branches` enforcement.
- Produces: a squash-merged ECDD-56 task and a documented epic-to-main calibration checkpoint.

- [ ] **Step 1: Perform a fresh pre-merge verification**

Immediately before merge, fetch the PR and verify:

```text
Head SHA: unchanged from the reviewed SHA
Delivery gates: success on that SHA
semgrep-cloud-platform/scan: success on that SHA
CodeRabbit: success and comprehensive on that SHA
Qodo: current-head review complete
Code Review AI: not invoked
Unresolved threads: 0
Required human approvals: 0
Mergeable: true
```

- [ ] **Step 2: Squash merge with a head-SHA lock**

Use `@GitHub` MCP `merge_pull_request` with:

```text
merge_method: squash
expected_head_sha: <freshly verified task head SHA>
commit_title: ECDD-56: adopt solo-maintainer review governance
```

Do not retry with a different SHA without repeating Step 1.

- [ ] **Step 3: Verify the task merge**

Fetch the PR and confirm:

```text
state: closed
merged: true
base: epic/ECDD-53-repository-build
```

Record the squash commit SHA in Jira.

- [ ] **Step 4: Keep the epic-to-main gate fail closed**

Do not merge `epic/ECDD-53-repository-build` to `main` merely to finish this task. When the ECDD-53 epic is ready for its normal epic-to-main PR, run Level 2 calibration using the solo-maintainer sequence: current `Delivery gates`, Semgrep, CodeRabbit, stable-head Qodo, one Code Review AI invocation, zero unresolved threads, merge-commit-only enforcement, and a current head-SHA lock.

- [ ] **Step 5: Reconcile desired state after the epic reaches main**

After the eventual ECDD-53 epic merge, verify that `main` contains the updated `.github/rulesets/*.json`, run the administration client in dry-run mode, and confirm live rulesets match the committed desired state. The GitHub UI remains the apply path unless a supported ruleset mutation becomes available through the connector.

---

## Plan Self-Review

- **Spec coverage:** Every approved design requirement maps to Tasks 1–7: zero approvals, three stable contexts, strict freshness, resolved conversations, Qodo/Code Review AI sequencing, empty bypass lists, merge methods, force-push/deletion protection, evidence schema, runbook, calibration, and rollback.
- **No placeholders:** Runtime code and test steps contain exact file paths, context names, commands, assertions, and expected outcomes. PR-specific SHA, run ID, test count, and PR number are intentionally real execution evidence and must be populated from the actual run rather than invented.
- **Type/name consistency:** The context names are identical in ruleset JSON, tests, example evidence, runbook, calibration procedure, and PR verification steps. Evidence uses `maintainer`, `qodoCapacity`, and the same assertion names throughout.
- **Scope:** This plan changes governance only. Application scaffolding, installer, releases, and custom bot-comment parsing remain out of scope.
