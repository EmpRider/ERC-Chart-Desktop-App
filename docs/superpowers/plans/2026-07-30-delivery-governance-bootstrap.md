# ERC-chart Delivery Governance Bootstrap Implementation Plan

> **Execution status:** Tasks 1–8 are implemented on
> `bootstrap/delivery-governance`. The bootstrap pull request remains draft until
> current-head checks and required reviews are clear. Repository rules are not
> applied, and product implementation remains blocked, until this pull request is
> merged and the two-level calibration in Task 9 succeeds.

**Goal:** Install and calibrate the repository controls that enforce the approved
task-to-epic and epic-to-main delivery workflow before product implementation
begins.

**Architecture:** A small Node.js governance tool validates branch direction,
pull-request content, repository files, and the later application-script
contract. One GitHub Actions workflow exposes a stable `Delivery gates` result
and conditionally adds application checks only after a root application manifest
exists. Repository rulesets enforce pull requests and independent approval;
CodeRabbit, Semgrep, Qodo, and Code Review AI are calibrated empirically before
their observed evidence is relied upon.

**Tech stack:** Node.js `24.18.1`, npm, Node's built-in test runner, ECMAScript
modules, Ajv `8.20.0`, YAML `2.9.0`, smol-toml `1.7.1`,
markdownlint-cli2 `0.23.2`, GitHub Actions, GitHub repository rulesets,
CodeRabbit, Semgrep, Qodo, and Code Review AI.

## Global Constraints

- The source repository is `EmpRider/ERC-Chart-Desktop-App` and is public.
- `main` is the only permanent branch.
- Task branches match `task/ECDD-<issue-number>-<slug>` and target their declared
  `epic/ECDD-<issue-number>-<slug>` parent only.
- Epic branches match `epic/ECDD-<issue-number>-<slug>` and target `main` only.
- Task pull requests use squash merge; epic pull requests use merge commits.
- Task-to-epic reviews require GitHub Actions, Semgrep, CodeRabbit, independent
  Code Owner approval, and Qodo while the approved trial/capacity rule applies.
- Epic-to-main reviews require GitHub Actions, Semgrep, CodeRabbit, Qodo,
  Code Review AI, and independent Code Owner approval.
- Code Review AI is never intentionally invoked on task pull requests; its
  monthly budget is eight first-pass epic reviews plus two re-reviews.
- Qodo runs only at a stable review point, not on every pushed commit.
- A skipped, summary-only, stale, missing, cancelled, or failed result cannot
  satisfy its corresponding gate.
- Normal coding pull requests must be authored by an identity other than
  `EmpRider`.
- `GITHUB_TOKEN` is read-only in pull-request workflows; only the later release
  publishing job may receive `contents: write`.
- Third-party actions are pinned to complete immutable commit SHAs.
- The root application manifest does not exist yet. Governance CI reports
  application checks as not applicable and never claims an application build
  passed.
- No tag, GitHub Release, installer, checksum, or release workflow is created by
  this bootstrap.
- npm is the only package manager. ECDD-54 absorbs the temporary governance
  lockfile into the root npm workspace lockfile when the application scaffold is
  created.
- No credentials, secrets, generated binaries, installers, or local state enter
  source control.
- Prefer the smallest implementation that meets the approved requirement. Do not
  add speculative extension points, fallbacks, or duplicated policy engines.

## Scope Boundary and Follow-on Work

This plan implements the governance bootstrap, reviewer configuration,
repository settings, rulesets, and calibration procedure. It freezes the command
interface that ECDD-54 and ECDD-56 must supply to the stable CI workflow.

The NSIS build, smoke test, checksum, tag, and GitHub Release workflow belongs to
ECDD-62. Its implementation starts only after ECDD-54 establishes the real root
`package.json`, npm workspace layout, Electron entry points, and electron-builder
configuration. Creating that release workflow during the bootstrap would guess
nonexistent paths or create a false-passing release pipeline.

## File Map

| File | Responsibility |
| --- | --- |
| `tools/delivery-governance/package.json` | Temporary isolated tool manifest and command contract |
| `tools/delivery-governance/package-lock.json` | Reproducible bootstrap dependencies |
| `tools/delivery-governance/src/policy.mjs` | Branch, base, Jira-key, and bootstrap-scope rules |
| `tools/delivery-governance/src/pr-contract.mjs` | Pull-request Markdown contract parsing |
| `tools/delivery-governance/src/repository.mjs` | Repository syntax, links, schemas, secrets, and binaries |
| `tools/delivery-governance/src/application-contract.mjs` | Detect and validate later root application scripts |
| `tools/delivery-governance/src/aggregate.mjs` | Produce the stable aggregate CI verdict |
| `tools/delivery-governance/src/github-admin.mjs` | Dry-run and apply repository settings/rulesets |
| `tools/delivery-governance/src/cli.mjs` | Thin command-line entry point |
| `tools/delivery-governance/test/*.test.mjs` | Table-driven policy and validator tests |
| `.github/pull_request_template.md` | Required Jira, scope, verification, and safety evidence |
| `.github/CODEOWNERS` | Independent owner assignment to `@EmpRider` |
| `.github/workflows/delivery-gates.yml` | Always-present governance and conditional application gates |
| `.github/rulesets/main.json` | Desired-state protection for `main` |
| `.github/rulesets/epic.json` | Desired-state protection for `epic/*` |
| `.coderabbit.yaml` | CodeRabbit review and pre-merge guidance |
| `.pr_agent.toml` | Qodo manual-review and reviewer guidance |
| `.markdownlint-cli2.jsonc` | Repository Markdown rules |
| `.gitignore` | Generated output, local state, and installer exclusions |
| `docs/governance/REVIEW-RUNBOOK.md` | Exact review order, quota policy, and fail-closed decisions |
| `docs/governance/APPLICATION-GATE-CONTRACT.md` | Root scripts required from ECDD-54/ECDD-56/ECDD-62 |
| `docs/governance/CALIBRATION-PROCEDURE.md` | Two-level calibration experiment |
| `docs/governance/calibration-evidence.schema.json` | Machine-readable evidence format |
| `docs/governance/calibration-evidence.json` | Post-merge observed bot identities, checks, and results |

## Task 1: Create the Governance Tool Package

**Status:** Implemented.

The isolated package pins Node.js and every direct dependency. Its command
contract is:

```json
{
  "scripts": {
    "test": "node --test test/*.test.mjs",
    "validate:repository": "node src/cli.mjs repository ../..",
    "validate:pr": "node src/cli.mjs pull-request ../..",
    "lint:markdown": "markdownlint-cli2 \"../../**/*.md\" \"!../../tools/delivery-governance/node_modules/**\""
  }
}
```

The CLI contains argument routing and error rendering only. Policy and validation
logic remains in focused modules.

**Verification:**

```bash
npm ci --prefix tools/delivery-governance --ignore-scripts
npm --prefix tools/delivery-governance test
```

## Task 2: Enforce Branch Direction and Bootstrap Scope

**Status:** Implemented.

The policy uses these branch patterns:

```js
const TASK_BRANCH =
  /^task\/(ECDD-\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EPIC_BRANCH =
  /^epic\/(ECDD-\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BOOTSTRAP_BRANCH = "bootstrap/delivery-governance";
```

The one-time bootstrap exception is restricted to PR #1 and this exact allowlist:

```js
const BOOTSTRAP_PATHS = [
  /^\.coderabbit\.yaml$/,
  /^\.gitignore$/,
  /^\.markdownlint-cli2\.jsonc$/,
  /^\.pr_agent\.toml$/,
  /^\.github\/(?:CODEOWNERS|pull_request_template\.md|workflows\/delivery-gates\.yml|rulesets\/(?:main|epic)\.json)$/,
  /^docs\/governance\//,
  /^docs\/superpowers\/plans\//,
  /^docs\/superpowers\/specs\//,
  /^tools\/delivery-governance\//,
];
```

This prevents the privileged bootstrap branch from changing arbitrary GitHub
workflows or application code while allowing the Markdown policy file required by
Task 4.

The workflow validates both event SHAs with `/^[0-9a-f]{40}$/` before executing:

```bash
git merge-base --is-ancestor "$PR_BASE_SHA" "$PR_HEAD_SHA"
```

Policy errors are returned in deterministic order. Invalid event input is the only
case that throws.

**Verification:**

```bash
node --test tools/delivery-governance/test/policy.test.mjs
```

## Task 3: Define and Validate the Pull-request Contract

**Status:** Implemented.

Every pull-request body must contain one unique level-two section for:

- Jira;
- Acceptance criteria;
- Out of scope;
- Design;
- Verification;
- Performance;
- Dependencies;
- Risk and rollback;
- Screenshots; and
- Security declaration.

The validator preserves fenced code blocks, rejects duplicate headings and
remaining template comments, requires checked acceptance criteria, requires
fenced command output, and requires the checked security declaration.

Jira evidence is branch-specific:

- task-to-epic: `Issue` and `Parent epic` links;
- epic-to-main: one `Epic` link;
- bootstrap PR #1: `Not applicable — one-time bootstrap PR #1`.

**Verification:**

```bash
node --test tools/delivery-governance/test/pr-contract.test.mjs
```

## Task 4: Validate Repository Content Safely

**Status:** Implemented.

The repository validator checks:

- JSON and JSONC syntax;
- all YAML documents;
- TOML syntax;
- checked-in JSON Schema examples;
- relative Markdown links;
- secret-like text without echoing matched values;
- prohibited generated/binary artifacts; and
- excluded dependency, output, and release directories.

The current GitHub credential families are covered explicitly:

```js
const SECRET_PATTERNS = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["github-legacy-token", /\bgh[pour]_[A-Za-z0-9]{30,}\b/],
  ["github-fine-grained-token", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ["github-installation-token", /\bghs_[A-Za-z0-9._-]{36,}\b/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  [
    "quoted-secret-assignment",
    /\b(?:api[_-]?key|client[_-]?secret|password)\s*[:=]\s*["'][^"'\s]{8,}["']/i,
  ],
];
```

Tests cover classic personal tokens, OAuth tokens, GitHub App user tokens,
refresh tokens, fine-grained personal tokens, legacy installation tokens, and
installation-token suffixes containing underscores, dots, and dashes. Fixture
values are constructed at runtime so the validator does not mistake its own test
source for a committed credential:

```js
const tokens = [
  `ghp_${"a".repeat(36)}`,
  `gho_${"b".repeat(36)}`,
  `ghu_${"c".repeat(36)}`,
  `ghr_${"d".repeat(36)}`,
  `github_pat_${"A1_".repeat(12)}`,
  `ghs_${"e".repeat(40)}`,
  `ghs_${"Ab._-".repeat(10)}`,
];
```

Generated output and local state are ignored, while committed `.exe`, `.msi`,
`.dll`, `.pdb`, `.zip`, `.7z`, and `.rar` files outside excluded directories
fail closed.

**Verification:**

```bash
node --test tools/delivery-governance/test/repository.test.mjs
npm --prefix tools/delivery-governance run validate:repository
```

## Task 5: Configure Reviewers Without Spending Limited Quota Early

**Status:** Implemented, pending empirical calibration.

- `CODEOWNERS` assigns all repository paths to `@EmpRider`.
- CodeRabbit uses assertive current-head review, rejects drafts as review passes,
  and evaluates scope alignment, performance safety, and simplicity.
- Qodo automatic push commands are disabled. `/agentic_review` is requested only
  on a stable head.
- Code Review AI has no automatic task-level invocation in repository config.
- Bot comments are evidence, not GitHub approvals.
- Only stable pass/fail contexts observed during calibration are added to active
  branch rules.

**Verification:**

```bash
node --test tools/delivery-governance/test/reviewer-config.test.mjs
```

## Task 6: Add the Stable Delivery Gates Workflow

**Status:** Implemented.

The workflow is named `Delivery gates` and runs on pull requests targeting
`main` or `epic/**`. It uses read-only permissions, immutable action SHAs, and
per-pull-request concurrency.

Jobs:

1. `Governance` installs the locked governance tool, builds safe PR context,
   runs all governance tests, validates the PR contract and repository, and
   detects the application command contract.
2. `Application / Linux` runs only when a root `package.json` exists.
3. `Application / Windows` runs only for an epic-to-main pull request when the
   root application manifest exists.
4. `Delivery gates` aggregates all results and treats missing, failed, cancelled,
   or incorrectly skipped jobs as failures.

While no root application manifest exists, both application jobs are skipped and
the aggregate result explicitly reports them as not applicable.

The future root command contract is:

```text
format:check
lint
typecheck
test:unit
test:integration
build
test:performance
audit:ci
version:check
package:win
smoke:installer
```

**Verification:**

```bash
node --test tools/delivery-governance/test/application-contract.test.mjs
node --test tools/delivery-governance/test/aggregate.test.mjs
```

## Task 7: Define Desired Repository Settings and Protected Branch Rules

**Status:** Desired state implemented; not applied before bootstrap merge.

The administration client is dry-run by default. `--apply` requires an explicit
`ERC_CHART_GITHUB_ADMIN_TOKEN` and stops on the first failed API operation.

Desired repository settings:

- squash and merge commits enabled;
- rebase merge disabled;
- merged head branches deleted;
- default Actions permissions read-only;
- workflows cannot approve pull requests.

Desired rules for `main` and `epic/*` include:

- pull requests required;
- one independent Code Owner approval;
- stale approvals dismissed;
- latest-push approval required;
- all review conversations resolved;
- force pushes and deletion blocked; and
- stable `Delivery gates` required.

The initial rulesets deliberately do not guess Semgrep or AI-reviewer context
names. Those contexts are added only after Task 9 records stable observed names.

**Verification:**

```bash
node --test tools/delivery-governance/test/github-admin.test.mjs
node tools/delivery-governance/src/github-admin.mjs
```

The second command must print dry-run operations and perform no write request.

## Task 8: Add Review, Application, and Calibration Runbooks

**Status:** Implemented.

The review runbook defines:

- deterministic checks before AI review;
- CodeRabbit before Qodo;
- Qodo `/agentic_review` only on a stable head;
- Code Review AI only for epic-to-main;
- eight first-pass plus two re-review monthly allocation;
- invalidation of old evidence after a code commit;
- independent approval requested last;
- no administrator bypass; and
- fail-closed handling when required Qodo epic capacity is unavailable.

The application gate contract maps ownership to:

- ECDD-54 for the root npm workspace, manifest, build, and version contract;
- ECDD-56 for strict formatting, lint, type, test, audit, and performance gates;
- ECDD-62 for Windows packaging, installer smoke tests, checksums, tags, and
  GitHub Release publication.

The calibration procedure and JSON Schema require actual observations rather than
guessed reviewer logins or status contexts.

**Verification:**

```bash
node --test tools/delivery-governance/test/governance-docs.test.mjs
```

## Task 9: Merge, Apply Desired State, and Calibrate Two Pull-request Levels

**Status:** Blocked until bootstrap PR #1 has current required reviews and merges.

### Preconditions

- PR #1 is ready, current-head `Delivery gates` succeeds, and every review thread
  is resolved.
- CodeRabbit performs a comprehensive current-head review rather than a draft
  skip or summary-only response.
- Qodo reviews the stable head and its exact trial end date is recorded from the
  Qodo portal.
- A separate coding GitHub identity is connected; it must not resolve to
  `EmpRider`.
- Semgrep and Code Review AI are installed for the repository.

### Post-merge activation

1. Merge PR #1 only after all required evidence is current.
2. Apply repository settings and the initial desired-state rulesets with the
   administration client.
3. Read back repository settings and both active rulesets.
4. Create one Jira calibration epic and one child task in project `ECDD`.
5. Create the epic branch from current `main` and the task branch from that epic
   using the separate coding identity.

### Level 1: Task-to-epic calibration

1. Open the task pull request as draft.
2. Add a temporary non-production fixture with an obvious injection sink.
3. Mark ready and prove Semgrep blocks while CodeRabbit produces a comprehensive
   review.
4. Return to draft, remove the unsafe fixture, and push one coherent fix commit.
5. Wait for deterministic checks, Semgrep, and CodeRabbit on the new stable head.
6. Request Qodo with `/agentic_review` once.
7. Confirm Code Review AI was not invoked.
8. Obtain current independent approval from `EmpRider` last.
9. Squash merge into the calibration epic.

### Level 2: Epic-to-main calibration

1. Open the calibration epic pull request to `main`.
2. Confirm current-head `Delivery gates`, Semgrep, comprehensive CodeRabbit, and
   Qodo evidence.
3. Invoke Code Review AI once and record one first-pass monthly review consumed.
4. Obtain independent approval, then push a harmless reviewable commit through
   the separate author.
5. Confirm the earlier approval becomes stale.
6. Rerun affected checks/reviewers and obtain fresh independent approval.
7. Prove direct and non-fast-forward pushes to `main` and the calibration epic are
   rejected without bypass.
8. Record stable contexts observed during the previous seven days in
   `calibration-evidence.json`.
9. Add only proven stable required contexts to desired-state rulesets, reapply,
   and verify missing checks, stale approval, unresolved threads, and missing Code
   Owner approval all block merge.
10. Merge the calibration epic with a merge commit.

Product implementation may start only after both calibration levels and active
ruleset readback succeed.

## Current Verification Evidence

The current implementation is validated by the stable workflow on the exact pull
request head. The expected bootstrap result is:

```text
Governance dependency installation: success
Governance tests: 49 passed, 0 failed
Pull-request contract: success
Repository validation: success
Application contract detection: success
Application / Linux: skipped, not applicable because root package.json is absent
Application / Windows: skipped, not applicable because root package.json is absent
Delivery gates aggregate: success
```

Any subsequent code or configuration commit invalidates this evidence and must
produce a new successful current-head run before the pull request is marked ready.

## Completion Boundary

Tasks 1–8 are implementation-complete only when current-head CI passes and all
review findings are addressed. The bootstrap itself is not active until PR #1 is
merged, desired state is applied/read back, and Task 9 calibration succeeds.

No product-code task, installer pipeline, tag, release, or version publication is
started before that boundary.
