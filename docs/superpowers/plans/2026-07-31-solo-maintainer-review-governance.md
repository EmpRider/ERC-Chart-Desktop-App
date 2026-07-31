# Solo-Maintainer Review Governance Implementation Plan

## Goal

Replace impossible self-approval requirements with fail-closed current-head
review enforcement for the single-maintainer GitHub MCP workflow.

## Scope

This plan changes only delivery governance:

- desired-state GitHub rulesets;
- governance tests and validation workflow;
- review and calibration documentation;
- calibration evidence schema and example; and
- the solo-maintainer design amendment.

Application code, installer implementation, release automation, generated
artifacts, and reviewer-provider replacements are out of scope.

## Required Behavior

Task-to-epic pull requests must require:

- `Delivery gates` on the current head;
- `semgrep-cloud-platform/scan` on the current head;
- `CodeRabbit` on the current head;
- resolved review conversations;
- a branch current with its epic target;
- Qodo `/agentic_review` during approved trial capacity; and
- squash merge only.

Epic-to-main pull requests additionally require Qodo and Code Review AI according
to the review runbook and use merge commits only.

The sole maintainer may author and merge after every required condition is met.
The rulesets require zero approvals, no Code Owner approval, no latest-push
approval, and no bypass actor.

## Task 1: Ruleset Contract

- [x] Add tests for both desired-state rulesets.
- [x] Require zero approving reviews.
- [x] Disable Code Owner and latest-push approval requirements.
- [x] Preserve resolved-conversation enforcement.
- [x] Preserve deletion and non-fast-forward protection.
- [x] Preserve merge methods: squash for `epic/*`, merge commit for `main`.
- [x] Require these exact contexts:

  ```text
  Delivery gates
  semgrep-cloud-platform/scan
  CodeRabbit
  ```

- [x] Verify the tests fail before the ruleset implementation.
- [x] Verify the full Delivery gates workflow passes after implementation.

## Task 2: Calibration Evidence

- [x] Replace separate author and independent approver fields with
  `maintainer: EmpRider`.
- [x] Record Qodo capacity as structured data.
- [x] Keep `exactEndsOn` as `null` unless a trustworthy date is available.
- [x] Add assertions for required-status, stale-branch, unresolved-conversation,
  merge-method, direct-push, force-push, and no-release behavior.
- [x] Validate the example through the repository schema validator.
- [x] Verify failing tests before updating the schema and example.
- [x] Verify the full Delivery gates workflow after implementation.

## Task 3: Operational Documentation

- [x] Rewrite the review runbook for current-head solo-maintainer evidence.
- [x] Rewrite calibration to use the same `EmpRider` identity.
- [x] Keep Qodo task review during the active trial.
- [x] Keep Code Review AI exclusive to epic-to-main.
- [x] Document fail-closed behavior for missing, stale, cancelled, or failed
  evidence.
- [x] Preserve review quotas, merge methods, performance requirements, and empty
  bypass lists.
- [x] Keep the existing release policy unchanged.
- [x] Verify documentation tests fail before implementation.
- [x] Verify the full Delivery gates workflow after implementation.

## Task 4: Complete Verification

The current-head workflow must execute these commands:

```bash
npm ci --prefix tools/delivery-governance --ignore-scripts
npm --prefix tools/delivery-governance test
npm --prefix tools/delivery-governance run validate:pr
npm --prefix tools/delivery-governance run validate:repository
npm --prefix tools/delivery-governance run lint:markdown
node tools/delivery-governance/src/github-admin.mjs
```

Expected evidence:

- all governance tests pass;
- pull-request contract validation passes;
- repository validation passes;
- Markdown lint reports zero issues for active files;
- the administration client prints only dry-run operations;
- application gates report not applicable while root `package.json` is absent;
- the branch diff contains governance files only.

Legacy Markdown debt may be baselined only by exact path for files that predate
this change. New or modified governance documents must remain linted.

## Task 5: Current-Head Reviewer Calibration

- [x] Open PR #2 from `task/ECDD-56-solo-maintainer-review` to
  `epic/ECDD-53-repository-build`.
- [x] Keep the PR in draft while changes are being made.
- [x] Mark it ready only after deterministic verification passes.
- [x] Confirm `Delivery gates` runs on the exact head.
- [x] Confirm CodeRabbit performs a comprehensive review rather than a draft skip.
- [ ] Resolve every actionable CodeRabbit finding.
- [ ] Confirm the exact Semgrep check context and result on the final head.
- [ ] Request Qodo `/agentic_review` only after the final head is stable.
- [ ] Confirm Code Review AI was not intentionally invoked on this task PR.
- [ ] Confirm no unresolved review conversation remains.

Any fix commit invalidates affected current-head evidence and returns this task to
reviewer calibration.

## Task 6: Live Ruleset Application

Apply the final desired state only after exact context names are calibrated.

For `ERC epic branches`:

```text
Target: refs/heads/epic/*
Allowed merge method: Squash
Required approvals: 0
Code Owner review: Off
Latest-push approval: Off
Conversation resolution: On
Strict required statuses: On
Bypass actors: none
```

For `ERC main`:

```text
Target: refs/heads/main
Allowed merge method: Merge commit
Required approvals: 0
Code Owner review: Off
Latest-push approval: Off
Conversation resolution: On
Strict required statuses: On
Bypass actors: none
```

Both rulesets require:

```text
Delivery gates
semgrep-cloud-platform/scan
CodeRabbit
```

Read back the live state after application. Do not claim enforcement from the
checked-in JSON alone.

## Task 7: Merge and Evidence

Before merging PR #2:

- [ ] final head SHA is recorded;
- [ ] current-head Delivery gates pass;
- [ ] current-head Semgrep passes;
- [ ] current-head CodeRabbit passes with no actionable finding;
- [ ] current-head Qodo review is clear during trial capacity;
- [ ] review conversations are resolved;
- [ ] the live epic ruleset is read back and matches desired state;
- [ ] squash merge is used with expected-head locking; and
- [ ] Jira `ECDD-56` records the final evidence.

After merge, verify the epic branch contains the squash commit and the task branch
is retired according to repository policy.

## Rollback

Rollback restores the previous reviewed desired-state JSON and documentation,
reapplies the previous rulesets, and reads back the live state before another
merge is allowed. Administrator bypass is not part of rollback.
