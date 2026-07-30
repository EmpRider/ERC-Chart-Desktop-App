# ERC-chart GitHub Delivery Workflow Design

| Field | Value |
| --- | --- |
| Date | 2026-07-30 |
| Status | Approved by product owner; implementation planning active |
| Repository | `EmpRider/ERC-Chart-Desktop-App` |
| Visibility | Public |
| Jira project | `ECDD` |

## 1. Purpose

This document defines the mandatory development, review, integration, versioning,
build, and release workflow for ERC-chart.

The workflow has four goals:

1. isolate each Jira task from its parent implementation epic;
2. prevent off-scope, slow, unnecessarily complex, or over-engineered code from
   being merged;
3. require quota-aware automated and independent review at both task and epic
   boundaries;
4. publish the exact Windows installer built from each released `main` commit
   under its matching GitHub Release tag.

This workflow is part of the project definition of done. It applies to application
code, tests, build scripts, GitHub configuration, and architecture-affecting
changes.

## 2. Related project scope

The first application implementation epic is
[ECDD-53 — Repository, build, and secure desktop shell][ecdd-53].
Its relevant existing tasks include:

- [ECDD-54 — Create TypeScript monorepo and package boundaries][ecdd-54];
- [ECDD-56 — Configure strict lint, type, and test gates][ecdd-56]; and
- [ECDD-62 — Build the NSIS x64 installer pipeline][ecdd-62].

[ecdd-53]: https://erc-chart.atlassian.net/browse/ECDD-53
[ecdd-54]: https://erc-chart.atlassian.net/browse/ECDD-54
[ecdd-56]: https://erc-chart.atlassian.net/browse/ECDD-56
[ecdd-62]: https://erc-chart.atlassian.net/browse/ECDD-62

The delivery-governance configuration is established before normal implementation
begins. Executable build and release jobs become active only when Epic 1 introduces
the application scaffold and a working NSIS package command. A documentation-only
commit made before that point must not create a version tag or empty release.

## 3. Non-negotiable engineering rules

Every pull request must implement the smallest complete solution that satisfies
one Jira task or one epic integration objective.

The following are merge-blocking violations:

- behavior outside the linked Jira acceptance criteria or approved architecture;
- speculative abstractions, extension points, configuration, or fallback paths
  without a current requirement;
- duplicate implementations or unnecessary architectural layers;
- dependencies that replace a small, clear local implementation without a
  measured maintenance or correctness benefit;
- performance-sensitive changes without relevant measurements;
- hidden deferred features or partially working user-facing controls;
- unrelated refactoring bundled with task delivery;
- tests that do not exercise the claimed behavior or failure path;
- generated output, credentials, secrets, installers, or local state committed to
  source control.

Reviewers must prefer deletion and simplification when both the simpler and more
complex solutions satisfy the same requirement.

## 4. Branch model

### 4.1 Permanent branch

`main` is the only permanent integration branch and the source of all release
builds. It must remain releasable after the Epic 1 packaging pipeline becomes
active.

### 4.2 Epic branches

Each implementation epic receives one branch created from the current `main`
after its declared predecessor has merged:

```text
epic/ECDD-<epic-issue-number>-<short-kebab-slug>
```

Example:

```text
epic/ECDD-53-repository-build-secure-shell
```

An epic branch may receive changes only through task pull requests. Direct and
force pushes are prohibited.

### 4.3 Task branches

Each Jira child task receives one branch created from its parent epic branch:

```text
task/ECDD-<task-issue-number>-<short-kebab-slug>
```

Examples:

```text
task/ECDD-54-typescript-monorepo
task/ECDD-56-strict-quality-gates
task/ECDD-62-nsis-installer-pipeline
```

A task branch contains only the linked task. If a reviewer can accept one portion
and reject another independently, the work must be split into separate Jira tasks
and task branches.

### 4.4 Allowed pull-request directions

| Head branch | Required base branch | Merge method |
| --- | --- | --- |
| `task/ECDD-*` | Its declared `epic/ECDD-*` parent | Squash |
| `epic/ECDD-*` | `main` | Merge commit |

The policy check rejects:

- task-to-`main` pull requests;
- task-to-unrelated-epic pull requests;
- epic-to-epic pull requests;
- an epic branch created from an outdated or unrelated base;
- branches without a valid `ECDD-*` identifier.

Task squash commits use the format:

```text
ECDD-<task-id>: <imperative summary>
```

Epic merge commits use the format:

```text
ECDD-<epic-id>: merge <epic summary>
```

Merged task and epic branches are deleted after the merge is verified.

### 4.5 Bootstrap exception

The repository predates these controls. One bootstrap pull request may target
`main` from `bootstrap/delivery-governance` to install the policy itself. It may
contain only governance documentation, pull-request templates, review
configuration, branch-policy validation, and repository settings.

After that pull request merges, the bootstrap branch is deleted and no second
bootstrap exception is permitted.

## 5. Pull-request contract

The coding agent opens every task pull request as a draft. The pull request is
converted to ready for review only after local checks pass and its description is
complete.

Every pull request description must include:

- Jira task key and link;
- parent Jira epic key and link;
- exact acceptance criteria implemented;
- explicit out-of-scope statement;
- design summary focused on why the solution is the simplest sufficient option;
- test commands and results;
- performance evidence, or a concrete explanation of why the changed path is not
  performance-sensitive;
- dependency additions with justification;
- risk and rollback notes;
- screenshots only when user-visible behavior changed;
- a checked declaration that no secrets or generated binaries are included.

The policy job validates the branch direction, required Jira fields, and pull
request structure. It does not attempt to replace Jira with duplicated GitHub
state.

## 6. Mandatory review loop

### 6.1 Reviewer allocation

Semgrep is a deterministic static-analysis and security gate, not one of the three
AI review agents. The three AI review agents are CodeRabbit, Qodo, and Code Review
AI.

| Gate | Task → epic (trial) | Task → epic (later) | Epic → `main` |
| --- | ---: | ---: | ---: |
| GitHub Actions quality gates | Required | Required | Required, full suite |
| Semgrep | Required | Required | Required |
| CodeRabbit | Required | Required | Required |
| Qodo | Required | Conditional | Required |
| Code Review AI | Not run | Not run | Required |
| Independent Code Owner review | Required | Required | Required |

The public repository is eligible for CodeRabbit's public-repository review
entitlement. That eligibility is not treated as active until calibration proves
that CodeRabbit performs a comprehensive review rather than only a summary or a
draft-skip status. Code Review AI is reserved exclusively for epic-to-`main` pull
requests because its free plan permits up to ten code reviews per month.

Qodo is required for both pull-request levels while the current 14-day trial is
active. When the trial ends, task-to-epic pull requests return to the post-trial
column unless the repository owner explicitly confirms sufficient continued Qodo
capacity. Public repository visibility does not by itself extend the Qodo trial:
continued access requires a paid plan or acceptance into Qodo's qualified
open-source program. Qodo remains part of the approved epic-to-`main` gate. If
continued access is not established, epic merges fail closed until the owner
approves a governance change; the workflow must not silently omit Qodo.

### 6.2 Review sequence and quota protection

1. The coding agent pushes a complete change and marks the draft pull request
   ready.
2. GitHub Actions and Semgrep run all applicable deterministic checks.
3. CodeRabbit performs its review and evaluates three explicit blocking concerns:
   - scope and architecture alignment;
   - performance safety;
   - simplicity and absence of over-engineering.
4. The coding agent fixes all failing checks and actionable CodeRabbit findings
   before a quota-limited reviewer is invoked.
5. Qodo is invoked against the stable head commit for every epic-to-`main` pull
   request and, during the 14-day trial, for every task-to-epic pull request.
   Per-push Qodo reviews are disabled; a new review is requested only after a
   coherent fix round is ready.
6. The coding agent fixes all actionable Qodo findings and reruns affected
   deterministic checks.
7. For epic-to-`main` only, Code Review AI is invoked after GitHub Actions,
   Semgrep, CodeRabbit, and Qodo are clear. This prevents its monthly quota from
   being spent on draft work or early fix iterations.
8. Any code change made after a Qodo or Code Review AI review invalidates that
   review for merge purposes. The affected reviewer must assess the new head
   commit.
9. The independent approver reviews the complete diff, current-head review
   evidence, test results, measurements, and unresolved conversations.
10. The independent approver submits `APPROVE` only when every applicable gate is
    satisfied; otherwise the approver submits `REQUEST_CHANGES`.
11. The pull request is merged only after approvals are current, every required
    reviewer has completed a current-head review, all blocking checks pass, and
    all actionable conversations are resolved.

Code Review AI's monthly operational budget is eight first-pass epic reviews plus
two reserved re-reviews. If a ninth first-pass epic review would consume the
reserve, that merge waits for quota availability or an explicit policy change.
Any calibration review counts against the same ten-review allowance and reduces
that month's first-pass capacity before the reserve is touched.
Code Review AI must never be intentionally invoked on task-to-epic pull requests.

There is no review-round limit. A pull request remains unmergeable until it passes.
There is no routine bypass for administrators.

## 7. Reviewer identity and calibration

The connected independent-review identity is `EmpRider`. GitHub does not count a
pull-request author's approval of their own pull request. Therefore normal coding
pull requests must be authored by a separate GitHub App or machine-user identity.

Before the first product-code task is accepted, a calibration pull request must
prove all of the following:

1. the coding-agent pull-request author is not `EmpRider`;
2. CodeRabbit performs comprehensive reviews, rather than summary-only or skipped
   reviews, for pull requests targeting both `main` and `epic/*`;
3. the Semgrep scan runs for both pull-request directions and a blocking test
   finding fails its check;
4. Qodo can review task-to-epic and epic-to-`main` pull requests during the trial,
   and its review can be tied to the current head commit;
5. Code Review AI can be restricted to epic-to-`main` pull requests or invoked
   manually without consuming quota on task-to-epic pull requests;
6. unresolved actionable findings from every applicable reviewer prevent approval;
7. `EmpRider` can submit a counted independent approval after automated reviews;
8. pushing a new reviewable commit dismisses prior approvals and invalidates old
   review evidence; and
9. direct pushes to `main` and `epic/*` are rejected.

If the coding agent uses `EmpRider`, the calibration fails and product code must
not merge until a separate author identity is connected. A written review comment
from the assistant is useful evidence but is not represented as a formal GitHub
approval in that condition.

Exact GitHub check names and bot identities are recorded from calibration output;
they are never guessed when configuring required checks.

## 8. Automated reviewer and scanner configuration

### 8.1 CodeRabbit

The repository-root `.coderabbit.yaml` must:

- enable `request_changes_workflow`;
- enable automatic incremental review;
- exclude drafts from blocking review;
- include `epic/.*` as additional base branches;
- provide repository-wide review instructions that prioritize correctness,
  performance, scope discipline, and the simplest sufficient implementation;
- enable linked-issue assessment;
- configure scope alignment, performance safety, and simplicity checks as errors
  when the connected CodeRabbit plan supports custom pre-merge checks;
- prevent a pull-request author from overriding a failed pre-merge check.

CodeRabbit custom pre-merge checks currently require a qualifying paid plan. The
calibration pull request, not the presence of YAML alone, is the proof that the
three blocking checks are active. If those checks are unavailable, CodeRabbit's
request-changes review remains required, but the repository must not claim that
three distinct automated pre-merge checks are enforced.

The latest draft governance pull-request feedback reports CodeRabbit's
`Pro Plus` plan, but it also states `Review skipped` because the pull request is
still a draft. Its successful status therefore confirms the entitlement refresh,
not a comprehensive review pass. A ready calibration pull request must still
prove comprehensive review behavior and the availability of configured
pre-merge checks before product code proceeds.

### 8.2 Semgrep

Semgrep runs on task-to-epic and epic-to-`main` pull requests. Its diff-aware scan
is a required check, and policies designated as Block fail the pull request. The
initial policy prioritizes newly introduced high- or critical-severity code
findings plus verified-secret findings when that Semgrep capability is enabled;
lower-confidence findings remain visible for triage without creating an
unreviewable noise gate. The independent secret-like-content check remains active
regardless of the connected Semgrep product set.

The exact Semgrep check name is captured from the calibration pull request before
it is added to a ruleset. A missing, cancelled, or failed required Semgrep result
blocks the merge. A false positive is resolved through documented Semgrep triage,
not by bypassing branch protection.

### 8.3 Qodo

The repository-root `.pr_agent.toml` supplies Qodo with the same scope,
performance, correctness, and simplicity instructions used by the other
reviewers. Qodo runs in manual or ready-for-review mode rather than on every push.
The `/agentic_review` command is used when an explicit current-head review is
required.

During the 14-day trial, Qodo reviews pull requests targeting `epic/*` and `main`.
After the trial, task-to-epic automatic review can be excluded with Qodo's target
branch filtering while epic-to-`main` review is retained. The transition is a
reviewed governance configuration change; it is not an undocumented manual
bypass. Before the trial expires, the repository owner must either activate a
paid Qodo plan, obtain acceptance into Qodo's open-source program, or accept that
epic-to-`main` merges will pause pending a newly approved reviewer policy.

### 8.4 Code Review AI

Code Review AI is installed for this single repository and is reserved for
epic-to-`main` review. Its current free Marketplace plan permits up to ten code
reviews per month. Provider settings or a supported manual trigger must prevent
task-to-epic pull requests from consuming that allowance.

Calibration must prove the scoping behavior before Code Review AI is treated as
an enforceable epic gate. If the app automatically spends reviews on task pull
requests and offers no usable scope control, the quota strategy is not accepted;
the integration must be reconfigured before product-code pull requests proceed.

### 8.5 Enforcement evidence

Some review apps may publish comments instead of a stable pass/fail check or a
counted GitHub approval. Branch rules require only check names that calibration
proves stable. Regardless of API representation, the independent Code Owner must
verify that every reviewer required by the matrix completed a review of the
current head commit and that all actionable findings are resolved.

## 9. GitHub Actions design

### 9.1 Workflow permissions

The repository default `GITHUB_TOKEN` permission is read-only. Pull-request jobs
receive only the permissions they require. Only the release-publish job receives
`contents: write`.

Third-party actions are pinned to immutable commit SHAs after their licenses and
maintainers are reviewed. Workflows must not execute untrusted pull-request code
with a write token.

### 9.2 Governance checks available before application scaffolding

The bootstrap workflow provides one stable required check and always runs for
pull requests targeting `main` or `epic/**`.

It validates:

- legal head/base branch direction;
- required Jira and acceptance fields in the pull-request body;
- Markdown structure and internal links;
- JSON and JSON Schema syntax plus checked-in schema examples;
- secret-like content and prohibited binary files;
- workflow and review-configuration syntax.

The check reports application build gates as not applicable while no root
application manifest exists. It must not report that an application build passed.

### 9.3 Application quality checks

When Epic 1 introduces the root application manifest and lockfile, the same stable
required check automatically includes:

- clean locked dependency installation;
- format verification;
- lint;
- strict TypeScript type-check;
- unit and integration tests;
- production build;
- applicable deterministic performance tests;
- dependency/security audit;
- Windows packaging validation for epic-to-`main` pull requests.

ECDD-54 establishes npm workspaces, a committed `package-lock.json`, and the
project's pinned Node version. CI uses `npm ci`; it does not introduce an
additional package manager or duplicate lockfile.

The root package scripts are the single command contract used locally and in CI.
GitHub workflow files orchestrate those scripts and do not duplicate build logic.

### 9.4 Task and epic scope

Task-to-epic pull requests run the checks relevant to the changed task, but the
stable required job always concludes after aggregating every applicable result.
Epic-to-`main` pull requests run the complete suite on Windows, including NSIS
packaging and installer smoke validation.

Required workflows must not use path filters that leave an expected required check
in a permanently pending state.

### 9.5 Concurrency and artifacts

Pull-request runs cancel an older run for the same pull request. Release runs are
serialized and are never cancelled after publishing begins.

Unreleased CI installers are short-lived workflow artifacts and are clearly named
as test builds. They are not GitHub Releases.

## 10. Repository rules

Two active branch rulesets are required. Both `main` and `epic/*` require:

- a pull request and current approvals;
- Code Owner approval;
- dismissal of stale approvals;
- approval of the latest push by another actor;
- resolution of all actionable conversations; and
- blocked force pushes and deletion.

The `main` ruleset additionally requires the full CI and Semgrep checks plus all
epic-level reviewer evidence. The `epic/*` ruleset requires task-level CI,
Semgrep, CodeRabbit, and Qodo evidence while the trial-period rule applies.

`CODEOWNERS` assigns repository content to `@EmpRider`, so the independent approval
is explicit. GitHub's numeric approval count is set only after calibration proves
which bots submit counted approvals. Review completion requirements from
Section 6 still apply when a reviewer publishes comments instead of a counted
approval.

Routine bypass lists are empty. Merge queue, rebase merge, release branches, and
long-lived development branches are excluded because the expected repository
traffic does not justify them.

Repository merge settings retain squash merge and merge commits, disable rebase
merge, and delete head branches after merge.

## 11. Version policy

ERC-chart uses Semantic Versioning without a leading `v` in the application
manifest and with a leading `v` in Git tags.

| Milestone | Application version | Git tag |
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
| Post-MVP Epic 10 | `1.1.0` | `v1.1.0` |
| Post-MVP Epic 11 | `1.2.0` | `v1.2.0` |
| Post-MVP Epic 12 | `1.3.0` | `v1.3.0` |

A corrective release with no new epic capability increments the patch version.
No version is reused and no existing release tag is moved to a different commit.

Every epic-to-`main` pull request from Epic 1 onward updates the application
version and changelog. The version gate rejects a value that is not greater than
the latest release or does not match the declared milestone.

## 12. Release workflow

Release automation is introduced by ECDD-62. Its event is a push to `main`, with
no path filter. Before doing build work, it verifies that the application manifest
exists and that its version has no matching release tag. A pre-Epic-1 commit or a
merge that does not introduce a new version exits successfully with an explicit
"no release required" result. Because the bootstrap exception is one-time and all
later `main` changes arrive through epic pull requests, a new application version
is published only from a reviewed epic merge.

The release job:

1. checks out the exact merged `main` commit;
2. reads and validates the application version;
3. verifies that the matching `vX.Y.Z` tag and release do not already exist;
4. installs locked dependencies on the `windows-2025` GitHub-hosted runner;
5. runs the complete quality, security, and Windows packaging gates;
6. performs installer smoke validation;
7. verifies the installer product version and expected filename;
8. creates a SHA-256 checksum;
9. creates a draft GitHub Release targeting the exact tested commit;
10. uploads the installer and checksum;
11. publishes the release only after both assets are present.

The published assets are exactly:

```text
ERC-Chart-Setup-X.Y.Z.exe
ERC-Chart-Setup-X.Y.Z.exe.sha256
```

The release title and tag are `vX.Y.Z`. Release notes identify the Jira epic,
included task pull requests, user-visible changes, known limitations, and whether
the executable is signed.

The release process does not publish `latest.yml` or enable automatic updates,
because automatic updates are outside the MVP.

## 13. Release failure behavior

- A failed test, build, package, smoke test, or checksum step creates no tag and
  no release.
- If publication fails after a draft release is created, the release remains a
  draft and is retried against the same commit and version.
- A failed release is never repaired by moving an existing tag.
- A version collision fails closed and requires a new reviewed version change.
- Missing code-signing credentials produce an explicitly unsigned pre-MVP build;
  the MVP signing decision remains governed by open decision OD-005.
- Release secrets are stored only as GitHub Actions secrets or environment
  secrets and are never available to pull-request jobs.

## 14. Validation strategy

Before the governance bootstrap is considered active:

1. validate all YAML, JSON, and JSON Schema files locally;
2. run table-driven policy tests for allowed and rejected branch pairs;
3. verify the pull-request template produces all required fields;
4. open the calibration pull request and exercise deliberate CodeRabbit and
   Semgrep findings;
5. confirm Qodo reviews both pull-request levels while its trial is active;
6. prove Code Review AI is restricted to epic-to-`main` review and record one
   quota-consuming calibration review;
7. confirm both branch rulesets block missing approvals, missing checks, direct
   pushes, and unresolved conversations;
8. inspect the check names and bot review types produced by GitHub before making
   them required; and
9. confirm that a documentation-only merge creates no release.

Before the first `v0.1.0` release:

1. run the complete release workflow in non-publishing mode;
2. download and smoke-test the generated NSIS installer;
3. verify the installer and checksum filenames and contents;
4. merge the reviewed Epic 1 pull request;
5. verify that the release tag targets the tested merge commit;
6. download the `.exe` from the GitHub Release page and verify its SHA-256 value.

## 15. Acceptance criteria

The delivery workflow is accepted only when:

- the branch hierarchy and source/target policy are enforced;
- task-to-epic pull requests cannot merge without current CodeRabbit, Semgrep,
  independent approval, and Qodo while the trial rule applies;
- epic-to-`main` pull requests cannot merge without current CodeRabbit, Semgrep,
  Qodo, Code Review AI, and independent review evidence;
- a CodeRabbit summary or skipped-review success status cannot satisfy the
  CodeRabbit gate;
- Code Review AI is not intentionally consumed by task-to-epic pull requests and
  its two-review monthly reserve is preserved;
- stale approvals are dismissed after new code is pushed;
- simplicity, scope alignment, and performance are explicit blocking review
  concerns;
- direct and force pushes to `main` and `epic/*` are blocked;
- deterministic CI checks run on every protected-branch pull request;
- no pre-Epic-1 documentation change creates an application release;
- Epic 1 and later epic merges build the exact merge commit;
- a failed build produces no published release;
- each successful release page contains its matching `.exe` and `.sha256` assets;
- the release tag is immutable and points to the tested commit.

## 16. Current external references

- GitHub protected branches:
  <https://docs.github.com/en/repositories/configuring-branches-and-merges/in-your-repository/managing-protected-branches/about-protected-branches>
- GitHub repository rulesets:
  <https://docs.github.com/en/repositories/configuring-branches-and-merges/in-your-repository/managing-rulesets/creating-rulesets-for-a-repository>
- GitHub Actions workflow syntax:
  <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax>
- GitHub Actions token permissions:
  <https://docs.github.com/en/actions/reference/authentication-in-a-workflow>
- GitHub CLI release creation:
  <https://cli.github.com/manual/gh_release_create>
- CodeRabbit configuration:
  <https://docs.coderabbit.ai/reference/configuration>
- CodeRabbit automatic review:
  <https://docs.coderabbit.ai/configuration/auto-review>
- CodeRabbit pre-merge checks:
  <https://docs.coderabbit.ai/pr-reviews/pre-merge-checks>
- CodeRabbit public-repository pricing:
  <https://www.coderabbit.ai/pricing>
- Semgrep pull-request comments and blocking policies:
  <https://semgrep.dev/docs/semgrep-appsec-platform/github-pr-comments>
- Qodo review triggers:
  <https://docs.qodo.ai/code-review/use-qodo-in-prs>
- Qodo branch filtering:
  <https://docs.qodo.ai/code-review/get-started/configuration-overview/configuration-and-command-reference>
- Qodo repository configuration:
  <https://docs.qodo.ai/install-and-configure/configuration-overview/configuration-file>
- Qodo trial and post-trial usage:
  <https://docs.qodo.ai/pricing-and-usage>
- Code Review AI Marketplace plan:
  <https://github.com/marketplace/code-review-ai>
