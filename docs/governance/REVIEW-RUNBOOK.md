# Delivery Review Runbook

## Purpose

This runbook is the operational source of truth for task-to-epic and epic-to-main pull requests. Missing, stale, cancelled, skipped, summary-only, or failed evidence never satisfies a gate. Administrator bypass is prohibited.

## Evidence Rules

- Deterministic checks run before any AI review.
- `Delivery gates` and Semgrep must complete on the current head commit.
- CodeRabbit runs before Qodo.
- Qodo is requested with `/agentic_review` only on a stable head commit.
- Code Review AI is reserved for epic-to-main pull requests only.
- Any code commit invalidates prior review evidence and requires the affected checks and reviews to run again.
- Independent Code Owner approval from `@EmpRider` is requested last, after all automated and AI evidence is current and clear.
- A bot comment is evidence, not a GitHub approval. A comment-only provider cannot be treated as a required status check.
- A provider is added to a ruleset only when calibration proves that it emits a stable pass/fail status context.

## Task-to-Epic Sequence

1. Keep the task pull request in draft while code changes are in progress.
2. Run the local deterministic commands and record exact current-head output in the pull-request body.
3. Mark the pull request ready and wait for `Delivery gates`, Semgrep, and a comprehensive CodeRabbit review.
4. Resolve every actionable finding. Any fix commit invalidates earlier evidence.
5. During the Qodo trial, request `/agentic_review` only after the head is stable and earlier gates are clear.
6. Rerun affected deterministic tests after every fix.
7. Request independent `@EmpRider` Code Owner approval last.
8. Squash merge only when current-head evidence is clear and all conversations are resolved.

## Epic-to-Main Sequence

1. Keep the epic pull request in draft while the epic branch is changing.
2. Run the complete deterministic suite and record exact current-head results.
3. Mark ready and wait for `Delivery gates`, Semgrep, and CodeRabbit.
4. Resolve all actionable findings and return to a stable head.
5. Request Qodo `/agentic_review` on that stable head.
6. Invoke Code Review AI once, only after every earlier gate is clear.
7. Request independent `@EmpRider` Code Owner approval last.
8. Merge with a merge commit only when all current-head evidence is valid and all review threads are resolved.

## Review Capacity

Code Review AI has a monthly allocation of eight first-pass epic reviews plus two re-reviews. It must never be intentionally invoked on task pull requests. Preserve the two re-reviews for fixes after an initial epic review.

Qodo task-to-epic review is required only while the approved trial or a separately approved continued-capacity rule is active. The exact trial end date must be read from the Qodo portal and recorded during calibration; it must not be inferred from installation time.

Epic-to-main remains fail-closed when paid or otherwise qualified Qodo capacity is unavailable. There is no silent downgrade, no administrator bypass, and no substitution of an old or summary-only result. A governance change must explicitly record any future capacity rule before the task-level requirement changes.

## Failure Handling

- Missing or cancelled deterministic checks: do not merge.
- New high- or critical-severity Semgrep finding: do not merge.
- Actionable CodeRabbit, Qodo, or Code Review AI finding: fix or document a reviewed rejection before proceeding.
- Review evidence from an older head: rerun it.
- Unresolved conversation: do not merge.
- Missing Code Owner approval: do not merge.
- Missing Qodo epic capacity: stop the epic merge and restore qualified capacity or approve a governance change; never bypass.
