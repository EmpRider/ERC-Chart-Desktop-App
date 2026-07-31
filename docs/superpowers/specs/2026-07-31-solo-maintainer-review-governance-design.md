# Solo-Maintainer Review Governance Design

## Context

The repository is developed, reviewed, and merged through one authenticated GitHub identity, `EmpRider`, including all work performed through the GitHub MCP connector. GitHub cannot treat the pull-request author as an independent approving reviewer, so the existing mandatory Code Owner and last-push approval rules make the approved MCP-only workflow impossible.

This design replaces independent human approval with strict, current-head automated evidence while preserving fail-closed merge controls. It does not attempt to convert comment-only AI reviewers into unreliable required status checks.

## Goals

- Permit `EmpRider` to author and merge pull requests without a second GitHub user.
- Keep direct deletion, force push, stale-head merge, and unresolved-conversation protections.
- Require deterministic and security checks on the current pull-request head.
- Require CodeRabbit as a stable GitHub status check.
- Keep Qodo and Code Review AI mandatory at the appropriate review level through the operational runbook when they do not emit stable pass/fail status contexts.
- Preserve task-to-epic squash merges and epic-to-main merge commits.

## Non-Goals

- Parsing AI review comment text inside a custom workflow.
- Treating bot comments or summary reviews as GitHub approvals.
- Creating an administrator bypass.
- Weakening Semgrep severity handling or deterministic validation.
- Changing product code, application gates, installer behavior, or release policy.

## Enforcement Model

### GitHub Rulesets

Both `ERC main` and `ERC epic branches` remain active with empty bypass lists.

The pull-request rule changes to:

- required approving review count: `0`;
- Code Owner review: not required;
- last-push approval: not required;
- stale review dismissal: enabled where supported, but no approval is required;
- all review conversations must be resolved;
- target-specific merge method remains unchanged.

The required status checks become:

- `Delivery gates`;
- the observed Semgrep stable status context recorded by calibration;
- `CodeRabbit`.

Strict required-status-check policy remains enabled so the pull-request branch must be current with its target before merge. A status is required only after its exact stable context has been observed on a current-head pull request. The desired-state JSON must not guess the Semgrep context name.

### Runbook Reviews

GitHub rulesets enforce only stable machine-readable pass/fail contexts. The review runbook enforces providers that are comment-only or review-only:

Task-to-epic during the active Qodo trial:

1. `Delivery gates` passes on the current head.
2. Semgrep passes with no new high or critical finding.
3. CodeRabbit reports success and all actionable findings are resolved.
4. Qodo `/agentic_review` is requested on the stable head and has no unresolved actionable finding.
5. All GitHub review conversations are resolved.
6. The pull request is squash merged.

Epic-to-main:

1. `Delivery gates`, Semgrep, and CodeRabbit pass on the current head.
2. Qodo `/agentic_review` completes on the stable head with no unresolved actionable finding.
3. Code Review AI is invoked once after the earlier gates are clear.
4. All actionable findings and review conversations are resolved.
5. The pull request is merged with a merge commit.

Any code commit invalidates earlier review evidence. The affected checks and AI reviews must be rerun before merge.

## Components to Change

- `.github/rulesets/main.json`: remove mandatory human approval and add calibrated stable status contexts.
- `.github/rulesets/epic.json`: apply the equivalent solo-maintainer rules for task-to-epic pull requests.
- `docs/governance/REVIEW-RUNBOOK.md`: replace independent approval steps with solo-maintainer current-head evidence rules.
- `docs/governance/CALIBRATION-PROCEDURE.md`: replace separate-author approval tests with automated-gate, stale-status, unresolved-thread, and merge-method enforcement tests.
- `tools/delivery-governance` tests: verify zero required approvals, no Code Owner requirement, empty bypass lists, exact required contexts, and unchanged merge methods.
- Governance documentation and calibration evidence schema where they currently require an independent coding identity or approval.

## Calibration Sequence

1. Keep the existing rulesets active while preparing the governance pull request.
2. Observe exact current-head status names from a real task pull request.
3. Record the stable Semgrep context; retain `Delivery gates` and `CodeRabbit` only when their exact contexts are confirmed.
4. Update desired-state JSON and tests with the observed names.
5. Temporarily edit the live rulesets through the GitHub UI to remove the impossible approval requirement while retaining existing required checks, unresolved-thread protection, merge-method restrictions, deletion protection, force-push protection, and empty bypass lists.
6. Merge the governance task pull request into its epic only after current-head automated and AI review evidence is clear.
7. Open the epic-to-main pull request and validate the epic review sequence.
8. Import or reconcile the final desired-state rulesets and read them back from GitHub.
9. Test that missing required status, stale branch state, unresolved conversation, wrong merge method, direct deletion, and force push are blocked.

## Failure Handling

- Unknown or unstable status context: do not add it to a ruleset; retain it as a runbook requirement.
- Missing required check: do not merge.
- New high or critical Semgrep finding: do not merge.
- Actionable AI review finding: fix it or record a reviewed rejection with rationale before proceeding.
- Review evidence from an older head: rerun it.
- Unresolved conversation: do not merge.
- Ruleset mismatch after import: stop, correct the desired state, re-import, and read back again.
- Provider outage or exhausted required Qodo epic capacity: fail closed according to the review-capacity policy.

## Verification

Automated tests must prove:

- both rulesets require zero approvals;
- neither ruleset requires Code Owner or last-push approval;
- bypass actor lists remain empty;
- `Delivery gates`, calibrated Semgrep, and `CodeRabbit` are required with strict branch freshness;
- main permits merge commits only;
- epic branches permit squash merges only;
- deletion and non-fast-forward updates remain blocked;
- repository and pull-request validators still pass.

Live calibration must prove:

- the sole maintainer can merge after all required evidence is current;
- a missing required status blocks merge;
- an out-of-date branch blocks merge;
- an unresolved conversation blocks merge;
- a disallowed merge method is unavailable;
- direct deletion and force push remain rejected;
- Qodo and Code Review AI are invoked only at their documented stages.

## Rollback

Rollback uses a reviewed prior desired-state ruleset with no administrator bypass. If solo-maintainer enforcement is unsafe or incomplete, disable merging, restore the previous desired-state JSON, re-import both rulesets, and verify the live configuration before allowing further product work.
