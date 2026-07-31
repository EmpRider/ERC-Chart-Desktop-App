# Delivery Review Runbook

## Purpose

This runbook is the operational source of truth for task-to-epic and epic-to-main
pull requests.

Solo-maintainer mode permits `EmpRider` to author and merge after every
GitHub-enforced condition is current. The machine-enforced merge contract is
fail-closed and has no administrator bypass.

Qodo and Code Review AI currently publish comments or review evidence rather than
stable pass/fail contexts. GitHub rulesets do not enforce Qodo or Code Review AI.
They are manual, non-blocking review evidence: the maintainer should request and
consider them at the documented stage, but this runbook does not claim that they
technically block a GitHub merge.

## Machine-Enforced GitHub Evidence

- Deterministic checks run before any AI review.
- `Delivery gates`, `semgrep-cloud-platform/scan`, and `CodeRabbit` are the
  required GitHub status contexts.
- A missing, skipped, cancelled, stale, or failed required context blocks merge.
- Strict branch freshness requires the pull-request head to be current with its
  target branch.
- Merge is blocked until all review conversations are resolved.
- `CODEOWNERS` routes ownership to `@EmpRider`; it is not a self-approval gate.
- Any code commit invalidates prior evidence for affected current-head checks.
- A bot comment is evidence, not a GitHub approval or status check.
- A provider becomes required by a ruleset only after calibration proves a stable
  machine-readable pass/fail context.

## Manual AI Evidence

- CodeRabbit runs before Qodo because CodeRabbit is a required status and Qodo is
  requested only after the machine gates are clear.
- Qodo is requested with `/agentic_review` only on a stable head during approved
  capacity.
- Code Review AI is reserved for epic-to-main pull requests only.
- Findings from Qodo or Code Review AI should be fixed or explicitly rejected
  with rationale.
- Review comments that create GitHub conversations remain enforceable through the
  required conversation-resolution rule.
- Absence of Qodo or Code Review AI evidence does not create a GitHub ruleset
  failure under the current provider capabilities.

## Task-to-Epic Sequence

1. Keep the task pull request in draft while files are changing.
2. Run deterministic commands and record exact output.
3. Mark the pull request ready for review.
4. Wait for current-head `Delivery gates`, `semgrep-cloud-platform/scan`, and a
   comprehensive CodeRabbit result.
5. Resolve every actionable finding and every review conversation.
6. During approved Qodo capacity, request `/agentic_review` after the machine
   gates are clear and the head is stable.
7. Consider Qodo findings and resolve any GitHub conversations it creates.
8. Confirm Code Review AI was not intentionally invoked on the task pull request.
9. Recheck the machine-enforced merge contract and squash merge with expected-head
   locking.

A fix commit returns the sequence to step 4.

## Epic-to-Main Sequence

1. Keep the epic pull request in draft while the branch is changing.
2. Run the complete deterministic and Windows packaging suite that applies.
3. Mark the pull request ready for review.
4. Wait for current-head `Delivery gates`, `semgrep-cloud-platform/scan`, and a
   comprehensive CodeRabbit result.
5. Resolve all actionable findings and conversations.
6. Request Qodo `/agentic_review` on the stable head when capacity is available.
7. Invoke Code Review AI once after the earlier evidence is clear.
8. Consider the manual AI findings and resolve any GitHub conversations.
9. Recheck the machine-enforced merge contract and merge with a merge commit using
   expected-head locking.

A code commit after a manual review makes that review stale as evidence, even
though GitHub does not enforce rerunning it.

## Review Capacity

Code Review AI quota is eight first-pass epic reviews plus two re-reviews. It must
not be intentionally invoked on task pull requests. The re-reviews remain
reserved for coherent fixes after an initial epic review.

Qodo task review is requested while the approved 14-day trial or another approved
capacity rule is active. The portal observation is recorded exactly as
`Day 1 of 14 · Trial`; an end date is not inferred when the portal does not expose
one.

Provider unavailability does not weaken the machine-enforced GitHub contract. It
means the corresponding manual evidence is unavailable and must be recorded
honestly rather than represented as a blocking status.

## Failure Handling

- Missing or cancelled required status: do not merge.
- Required status attached to an older head: rerun it.
- Out-of-date branch: update the branch and rerun affected checks.
- New blocking Semgrep finding: do not merge.
- Comprehensive CodeRabbit review unavailable or rate-limited: do not treat its
  success status alone as sufficient operational evidence.
- Actionable manual AI finding: fix it or record a reasoned rejection.
- Unresolved conversation: do not merge.
- Unexpected status-context name: do not edit the live ruleset until the exact
  stable name is calibrated and committed.
