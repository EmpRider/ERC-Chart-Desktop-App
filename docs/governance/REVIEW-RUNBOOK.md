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

CodeRabbit has two distinct roles. Its stable `CodeRabbit` status context is part
of the machine-enforced contract, while a separately requested comprehensive
CodeRabbit review is operational review evidence. These two roles must not be
conflated.

## Machine-Enforced GitHub Evidence

- Deterministic checks run before any AI review.
- `Delivery gates`, `semgrep-cloud-platform/scan`, and `CodeRabbit` are the
  required GitHub status contexts.
- CodeRabbit required status remains mandatory at both pull-request levels.
- A missing, skipped, cancelled, stale, or failed required context blocks merge.
- Strict branch freshness requires the pull-request head to be current with its
  target branch.
- Merge is blocked until all review conversations are resolved.
- `CODEOWNERS` routes ownership to `@EmpRider`; it is not a self-approval gate.
- Any code commit invalidates prior review evidence for affected checks.
- A bot comment is evidence, not a GitHub approval or status check.
- A provider becomes required by a ruleset only after calibration proves a stable
  machine-readable pass/fail context.

## Manual AI Evidence

- Manual comprehensive CodeRabbit review is mandatory only for epic-to-main.
- Task-to-epic requires a maintainer code review on the stable exact head.
- On task-to-epic, request one comprehensive CodeRabbit review when current quota
  is available. If quota is unavailable or rate-limited, record that fact and continue
  after maintainer code review once all machine gates and conversations are clean.
- The process must not delay a task-to-epic merge solely for manual CodeRabbit review capacity.
- When a manual CodeRabbit review is requested, it runs before Qodo so its findings
  can be handled before optional follow-up review evidence.
- Qodo is requested with `/agentic_review` only on a stable head during approved
  capacity.
- Code Review AI is reserved for epic-to-main pull requests only.
- Findings from any manual review that is actually run should be fixed or
  explicitly rejected with rationale.
- Review comments that create GitHub conversations remain enforceable through the
  required conversation-resolution rule.
- Absence of optional task-to-epic CodeRabbit, Qodo, or Code Review AI evidence
  does not create a GitHub ruleset failure under the current provider capabilities.

## Task-to-Epic Sequence

1. Keep the task pull request in draft while files are changing.
2. Run deterministic commands and record exact output.
3. Mark the pull request ready for review.
4. Wait for current-head `Delivery gates`, `semgrep-cloud-platform/scan`, and
   `CodeRabbit` required status contexts.
5. Perform maintainer code review on the stable exact head and resolve every
   actionable finding and every review conversation.
6. Check CodeRabbit manual-review capacity once. If quota is available, request
   one comprehensive review and consider its findings. If quota is unavailable or
   rate-limited, record the capacity result and continue without polling for it.
7. During approved Qodo capacity, request `/agentic_review` after the machine
   gates are clear and the head is stable.
8. Consider any manual AI findings and resolve any GitHub conversations they
   create.
9. Confirm Code Review AI was not intentionally invoked on the task pull request.
10. Recheck the machine-enforced merge contract and squash merge with expected-head
    locking.

A fix commit returns the sequence to step 4 and requires a fresh maintainer code
review. A manual comprehensive CodeRabbit rerun is best-effort and is requested
only when quota is available.

## Epic-to-Main Sequence

1. Keep the epic pull request in draft while the branch is changing.
2. Run the complete deterministic and Windows packaging suite that applies.
3. Mark the pull request ready for review.
4. Wait for current-head `Delivery gates`, `semgrep-cloud-platform/scan`, and
   `CodeRabbit` required status contexts.
5. Perform maintainer code review on the stable exact head and resolve actionable
   findings and conversations.
6. Request and wait for a comprehensive CodeRabbit review on the current stable
   head. This manual comprehensive review is mandatory for epic-to-main.
7. Request Qodo `/agentic_review` on the stable head when capacity is available.
8. Invoke Code Review AI once after the earlier evidence is clear.
9. Consider the manual AI findings and resolve any GitHub conversations.
10. Recheck the machine-enforced merge contract and merge with a merge commit using
    expected-head locking.

After any code or governance commit made after review evidence, return to step 4
for the applicable pull-request level. Rerun affected machine checks, including CodeRabbit.
For task-to-epic, repeat maintainer code review and request manual comprehensive CodeRabbit review only when quota is available; if unavailable, record the approved unavailability explicitly and continue once required statuses and conversations are clean. For epic-to-main, fresh comprehensive CodeRabbit review remains mandatory. Request fresh manual reviews on the stable head when their applicable policy requires them and never represent stale evidence as current.

## Review Capacity

Task-to-epic work must not spend repeated turns waiting on CodeRabbit manual-review
quota. Check capacity once after the exact head is stable. If a review is available,
run it once and handle its findings. If capacity is unavailable or rate-limited,
record the result, complete maintainer code review, and proceed when the required
machine statuses and conversation-resolution gate are green.

Epic-to-main is the mandatory comprehensive CodeRabbit boundary. Reserve available
CodeRabbit review capacity for this level; if comprehensive review capacity is
unavailable, the epic-to-main merge remains blocked until that review can run.

Code Review AI quota is eight first-pass epic reviews plus two re-reviews. It must
not be intentionally invoked on task pull requests. The re-reviews remain
reserved for coherent fixes after an initial epic review.

For an active Qodo trial, record the observed numeric day in `trialDay` and use
matching `displayText` in the form `Day N of 14 · Trial`. For example, day one is
`Day 1 of 14 · Trial`. When Qodo capacity is inactive or unavailable, set
`active: false`, omit `trialDay`, and record a non-empty explanatory `displayText`.
Keep `exactEndsOn` as `null` unless the provider exposes a trustworthy date.

Provider unavailability does not weaken the machine-enforced GitHub contract. It
means the corresponding optional manual evidence is unavailable and must be
recorded honestly rather than represented as a blocking status. The exception is
manual comprehensive CodeRabbit review on epic-to-main, which this runbook makes
an operational merge requirement even though its separate status context is the
machine-enforced check.

## Failure Handling

- Missing or cancelled required status: do not merge.
- Required status attached to an older head: rerun it.
- Out-of-date branch: update the branch and rerun affected checks.
- New blocking Semgrep finding: do not merge.
- Comprehensive CodeRabbit review unavailable or rate-limited on task-to-epic:
  record the result, complete maintainer code review, and continue when the
  machine-enforced contract is green.
- Comprehensive CodeRabbit review unavailable or rate-limited on epic-to-main:
  do not merge until a fresh comprehensive review can run.
- Actionable manual AI finding: fix it or record a reasoned rejection.
- Unresolved conversation: do not merge.
- Unexpected status-context name: do not edit the live ruleset until the exact
  stable name is calibrated and committed.
