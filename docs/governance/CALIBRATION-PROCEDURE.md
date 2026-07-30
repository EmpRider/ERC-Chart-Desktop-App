# Delivery Gate Calibration Procedure

## Preconditions

- Bootstrap PR #1 is merged and its initial desired-state rules are applied.
- A separate coding GitHub identity is connected; it must not resolve to `EmpRider`.
- CodeRabbit, Semgrep, Qodo, and Code Review AI are installed for the repository.
- The exact Qodo trial end date is read from the Qodo portal.
- No administrator bypass is used.

## Create Calibration Work

Create one governance calibration epic in Jira project `ECDD` and one child task. Use only the Jira-returned keys in branch names and pull-request bodies.

Create the epic branch from current `main`, then create the task branch from that epic branch. Stop if the coding author is `EmpRider`.

## Level 1: Task-to-Epic

1. Open the task pull request as draft.
2. Add a temporary, non-production JavaScript fixture with an obvious injection sink.
3. Mark ready and record the blocking Semgrep result and comprehensive CodeRabbit review.
4. Return to draft, remove the unsafe fixture, add a harmless calibration record, and push one coherent fix commit.
5. Wait for deterministic checks, Semgrep, and CodeRabbit on the new stable head.
6. Request Qodo with `/agentic_review` on that stable head only.
7. Record Qodo login, representation, observed contexts, reviewed head SHA, and actionable state.
8. Confirm Code Review AI was not invoked.
9. Obtain current independent approval from `EmpRider` and squash merge into the calibration epic.

## Level 2: Epic-to-Main

1. Open the calibration epic pull request to `main`.
2. Confirm current-head `Delivery gates`, Semgrep, comprehensive CodeRabbit, and Qodo evidence.
3. Invoke Code Review AI once and record one first-pass monthly review consumed.
4. Obtain independent approval, then push a harmless reviewable commit using the separate author.
5. Confirm the earlier approval becomes stale.
6. Rerun affected checks and reviewers on the new head, then obtain a fresh independent approval.

## Enforcement Tests

Using the separate coding identity, attempt a direct push and a non-fast-forward push to the calibration epic and `main`. Both attempts must be rejected without administrator bypass.

## Evidence Rules

Populate `calibration-evidence.json` only from real observations. Record stable check names observed during the previous seven days. `Delivery gates` and the observed Semgrep status are required. Add an AI reviewer status to a ruleset only when the provider emits a stable pass/fail status; comment-only and review-only providers remain enforced by this runbook.

After updating the desired state, reapply it and verify that each of the following blocks merge:

- missing required status;
- stale approval;
- unresolved conversation;
- missing Code Owner approval.

Merge the calibration epic with a merge commit. Retire the merged epic branch only through the administration client's exact-branch temporary exclusion flow, then read back the active generic ruleset.
