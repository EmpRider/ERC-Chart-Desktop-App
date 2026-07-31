# Solo-Maintainer Review Governance Design

## Amendment Status

This document is the approved solo-maintainer amendment to
`2026-07-30-github-delivery-workflow-design.md`.

It supersedes only the independent-author and independent-approval requirements
in Sections 6, 7, 10, 14, and 15 of that design. All branch, application gate,
performance, version, installer, release, release-failure, quota, and no-bypass
rules in the original design remain unchanged.

## Context

The repository is developed, reviewed, and merged through one authenticated
GitHub identity, `EmpRider`, including all work performed through the GitHub MCP
connector. GitHub cannot treat the pull-request author as an independent
approving reviewer, so mandatory Code Owner and last-push approval rules make the
approved MCP-only workflow impossible.

This amendment replaces independent human approval with strict current-head
automated evidence while preserving fail-closed merge controls. It does not
convert comment-only AI reviewers into unreliable required status checks.

## Goals

- Permit `EmpRider` to author and merge pull requests without a second GitHub
  user.
- Keep direct deletion, force push, stale-head merge, and
  unresolved-conversation protections.
- Require deterministic and security checks on the current pull-request head.
- Require CodeRabbit as a stable GitHub status check.
- Keep Qodo and Code Review AI mandatory at the appropriate review level through
  the operational runbook when they do not emit stable pass/fail contexts.
- Preserve task-to-epic squash merges and epic-to-main merge commits.
- Preserve the original version and release policy without modification.

## Non-Goals

- Parsing AI review comment text inside a custom workflow.
- Treating bot comments or summary reviews as GitHub approvals.
- Creating an administrator bypass.
- Weakening Semgrep severity handling or deterministic validation.
- Changing product code, application gates, installer behavior, or release
  policy.

## Enforcement Model

### GitHub Rulesets

Both `ERC main` and `ERC epic branches` remain active with empty bypass lists.

The pull-request rule changes to:

- required approving review count: `0`;
- Code Owner review: not required;
- last-push approval: not required;
- stale review dismissal: enabled where supported;
- all review conversations must be resolved; and
- target-specific merge method remains unchanged.

The required status checks become:

- `Delivery gates`;
- `semgrep-cloud-platform/scan`; and
- `CodeRabbit`.

Strict required-status policy remains enabled so the pull-request branch must be
current with its target before merge. A status is required only after its exact
stable context has been observed on a current-head pull request.

### Runbook Reviews

GitHub rulesets enforce only stable machine-readable pass/fail contexts. The
review runbook enforces providers that are comment-only or review-only.

Task-to-epic during active Qodo trial capacity:

1. `Delivery gates` passes on the current head.
2. Semgrep passes with no new blocking finding.
3. CodeRabbit reports success and all actionable findings are resolved.
4. Qodo `/agentic_review` assesses the stable current head.
5. All GitHub review conversations are resolved.
6. The pull request is squash merged with expected-head locking.

Epic-to-main:

1. `Delivery gates`, Semgrep, and CodeRabbit pass on the current head.
2. Qodo `/agentic_review` assesses the stable current head.
3. Code Review AI is invoked once after earlier gates are clear.
4. All actionable findings and review conversations are resolved.
5. The pull request is merged with a merge commit and expected-head locking.

Any code or documentation commit invalidates affected current-head evidence. The
applicable checks and AI reviews must run again before merge.

## Components to Change

- `.github/rulesets/main.json`: remove mandatory human approval and add calibrated
  stable status contexts.
- `.github/rulesets/epic.json`: apply equivalent solo-maintainer rules for
  task-to-epic pull requests.
- `docs/governance/REVIEW-RUNBOOK.md`: replace independent approval steps with
  current-head evidence rules.
- `docs/governance/CALIBRATION-PROCEDURE.md`: replace separate-author approval
  tests with required-status, stale-branch, unresolved-thread, and merge-method
  tests.
- `tools/delivery-governance` tests: verify zero approvals, no Code Owner
  requirement, empty bypass lists, exact contexts, and unchanged merge methods.
- Calibration evidence: remove the separate coding identity and independent
  approver fields.

## Calibration Sequence

1. Keep existing rulesets active while preparing the governance pull request.
2. Observe exact current-head status names from a real task pull request.
3. Record the stable Semgrep, Delivery gates, and CodeRabbit contexts.
4. Update desired-state JSON and tests with exact observed names.
5. Edit the live rulesets without removing status, conversation, merge-method,
   deletion, non-fast-forward, or empty-bypass protections.
6. Merge the governance task pull request only after current-head deterministic
   and AI evidence is clear.
7. Validate the epic-to-main sequence when `ECDD-53` is ready for normal
   integration.
8. Reconcile final desired-state rulesets and read them back from GitHub.
9. Test that missing status, stale branch state, unresolved conversation, wrong
   merge method, deletion, and non-fast-forward updates are blocked.

## Failure Handling

- Unknown or unstable context: do not add it to a ruleset.
- Missing required check: do not merge.
- New blocking Semgrep finding: do not merge.
- Actionable AI finding: fix it or record a reviewed rejection with rationale.
- Evidence from an older head: rerun it.
- Unresolved conversation: do not merge.
- Ruleset mismatch after application: stop, correct the desired state, reapply,
  and read it back.
- Required Qodo epic capacity unavailable: fail closed according to review
  capacity policy.

## Verification

Automated tests must prove:

- both rulesets require zero approvals;
- neither ruleset requires Code Owner or last-push approval;
- bypass actor lists remain empty;
- `Delivery gates`, `semgrep-cloud-platform/scan`, and `CodeRabbit` are required
  with strict branch freshness;
- main permits merge commits only;
- epic branches permit squash merges only;
- deletion and non-fast-forward updates remain blocked; and
- repository and pull-request validators still pass.

Live calibration must prove:

- the sole maintainer can merge after all required evidence is current;
- a missing required status blocks merge;
- an out-of-date branch blocks merge;
- an unresolved conversation blocks merge;
- a disallowed merge method is unavailable;
- deletion and non-fast-forward updates remain rejected; and
- Qodo and Code Review AI are invoked only at documented stages.

## Rollback

Rollback uses a reviewed prior desired-state ruleset with no administrator bypass.
If solo-maintainer enforcement is unsafe or incomplete, disable merging, restore
the previous desired-state JSON, reapply both rulesets, and verify live state
before allowing further product work.
