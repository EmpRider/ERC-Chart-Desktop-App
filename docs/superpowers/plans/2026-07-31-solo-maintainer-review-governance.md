# Solo-Maintainer Review Governance Implementation Plan

## Goal

Replace impossible self-approval requirements with fail-closed current-head
GitHub enforcement for the single-maintainer MCP workflow, while documenting
comment-only reviewers as manual evidence.

## Scope

This plan changes only delivery governance:

- desired-state GitHub rulesets;
- governance tests and validation workflow;
- review and calibration documentation;
- calibration evidence schema and example; and
- the solo-maintainer design amendment.

Application code, installer implementation, release automation, generated
artifacts, custom parsing of AI comments, and reviewer-provider replacement are
out of scope.

## Enforcement Boundary

GitHub-enforced task-to-epic conditions are:

- `Delivery gates` on the current head;
- `semgrep-cloud-platform/scan` on the current head;
- `CodeRabbit` on the current head;
- all review conversations resolved;
- the branch current with its epic target;
- squash merge only; and
- no bypass actor.

The equivalent epic-to-main contract uses merge commits only.

Qodo `/agentic_review` and Code Review AI do not emit calibrated stable status
contexts. They are requested at the documented stages as manual, non-blocking
review evidence. This plan does not claim their absence creates a GitHub ruleset
failure.

## Task 1: Ruleset Contract

- [x] Add tests for both desired-state rulesets.
- [x] Require zero approving reviews.
- [x] Disable Code Owner and latest-push approval requirements.
- [x] Preserve resolved-conversation enforcement.
- [x] Preserve deletion and non-fast-forward protection.
- [x] Preserve squash for `epic/*` and merge commits for `main`.
- [x] Require exact contexts:

  ```text
  Delivery gates
  semgrep-cloud-platform/scan
  CodeRabbit
  ```

- [x] Verify RED before implementing the desired state.
- [x] Verify the full Delivery gates workflow after implementation.

## Task 2: Calibration Evidence

- [x] Replace separate author and approver fields with `maintainer: EmpRider`.
- [x] Bind observations to task and epic head SHAs.
- [x] Require lowercase 40-character commit SHAs.
- [x] Record Qodo capacity as structured data.
- [x] Require exact portal text `Day 1 of 14 · Trial`.
- [x] Keep `exactEndsOn` as `null` unless a trustworthy date exists.
- [x] Validate the example through the actual schema.
- [x] Add rejection tests for missing or malformed SHAs and alternate trial text.

## Task 3: Operational Documentation

- [x] Rewrite the runbook for solo-maintainer current-head evidence.
- [x] Rewrite calibration to use the same `EmpRider` identity.
- [x] Separate GitHub-enforced conditions from manual provider evidence.
- [x] Keep Qodo requested during available trial capacity.
- [x] Keep Code Review AI exclusive to epic-to-main.
- [x] Preserve quotas, merge methods, performance requirements, and no bypass.
- [x] Keep the original version and release policy unchanged.
- [x] Test the documentation contract before implementation.

## Task 4: Complete Verification

The current-head workflow executes:

```bash
npm ci --prefix tools/delivery-governance --ignore-scripts
npm --prefix tools/delivery-governance test
npm --prefix tools/delivery-governance run validate:pr
npm --prefix tools/delivery-governance run validate:repository
npm --prefix tools/delivery-governance run lint:markdown
node tools/delivery-governance/src/github-admin.mjs
```

Expected evidence:

- every governance test passes;
- pull-request and repository validation pass;
- Markdown lint reports zero issues for active files;
- the administration client performs dry-run output only;
- application gates report not applicable while root `package.json` is absent;
- the branch diff contains governance files only.

Only exact pre-existing legacy Markdown paths may be baselined. New or modified
governance documents remain linted.

## Task 5: Current-Head Calibration

- [x] Open PR #2 from `task/ECDD-56-solo-maintainer-review` to
  `epic/ECDD-53-repository-build`.
- [x] Keep the PR in draft while files change.
- [x] Confirm current-head Delivery gates.
- [x] Address CodeRabbit scope, simplicity, schema, and enforcement findings.
- [ ] Confirm a comprehensive CodeRabbit review on the final head; a rate-limited
  success status is not sufficient operational evidence.
- [ ] Confirm exact Semgrep current-head status.
- [ ] Request Qodo `/agentic_review` after machine gates are clear and record it as
  manual evidence.
- [ ] Confirm Code Review AI was not intentionally invoked on this task PR.
- [ ] Confirm no unresolved review conversation remains.

A fix commit invalidates affected current-head evidence.

## Task 6: Live Ruleset Application

Apply desired state only after exact status names are calibrated.

`ERC epic branches`:

```text
Target: refs/heads/epic/*
Merge method: Squash
Approvals: 0
Code Owner review: Off
Latest-push approval: Off
Conversation resolution: On
Strict required statuses: On
Bypass actors: none
```

`ERC main`:

```text
Target: refs/heads/main
Merge method: Merge commit
Approvals: 0
Code Owner review: Off
Latest-push approval: Off
Conversation resolution: On
Strict required statuses: On
Bypass actors: none
```

Both rulesets require only the three calibrated stable contexts. Read back live
state after application; checked-in JSON is not proof of enforcement.

## Task 7: Merge and Evidence

Before merging PR #2:

- [ ] final head SHA recorded;
- [ ] current-head Delivery gates pass;
- [ ] current-head Semgrep passes;
- [ ] current-head CodeRabbit status passes and a comprehensive review is clear;
- [ ] manual Qodo evidence recorded when capacity is available;
- [ ] all review conversations resolved;
- [ ] live epic ruleset read back and matched;
- [ ] squash merge uses expected-head locking; and
- [ ] Jira `ECDD-56` records final evidence and any unavailable manual provider.

## Rollback

Restore the previous reviewed desired state, reapply the rulesets, and read back
live state before another merge. Administrator bypass is not part of rollback.
