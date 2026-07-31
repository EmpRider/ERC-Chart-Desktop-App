# ERC-chart GitHub Delivery Workflow Design

| Field | Value |
| --- | --- |
| Date | 2026-07-30 |
| Updated | 2026-07-31 |
| Status | Approved; solo-maintainer governance active in implementation |
| Repository | `EmpRider/ERC-Chart-Desktop-App` |
| Visibility | Public |
| Jira project | `ECDD` |

## 1. Purpose

This document defines the mandatory development, review, integration,
versioning, build, and release workflow for ERC-chart.

The workflow has four goals:

1. isolate each Jira task from its parent implementation epic;
2. prevent off-scope, slow, unnecessarily complex, or over-engineered code from
   being merged;
3. require current-head automated and AI review evidence at task and epic
   boundaries; and
4. publish the exact Windows installer built from each released `main` commit
   under its matching GitHub Release tag.

The repository is maintained through one GitHub identity, `EmpRider`, including
work performed through `@GitHub` MCP. GitHub cannot count self-approval as an
independent review. The approved solo-maintainer model therefore requires zero
human approvals and replaces that impossible gate with strict current-head
statuses, resolved conversations, merge-method restrictions, and fail-closed AI
review sequencing.

## 2. Related Scope

The first application implementation epic is `ECDD-53`, Repository, build, and
secure desktop shell. Relevant tasks include:

- `ECDD-54`, TypeScript monorepo and package boundaries;
- `ECDD-56`, strict lint, type, test, and delivery gates; and
- `ECDD-62`, NSIS x64 installer pipeline.

The Signal userscript is a behavioral reference only. ERC-chart is implemented
from zero with an architecture appropriate for a modular desktop application.

The MVP includes provider data ingestion and chart, drawing, and indicator
execution. Signal broadcasting is deferred until after the charting foundation.

## 3. Non-Negotiable Engineering Rules

Every pull request must implement the smallest complete solution satisfying one
Jira task or one epic integration objective.

The following are merge-blocking violations:

- behavior outside linked Jira acceptance criteria or approved architecture;
- speculative abstractions, extension points, or fallback paths;
- duplicate implementations or unnecessary layers;
- dependencies without measured correctness or maintenance benefit;
- performance-sensitive changes without relevant measurements;
- hidden deferred features or partially working user-facing controls;
- unrelated refactoring bundled with task delivery;
- tests that do not exercise claimed behavior or failure paths; and
- generated output, credentials, installers, or local state committed to source.

Review must prefer deletion and simplification whenever the simpler solution
satisfies the same requirement.

## 4. Branch Model

### 4.1 Main

`main` is the only permanent integration branch and the source of releases.
Direct changes, deletion, and non-fast-forward updates are blocked.

### 4.2 Epic Branches

Each implementation epic receives one branch created from current `main`:

```text
 epic/ECDD-<epic-number>-<short-kebab-slug>
```

Epic branches receive task work only through task pull requests. Direct and
force pushes are prohibited.

### 4.3 Task Branches

Each Jira child task receives one branch created from its parent epic branch:

```text
 task/ECDD-<task-number>-<short-kebab-slug>
```

A task branch contains only its linked task. Independently reviewable work must
be split into separate Jira tasks and branches.

### 4.4 Allowed Pull-Request Directions

| Head | Required base | Merge method |
| --- | --- | --- |
| `task/ECDD-*` | Declared `epic/ECDD-*` parent | Squash |
| `epic/ECDD-*` | `main` | Merge commit |

Task squash titles use:

```text
ECDD-<task-id>: <imperative summary>
```

Epic pull-request titles use:

```text
ECDD-<epic-id>: merge <epic summary>
```

Rebase merge, task-to-main, epic-to-epic, and unrelated-epic pull requests are
not allowed.

## 5. Pull-Request Contract

Coding work begins in a draft pull request. It becomes ready only after the
implemented head is coherent and its description is complete.

Every pull-request body includes:

- Jira issue and parent epic mapping;
- checked acceptance criteria;
- explicit out-of-scope statement;
- simplest-sufficient design summary;
- exact verification commands and results;
- performance evidence or a concrete non-sensitive explanation;
- dependency justification;
- risk and rollback notes;
- screenshots for visible UI changes; and
- a checked security declaration.

A code or documentation commit invalidates affected review evidence. Passing
claims must refer to the final current head.

## 6. Review Model

Semgrep is a deterministic static-analysis and security gate. CodeRabbit, Qodo,
and Code Review AI are AI review providers.

| Gate | Task to epic, trial | Task to epic, later | Epic to main |
| --- | ---: | ---: | ---: |
| `Delivery gates` | Required | Required | Required, full suite |
| `semgrep-cloud-platform/scan` | Required | Required | Required |
| `CodeRabbit` | Required | Required | Required |
| Qodo `/agentic_review` | Required | Capacity policy | Required |
| Code Review AI | Not invoked | Not invoked | Required once |
| Human approval count | `0` | `0` | `0` |
| Resolved conversations | Required | Required | Required |
| Current target branch | Required | Required | Required |

### 6.1 Stable Ruleset Evidence

The required machine-readable status contexts are exactly:

```text
Delivery gates
semgrep-cloud-platform/scan
CodeRabbit
```

A missing, skipped, cancelled, stale, or failed context blocks merge. Exact
context names are calibrated from a real current-head pull request and are never
guessed or normalized.

Qodo and Code Review AI remain mandatory operational gates when they publish a
review or comment rather than a stable pass/fail status. A bot comment is review
evidence, not a GitHub approval.

### 6.2 Task-to-Epic Sequence

1. Complete deterministic checks on the current head.
2. Wait for Semgrep and comprehensive CodeRabbit review.
3. Resolve every actionable finding and conversation.
4. During approved Qodo capacity, request `/agentic_review` on the stable head.
5. Confirm Code Review AI was not intentionally invoked.
6. Verify all required statuses again and squash merge with a head-SHA lock.

### 6.3 Epic-to-Main Sequence

1. Run the full deterministic and Windows packaging suite that applies.
2. Wait for Semgrep and comprehensive CodeRabbit review.
3. Request Qodo on the stable head.
4. Invoke Code Review AI once after earlier gates are clear.
5. Resolve every actionable finding and conversation.
6. Verify current statuses again and merge with a merge commit and head-SHA lock.

There is no routine administrator bypass.

## 7. Reviewer Identity and Calibration

Solo-maintainer calibration uses the same `EmpRider` identity for branch
creation, commits, pull-request authorship, review coordination, and merge.
`CODEOWNERS` remains `* @EmpRider` for ownership routing, but it is advisory for
self-authored pull requests and is not a merge approval gate.

Calibration must prove:

1. required statuses run for task-to-epic and epic-to-main directions;
2. an obvious injection sink is blocked by Semgrep and reviewed by CodeRabbit;
3. Qodo can review both pull-request levels during active trial capacity;
4. Code Review AI is reserved for epic-to-main;
5. a missing required status blocks merge;
6. an out-of-date branch blocks merge;
7. an unresolved conversation blocks merge;
8. target-specific merge methods are enforced;
9. direct push, deletion, and non-fast-forward updates are rejected; and
10. bypass lists are empty.

The Qodo portal observation is recorded exactly as `Day 1 of 14 · Trial`.
`exactEndsOn` remains `null` when the portal does not expose a trustworthy date.

## 8. Review Capacity

Code Review AI is reserved for epic-to-main. Its monthly operating budget is
eight first-pass epic reviews plus two re-reviews. A calibration invocation
counts against the same allowance.

Qodo is required for both pull-request levels while the current 14-day trial is
active. After trial capacity ends, task-level use follows a reviewed capacity
policy. Epic-to-main remains fail-closed unless a paid, qualified open-source, or
newly approved replacement policy exists.

A capacity problem never creates an undocumented reviewer downgrade.

## 9. Automated Reviewer Configuration

### 9.1 CodeRabbit

`.coderabbit.yaml` enables assertive, comprehensive, current-head review for
`main` and `epic/*`. It prioritizes correctness, scope alignment, performance,
and simplicity. Draft-skip or summary-only output does not satisfy the operational
review requirement.

### 9.2 Semgrep

Semgrep runs for both pull-request directions. Blocking policies fail newly
introduced high- or critical-severity findings and applicable verified-secret
findings. False positives are triaged through Semgrep rather than bypassing
repository protection.

### 9.3 Qodo

`.pr_agent.toml` disables per-push automatic feedback. `/agentic_review` is
requested manually only after the head is stable and earlier gates are clear.

### 9.4 Code Review AI

Code Review AI is invoked only on epic-to-main after deterministic, Semgrep,
CodeRabbit, and Qodo evidence is clear.

## 10. GitHub Actions

Repository workflow permissions are read-only by default. Pull-request jobs
receive only the permissions they require. Release publishing is the only path
that receives `contents: write`.

The stable `Delivery gates` result validates:

- branch direction and Jira mapping;
- pull-request contract;
- governance tests;
- JSON, JSON Schema, YAML, TOML, and Markdown structure;
- repository links, secrets, and prohibited artifacts; and
- application commands when the root application manifest exists.

Before the application scaffold exists, application jobs report not applicable.
They must not claim an application build passed.

After Epic 1 introduces the root npm workspace, the same aggregate includes:

- locked dependency installation;
- format, lint, and strict TypeScript checking;
- unit, integration, and performance tests;
- production build and audit; and
- Windows packaging and installer smoke tests for epic-to-main.

Required workflows do not use path filters that leave expected checks pending.

## 11. Repository Rulesets

Two active rulesets are maintained as desired-state JSON:

- `ERC main` targets `refs/heads/main` and permits merge commits only.
- `ERC epic branches` targets `refs/heads/epic/*` and permits squash only.

Both rulesets require:

- pull requests;
- zero approving reviews;
- no Code Owner review requirement;
- no last-push approval requirement;
- resolved review conversations;
- strict branch freshness;
- `Delivery gates`, `semgrep-cloud-platform/scan`, and `CodeRabbit`;
- blocked deletion and non-fast-forward updates; and
- empty bypass lists.

Repository merge settings enable squash and merge commits, disable rebase merge,
and delete merged head branches.

## 12. Version Policy

ERC-chart uses Semantic Versioning. Application versions omit a leading `v`; Git
tags include it.

| Milestone | Version | Tag |
| --- | ---: | ---: |
| Epic 1 packaged shell | `0.1.0` | `v0.1.0` |
| Epic 2 | `0.2.0` | `v0.2.0` |
| Epic 3 | `0.3.0` | `v0.3.0` |
| Epic 4 | `0.4.0` | `v0.4.0` |
| Epic 5 | `0.5.0` | `v0.5.0` |
| Epic 6 | `0.6.0` | `v0.6.0` |
| Epic 7 | `0.7.0` | `v0.7.0` |
| Epic 8 | `0.8.0` | `v0.8.0` |
| Epic 9 MVP | `1.0.0` | `v1.0.0` |

Corrective releases increment the patch version. A released version or tag is
never reused or moved.

## 13. Release Workflow

Release automation is introduced by `ECDD-62` and runs only after a reviewed
version-changing epic merge reaches `main`.

The release job:

1. checks out the exact merged commit;
2. validates the application version and unused tag;
3. installs locked dependencies on Windows;
4. runs the complete quality, security, packaging, and smoke-test suite;
5. creates a SHA-256 checksum;
6. creates a draft release targeting the tested commit;
7. uploads the installer and checksum; and
8. publishes only after both assets exist.

Published assets are:

```text
ERC-Chart-Setup-X.Y.Z.exe
ERC-Chart-Setup-X.Y.Z.exe.sha256
```

A documentation-only merge before the application scaffold creates no tag or
release.

## 14. Release Failure Behavior

- A failed test, build, package, smoke test, or checksum creates no published
  release.
- A draft release created before an upload failure remains draft and is retried
  against the same commit and version.
- A failed release is never repaired by moving a tag.
- A version collision fails closed and requires a reviewed version change.
- Release secrets are unavailable to pull-request jobs.

## 15. Acceptance Criteria

The workflow is accepted only when:

- branch hierarchy and source/target policy are enforced;
- task PRs require current Delivery gates, Semgrep, CodeRabbit, Qodo during the
  trial, and resolved conversations;
- epic PRs additionally require Qodo and Code Review AI evidence;
- approval count is zero and no self-approval is claimed;
- stale status or an out-of-date head blocks merge;
- direct push, deletion, and non-fast-forward updates are blocked;
- task-to-epic is squash-only and epic-to-main is merge-commit-only;
- bypass lists remain empty;
- Code Review AI quota reserves are preserved;
- no pre-application documentation merge creates a release;
- each release builds the exact merged commit; and
- every published release contains the matching installer and checksum.
