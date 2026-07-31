# Delivery Gate Calibration Procedure

## Preconditions

- Bootstrap PR #1 is merged and the initial rulesets are active.
- The same `EmpRider` identity performs branch creation, commits, pull-request
  authorship, review coordination, and merge through `@GitHub` MCP.
- CodeRabbit, Semgrep, Qodo, and Code Review AI are installed for the repository.
- The Qodo portal observation is recorded exactly as `Day 1 of 14 · Trial`.
- `exactEndsOn` remains `null` unless Qodo exposes a trustworthy date.
- No administrator bypass or bypass actor is used.

## Create Calibration Work

Use the existing Jira epic `ECDD-53` and child task `ECDD-56` for this governance
calibration. Create the epic branch from current `main`, then create the task
branch from that epic branch. Use only the Jira-returned issue keys in branch
names and pull-request bodies.

## Level 1: Task-to-Epic

1. Open the task pull request as a draft.
2. Add a temporary non-production JavaScript fixture containing an obvious injection sink.
3. Mark the pull request ready and record that Semgrep blocks the fixture and
   CodeRabbit performs a comprehensive review.
4. Return the pull request to draft, remove the unsafe fixture, and commit the
   safe governance implementation.
5. Wait for `Delivery gates`, `semgrep-cloud-platform/scan`, and `CodeRabbit` on
   the new stable head.
6. Request Qodo with `/agentic_review` only after the earlier gates are clear.
7. Record Qodo login, representation, reviewed head SHA, and actionable state.
8. Confirm Code Review AI was not invoked on the task pull request.
9. Create or retain one review thread and confirm the unresolved conversation
   blocks merge.
10. Resolve the thread, verify every required context again, and squash merge.

Any code or documentation fix creates a new head and invalidates affected
review evidence. Return to step 5 after each fix.

## Level 2: Epic-to-Main

1. Open the epic pull request from `epic/ECDD-53-repository-build` to `main`.
2. Confirm all three required contexts on the current head.
3. Request Qodo `/agentic_review` on the stable head.
4. Invoke Code Review AI once after all earlier gates are clear.
5. Add one harmless reviewable commit to the epic branch.
6. Confirm the earlier required contexts are no longer current for the new head.
7. Rerun affected checks and reviewers and resolve all conversations.
8. Merge with a merge commit using a freshly verified expected head SHA.

Do not merge the epic merely to finish task-level calibration. Level 2 runs when
`ECDD-53` is otherwise ready for normal epic integration.

## Enforcement Tests

The calibration must prove each of the following without a second identity:

- a missing required status blocks merge;
- an out-of-date branch blocks merge until updated and rechecked;
- an unresolved conversation blocks merge;
- a disallowed merge method is unavailable;
- a direct push to `main` or `epic/*` is rejected;
- a non-fast-forward push to `main` or `epic/*` is rejected;
- branch deletion is rejected;
- approval count is zero;
- Code Owner self-approval is not required;
- bypass lists remain empty.

## Evidence Rules

Populate calibration evidence only from real observations. Record stable check
names observed during the previous seven days. The expected required contexts
are:

```text
Delivery gates
semgrep-cloud-platform/scan
CodeRabbit
```

Do not guess or normalize a context name. When GitHub emits a different exact
stable name, update both desired-state rulesets and their tests, rerun the full
suite, and then edit the live rulesets.

Record comment-only and review-only providers as operational evidence rather than
pretending they are GitHub approvals or stable status checks.

The Jira evidence comment must include the task PR number, current head SHA,
exact required contexts, Qodo capacity text, live ruleset read-back,
unresolved-conversation result, branch-freshness result, approval count, and
empty bypass confirmation.

## Completion

Task-level calibration completes only after the task pull request is squash
merged into its declared epic branch with a head-SHA lock. Epic-level calibration
remains fail-closed until the normal `ECDD-53` epic-to-main pull request passes
Qodo, Code Review AI, current required statuses, resolved conversations, and
merge-commit-only enforcement.
