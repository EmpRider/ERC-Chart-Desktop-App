# Delivery Review Runbook

## Purpose

This runbook is the operational source of truth for task-to-epic and epic-to-main
pull requests.

Solo-maintainer mode permits `EmpRider` to author and merge a pull request only
when every required current-head check and review condition is satisfied. The
mode removes an impossible self-approval requirement; it does not create a
review bypass.

Missing, stale, cancelled, skipped, summary-only, or failed evidence never
satisfies a gate. The process is fail-closed and there is no administrator
bypass.

## Enforced GitHub Evidence

- Deterministic checks run before any AI review.
- `Delivery gates`, `semgrep-cloud-platform/scan`, and `CodeRabbit` are the
  required GitHub status contexts.
- A missing, skipped, cancelled, stale, or failed required context blocks merge.
- Strict branch freshness requires the pull-request head to be current with its
  target branch.
- Merge is blocked until all review conversations are resolved.
- `CODEOWNERS` routes repository ownership to `@EmpRider`, but it does not
  require or represent a self-approval in solo-maintainer mode.
- CodeRabbit runs before Qodo.
- Qodo is requested with `/agentic_review` only on a stable head.
- Code Review AI is reserved for epic-to-main pull requests only.
- Any code commit invalidates prior review evidence for affected checks and
  reviewers.
- A bot comment is evidence, not a GitHub approval.
- A provider becomes a required ruleset status only after calibration proves a
  stable machine-readable pass/fail context.

## Task-to-Epic Sequence

1. Keep the task pull request in draft while files are changing.
2. Run the applicable deterministic commands and record exact output.
3. Mark the pull request ready for review.
4. Wait for current-head `Delivery gates`, `semgrep-cloud-platform/scan`, and
   comprehensive CodeRabbit evidence.
5. Resolve every actionable finding and every review conversation.
6. During active approved Qodo capacity, request `/agentic_review` after the
   earlier gates are clear and the head is stable.
7. Confirm Qodo assessed the same current head and no actionable finding remains.
8. Confirm Code Review AI was not intentionally invoked on the task pull request.
9. Squash merge only while all evidence remains current and the branch remains
   up to date with its epic target.

Any fix commit returns the sequence to step 4.

## Epic-to-Main Sequence

1. Keep the epic pull request in draft while the epic branch is changing.
2. Run the complete deterministic and Windows packaging suite that applies at
   the current project stage.
3. Mark the pull request ready for review.
4. Wait for current-head `Delivery gates`, `semgrep-cloud-platform/scan`, and
   comprehensive CodeRabbit evidence.
5. Resolve all actionable findings and return to a stable head.
6. Request Qodo `/agentic_review` on that stable head.
7. Invoke Code Review AI once after all earlier gates are clear.
8. Resolve every actionable finding and all review conversations.
9. Merge with a merge commit using a freshly verified expected head SHA.

Any code commit after Qodo or Code Review AI review invalidates the affected
review evidence and requires the applicable sequence to run again.

## Review Capacity

Code Review AI has a monthly allocation of eight first-pass epic reviews plus two re-reviews.
It must never be intentionally invoked on task pull requests. The two re-reviews
remain reserved for coherent fixes after initial epic review.

Qodo task-to-epic review is required while the approved 14-day trial or another
explicitly approved capacity rule is active. The current portal observation is
recorded exactly as `Day 1 of 14 · Trial`. An exact end date is not inferred when
the portal does not expose one.

Epic-to-main remains fail-closed when qualified Qodo capacity is unavailable.
There is no silent downgrade. A reviewed governance change must define any
replacement before an epic merge can proceed without Qodo.

## Failure Handling

- Missing or cancelled deterministic check: do not merge.
- Required context attached to an older head: rerun it.
- Out-of-date branch: update the branch and rerun all affected checks.
- New high- or critical-severity Semgrep finding: do not merge.
- Actionable CodeRabbit, Qodo, or Code Review AI finding: fix it or record a
  reviewed rejection with rationale.
- Unresolved conversation: do not merge.
- Missing required Qodo epic capacity: stop and restore capacity or approve a
  governance change.
- Unexpected status-context name: do not edit the live ruleset until the exact
  stable name is calibrated and committed.
