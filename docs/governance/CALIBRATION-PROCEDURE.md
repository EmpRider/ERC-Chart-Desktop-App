# Delivery Gate Calibration Procedure

## Preconditions

- Bootstrap PR #1 is merged and the initial rulesets are active.
- The same `EmpRider` identity performs branch creation, commits, pull-request
  authorship, review coordination, and merge through `@GitHub` MCP.
- CodeRabbit, Semgrep, Qodo, and Code Review AI are installed for the repository.
- For an active Qodo trial, record the observed numeric day in `trialDay` and use
  the matching `displayText` form `Day N of 14 · Trial`. For example, day one is
  recorded as `Day 1 of 14 · Trial`.
- For inactive or unavailable Qodo capacity, set `active: false`, omit `trialDay`,
  and record a non-empty explanatory `displayText`.
- `exactEndsOn` remains `null` unless Qodo exposes a trustworthy date.
- No administrator bypass or bypass actor is used.

Qodo and Code Review AI are manual review evidence, not machine-enforced merge conditions.
Only stable pass/fail contexts may be added to GitHub rulesets. The stable
`CodeRabbit` status context is required at both pull-request levels, while manual
comprehensive CodeRabbit review follows the tiered policy below.

## Create Calibration Work

Use Jira epic `ECDD-53` and child task `ECDD-56`. Create the epic branch from
current `main`, then create the task branch from that epic branch. Use only Jira
returned keys in branch names and pull-request bodies.

## Level 1: Task-to-Epic

1. Open the task pull request as a draft.
2. Add a temporary non-production JavaScript fixture containing an obvious injection sink.
3. Mark the pull request ready and record Semgrep blocking behavior and the stable
   `CodeRabbit` status context.
4. Return to draft, remove the unsafe fixture, and commit the safe implementation.
5. Wait for `Delivery gates`, `semgrep-cloud-platform/scan`, and `CodeRabbit` on
   the stable current head.
6. Perform maintainer code review on the stable exact head.
7. Check manual CodeRabbit review capacity once. If quota is available, request
   one comprehensive review and record its findings. If quota is unavailable or
   rate-limited, record that result and continue without waiting or polling.
8. Request Qodo with `/agentic_review` after the machine gates are clear when
   approved capacity is available.
9. Record Qodo login, comment or review representation, referenced head SHA, and
   any actionable finding.
10. Confirm Code Review AI was not intentionally invoked on the task pull request.
11. Confirm an unresolved GitHub conversation blocks merge, then resolve it.
12. Verify the machine-enforced contexts again and squash merge with expected-head
    locking.

Task-to-epic manual comprehensive CodeRabbit review is best-effort. Its absence
because quota is unavailable must not delay merge after maintainer code review,
required statuses, and conversation resolution are clean. Qodo is also observed
manual evidence in this calibration; its absence is not claimed as a ruleset
failure.

## Level 2: Epic-to-Main

1. Open the epic pull request from `epic/ECDD-53-repository-build` to `main`.
2. Confirm all required machine contexts on the current head.
3. Perform maintainer code review on the stable exact head.
4. Request and wait for a fresh comprehensive CodeRabbit review. This manual
   comprehensive review is mandatory for epic-to-main.
5. Request Qodo `/agentic_review` on the stable head when capacity is available.
6. Invoke Code Review AI once after earlier evidence is clear.
7. Record manual provider evidence and resolve conversations the reviews create.
8. Add one harmless reviewable commit to prove earlier current-head statuses are
   no longer current.
9. Rerun affected machine checks, repeat maintainer review, and obtain a fresh
   comprehensive CodeRabbit review before merge; re-observe other manual reviewers
   as appropriate.
10. Merge with a merge commit using expected-head locking.

Do not merge the epic merely to finish task-level calibration. Level 2 runs when
`ECDD-53` is otherwise ready for normal integration.

## Enforcement Tests

Calibration must prove these GitHub-enforced conditions:

- a missing required status blocks merge;
- an out-of-date branch blocks merge until updated and rechecked;
- an unresolved conversation blocks merge;
- a disallowed merge method is unavailable;
- a direct push to `main` or `epic/*` is rejected;
- a non-fast-forward push to `main` or `epic/*` is rejected;
- branch deletion is rejected;
- approval count is zero;
- Code Owner self-approval is not required; and
- bypass lists remain empty.

Calibration must not claim that missing Qodo or Code Review AI evidence causes a
GitHub ruleset failure.

## Evidence Rules

Populate calibration evidence only from real observations. Record stable check
names observed during the previous seven days. Expected required contexts are:

```text
Delivery gates
semgrep-cloud-platform/scan
CodeRabbit
```

Do not guess or normalize a context name. When GitHub emits a different exact
stable name, update both desired-state rulesets and their tests, rerun the suite,
and then edit live rulesets.

Record comment-only and review-only providers as manual review evidence rather
than GitHub approvals or status checks. Their findings can still create review
conversations, and conversation resolution remains machine-enforced. A manually
requested comprehensive CodeRabbit review is optional for task-to-epic when quota
is unavailable and mandatory for epic-to-main.

The Jira evidence comment must include the task PR number, current head SHA,
exact required contexts, Qodo capacity text, manual provider observations, live
ruleset read-back, unresolved-conversation result, branch-freshness result,
approval count, and empty bypass confirmation.

## Completion

Task-level calibration completes after the task pull request is squash merged
into its declared epic branch with expected-head locking, every machine-enforced
condition is current, and maintainer code review is complete. Manual CodeRabbit
and Qodo evidence is recorded when available but is not represented as a GitHub
merge condition at this level.

Epic-level calibration uses the stronger operational boundary: machine contexts
and conversations are enforced by GitHub, while maintainer review and fresh
manual comprehensive CodeRabbit review must both be complete before epic-to-main
merge. Qodo and Code Review AI remain documented manual evidence.
