# Solo-Maintainer Review Governance Design

## Amendment Status

This document amends `2026-07-30-github-delivery-workflow-design.md` only where
that design requires an independent author or independent approval.

All branch, application gate, performance, version, installer, release,
release-failure, quota, and no-bypass rules remain unchanged. In particular, the
original version and release policy remains unchanged.

## Context

The repository is developed and merged through one authenticated GitHub identity,
`EmpRider`, including work performed through GitHub MCP. GitHub cannot count the
pull-request author as an independent approving reviewer, so Code Owner and
latest-push approval requirements make the MCP-only workflow impossible.

The replacement must distinguish what GitHub can enforce from what the maintainer
can only observe manually. A comment-only provider cannot truthfully be described
as a required status check.

## Goals

- Permit `EmpRider` to author and merge without a second GitHub user.
- Preserve deletion, non-fast-forward, stale-head, conversation, and merge-method
  protections.
- Require deterministic and security checks on the current pull-request head.
- Require CodeRabbit only through its observed stable status context.
- Continue requesting Qodo and Code Review AI at the documented stages as manual
  review evidence.
- Preserve the original application, installer, version, and release contracts.

## Non-Goals

- Parsing AI comment text inside a custom workflow.
- Inventing a provider status context that has not been observed.
- Treating bot comments as GitHub approvals.
- Claiming that manual evidence is a GitHub-enforced merge blocker.
- Creating an administrator bypass.
- Changing product code or release behavior.

## Enforcement Model

### GitHub-Enforced Merge Conditions

Both active rulesets keep empty bypass lists and require:

- zero approving reviews;
- no Code Owner review;
- no latest-push approval;
- resolved review conversations;
- strict branch freshness;
- blocked deletion and non-fast-forward updates; and
- target-specific merge methods.

Required status contexts are exactly:

```text
Delivery gates
semgrep-cloud-platform/scan
CodeRabbit
```

These are the GitHub-enforced merge conditions. Missing, stale, cancelled, or
failed evidence blocks merge.

### Manual Reviewer Evidence

GitHub rulesets do not receive a stable pass/fail context from Qodo or Code Review
AI under the observed integration. Their comments and review threads are manual,
non-blocking evidence. This design does not claim that Qodo or Code Review AI
blocks a GitHub merge.

The operational sequence still requests:

- Qodo `/agentic_review` on stable task and epic heads while capacity is
  available; and
- Code Review AI once on epic-to-main after earlier evidence is clear.

The maintainer considers their findings and resolves any GitHub conversations
created by them. Conversation resolution remains enforceable even though provider
invocation itself is not.

A provider may become a required status later only after calibration proves an
exact, stable, current-head pass/fail context and a reviewed governance change
adds it to the rulesets and tests.

## Components

- `.github/rulesets/main.json`: zero human approvals plus exact stable contexts.
- `.github/rulesets/epic.json`: equivalent task-to-epic enforcement with squash
  merge only.
- `docs/governance/REVIEW-RUNBOOK.md`: separates the machine contract from manual
  provider evidence.
- `docs/governance/CALIBRATION-PROCEDURE.md`: tests only conditions GitHub can
  enforce and records Qodo/Code Review AI as observations.
- Governance tests: verify exact contexts, empty bypass lists, zero approvals,
  conversation resolution, and unchanged merge methods.
- Calibration evidence: binds observations to task and epic head SHAs.

## Calibration

1. Observe exact current-head status names on a real pull request.
2. Add only stable pass/fail contexts to desired-state rulesets.
3. Test missing status, stale branch, unresolved conversation, wrong merge method,
   deletion, and non-fast-forward rejection.
4. Record Qodo and Code Review AI login, representation, head reference, and
   findings as manual evidence.
5. Apply live rulesets and read them back before relying on enforcement.
6. Do not infer enforcement from checked-in JSON or from runbook language.

## Failure Handling

- Unknown or unstable context: do not add it to a ruleset.
- Missing required status: do not merge.
- Rate-limited or summary-only CodeRabbit result: do not treat it as a
  comprehensive operational review even when a status is green.
- Actionable manual AI finding: fix it or record a reasoned rejection.
- Unresolved conversation: do not merge.
- Ruleset mismatch after application: stop, correct, reapply, and read back.
- Qodo or Code Review AI unavailable: record the absence honestly; do not claim a
  GitHub ruleset failure.

## Verification

Automated tests prove:

- approval count is zero;
- Code Owner and latest-push approval are disabled;
- bypass lists are empty;
- exact required status contexts are present with strict freshness;
- main permits merge commits only;
- epic branches permit squash only;
- deletion and non-fast-forward updates remain blocked; and
- repository and pull-request validators pass.

Live calibration proves the machine-enforced merge contract and separately records
manual provider evidence. The two evidence classes are never conflated.

## Rollback

Rollback restores a previously reviewed desired state, reapplies both rulesets,
and reads back live state. Administrator bypass is not part of rollback.
