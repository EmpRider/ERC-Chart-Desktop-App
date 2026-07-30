# ERC-chart Delivery Governance Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

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

**Tech Stack:** Node.js `24.18.1`, npm, Node's built-in test runner, ECMAScript
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
  Code Owner approval, and Qodo while the trial rule applies.
- Epic-to-main reviews require GitHub Actions, Semgrep, CodeRabbit, Qodo,
  Code Review AI, and independent Code Owner approval.
- Code Review AI is never intentionally invoked on task pull requests; its
  monthly budget is eight first-pass epic reviews plus two re-reviews.
- Qodo runs at a stable review point, not on every pushed commit.
- A skipped, summary-only, stale, missing, cancelled, or failed result cannot
  satisfy its corresponding gate.
- Normal coding pull requests must be authored by an identity other than
  `EmpRider`.
- `GITHUB_TOKEN` is read-only in pull-request workflows; only the later release
  publishing job may receive `contents: write`.
- Third-party actions are pinned to complete immutable commit SHAs.
- The root application manifest does not exist yet. Governance CI must report
  application checks as not applicable and must not claim an application build
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

---

## Scope Boundary and Follow-on Work

This plan implements the governance bootstrap, reviewer configuration,
repository settings, rulesets, and calibration. It also freezes the command
interface that ECDD-54 and ECDD-56 must supply to the stable CI workflow.

The NSIS build, smoke test, checksum, tag, and GitHub Release workflow belongs to
ECDD-62. Its implementation plan is written only after ECDD-54 has established
the real root `package.json`, npm workspace layout, Electron entry points, and
electron-builder configuration. Creating that release workflow now would either
guess nonexistent paths or produce a false-passing release pipeline.

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
| `docs/governance/calibration-evidence.json` | Observed bot identities, check names, and results |

### Task 1: Create the Governance Tool Package

**Files:**

- Create: `tools/delivery-governance/package.json`
- Create: `tools/delivery-governance/package-lock.json`
- Create: `tools/delivery-governance/src/cli.mjs`
- Create: `tools/delivery-governance/test/package.test.mjs`

**Interfaces:**

- Consumes: Node.js `24.18.1`.
- Produces: npm commands `test`, `validate:repository`, `validate:pr`, and
  `lint:markdown`; CLI commands `repository`, `pull-request`,
  `application-contract`, and `aggregate`.

- [ ] **Step 1: Write the package-contract test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("governance package pins its runtime and commands", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(packageJson.private, true);
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.engines.node, "24.18.1");
  assert.deepEqual(Object.keys(packageJson.scripts).sort(), [
    "lint:markdown",
    "test",
    "validate:pr",
    "validate:repository",
  ]);
});
```

- [ ] **Step 2: Run the test and confirm the package is absent**

Run:

```bash
node --test tools/delivery-governance/test/package.test.mjs
```

Expected: failure with `ENOENT` for
`tools/delivery-governance/package.json`.

- [ ] **Step 3: Add the exact package manifest**

```json
{
  "name": "@erc-chart/delivery-governance",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": "24.18.1"
  },
  "scripts": {
    "test": "node --test test/*.test.mjs",
    "validate:repository": "node src/cli.mjs repository ../..",
    "validate:pr": "node src/cli.mjs pull-request ../..",
    "lint:markdown": "markdownlint-cli2 \"../../**/*.md\" \"!../../tools/delivery-governance/node_modules/**\""
  },
  "dependencies": {
    "ajv": "8.20.0",
    "smol-toml": "1.7.1",
    "yaml": "2.9.0"
  },
  "devDependencies": {
    "markdownlint-cli2": "0.23.2"
  }
}
```

`src/cli.mjs` must contain only argument routing and error rendering. Business
rules remain in focused modules:

```js
const handlers = new Map([
  ["repository", validateRepositoryCommand],
  ["pull-request", validatePullRequestCommand],
  ["application-contract", validateApplicationContractCommand],
  ["aggregate", aggregateCommand],
]);
```

- [ ] **Step 4: Generate the reproducible lockfile without lifecycle scripts**

Run:

```bash
npm install --prefix tools/delivery-governance --package-lock-only --ignore-scripts
npm ci --prefix tools/delivery-governance --ignore-scripts
```

Expected: both commands exit `0`; `package-lock.json` contains only the pinned
governance dependency graph.

- [ ] **Step 5: Run the package test**

Run:

```bash
npm --prefix tools/delivery-governance test
```

Expected: `package.test.mjs` passes.

- [ ] **Step 6: Commit**

```bash
git add tools/delivery-governance
git commit -m "build: add delivery governance tool"
```

### Task 2: Enforce Branch Direction and Bootstrap Scope

**Files:**

- Create: `tools/delivery-governance/src/policy.mjs`
- Create: `tools/delivery-governance/test/policy.test.mjs`

**Interfaces:**

- Consumes:
  `PullRequestContext { number, title, head, base, baseSha, headSha,
  baseIsAncestor, body, changedFiles }`.
- Produces:
  `validateBranchPolicy(context): string[]` and
  `extractBranchIssueKey(branch): string | null`.

- [ ] **Step 1: Write table-driven failing tests**

```js
const cases = [
  {
    name: "accepts a task targeting its declared epic",
    context: taskContext({
      head: "task/ECDD-54-typescript-monorepo",
      base: "epic/ECDD-53-repository-build-secure-shell",
      issue: "ECDD-54",
      parent: "ECDD-53",
    }),
    errors: [],
  },
  {
    name: "rejects a task targeting main",
    context: taskContext({
      head: "task/ECDD-54-typescript-monorepo",
      base: "main",
      issue: "ECDD-54",
      parent: "ECDD-53",
    }),
    errors: ["Task branches must target their declared epic branch."],
  },
  {
    name: "accepts an epic targeting main",
    context: epicContext("epic/ECDD-53-repository-build-secure-shell"),
    errors: [],
  },
  {
    name: "rejects an epic targeting another epic",
    context: {
      ...epicContext("epic/ECDD-53-repository-build-secure-shell"),
      base: "epic/ECDD-40-architecture",
    },
    errors: ["Epic branches must target main."],
  },
  {
    name: "accepts only PR 1 as the bootstrap exception",
    context: bootstrapContext({ number: 1 }),
    errors: [],
  },
  {
    name: "rejects a second bootstrap pull request",
    context: bootstrapContext({ number: 2 }),
    errors: ["The delivery-governance bootstrap exception is restricted to PR 1."],
  },
];
```

Add separate tests proving that a task's issue key matches its head branch, its
parent epic key matches the base branch, malformed branch names fail, and the
bootstrap changed-file allowlist rejects application source or binaries. Test
that `baseIsAncestor: false` rejects a branch created from an unrelated or
outdated base. Test task titles such as
`ECDD-54: create TypeScript monorepo boundaries` and epic titles such as
`ECDD-53: merge repository build and secure shell`; reject a title whose Jira key
or merge form does not match its head branch.

- [ ] **Step 2: Confirm the tests fail**

Run:

```bash
node --test tools/delivery-governance/test/policy.test.mjs
```

Expected: failure because `policy.mjs` does not exist.

- [ ] **Step 3: Implement the minimal pure policy functions**

Use these exact patterns:

```js
const TASK_BRANCH =
  /^task\/(ECDD-\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EPIC_BRANCH =
  /^epic\/(ECDD-\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BOOTSTRAP_BRANCH = "bootstrap/delivery-governance";

const BOOTSTRAP_PATHS = [
  /^\.coderabbit\.yaml$/,
  /^\.gitignore$/,
  /^\.pr_agent\.toml$/,
  /^\.github\//,
  /^docs\/governance\//,
  /^docs\/superpowers\/plans\//,
  /^docs\/superpowers\/specs\//,
  /^tools\/delivery-governance\//,
];
```

Return every violation in deterministic order. Do not throw for user-created
policy errors; throw only when the event input cannot be parsed.

The workflow computes ancestry without executing user-controlled text as a shell
command:

```bash
git merge-base --is-ancestor "$PR_BASE_SHA" "$PR_HEAD_SHA"
```

Both values come from the GitHub event and must first match `/^[0-9a-f]{40}$/`.

- [ ] **Step 4: Run the focused tests**

Run:

```bash
node --test tools/delivery-governance/test/policy.test.mjs
```

Expected: all allowed and rejected branch cases pass.

- [ ] **Step 5: Commit**

```bash
git add tools/delivery-governance/src/policy.mjs tools/delivery-governance/test/policy.test.mjs
git commit -m "test: enforce delivery branch policy"
```

### Task 3: Define and Validate the Pull-request Contract

**Files:**

- Create: `.github/pull_request_template.md`
- Create: `tools/delivery-governance/src/pr-contract.mjs`
- Create: `tools/delivery-governance/test/pr-contract.test.mjs`

**Interfaces:**

- Consumes: pull-request body Markdown and head/base branch context.
- Produces:
  `parsePullRequestBody(markdown): PullRequestEvidence` and
  `validatePullRequestBody(markdown, context): string[]`.

- [ ] **Step 1: Write tests for every required section**

The valid fixture must contain:

````markdown
## Jira

- Issue: [ECDD-54](https://erc-chart.atlassian.net/browse/ECDD-54)
- Parent epic: [ECDD-53](https://erc-chart.atlassian.net/browse/ECDD-53)

## Acceptance criteria

- [x] The TypeScript monorepo boundaries are created.

## Out of scope

Electron process implementation is excluded from this task.

## Design

The change adds only the package boundaries required by ECDD-54.

## Verification

```text
npm test
PASS
```

## Performance

Not performance-sensitive: this change adds repository metadata only.

## Dependencies

No runtime dependency added.

## Risk and rollback

Revert the squash commit to restore the prior repository structure.

## Screenshots

Not applicable; no user-visible UI changed.

## Security declaration

- [x] No secrets, credentials, installers, generated binaries, or local state are included.
````

Tests must reject each missing heading, an unchecked acceptance criterion,
remaining HTML template comments, a branch/Jira mismatch, missing command output,
and an unchecked security declaration.

- [ ] **Step 2: Confirm tests fail**

Run:

```bash
node --test tools/delivery-governance/test/pr-contract.test.mjs
```

Expected: failure because the parser is absent.

- [ ] **Step 3: Implement a deterministic heading parser**

```js
export const REQUIRED_SECTIONS = [
  "Jira",
  "Acceptance criteria",
  "Out of scope",
  "Design",
  "Verification",
  "Performance",
  "Dependencies",
  "Risk and rollback",
  "Screenshots",
  "Security declaration",
];

export function parsePullRequestBody(markdown) {
  // Split only on level-two headings, preserve fenced blocks, and return one
  // trimmed value per unique required heading.
}
```

The implementation must reject duplicate required headings and use the exact Jira
URL prefix `https://erc-chart.atlassian.net/browse/`.

- [ ] **Step 4: Add the pull-request template**

Use the valid fixture's headings and declarations. Replace the concrete issue,
acceptance criterion, design, and evidence text with HTML instructions that the
validator requires the author to remove. Keep the security declaration unchecked
in the template.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test tools/delivery-governance/test/pr-contract.test.mjs
```

Expected: all contract cases pass.

- [ ] **Step 6: Commit**

```bash
git add .github/pull_request_template.md tools/delivery-governance/src/pr-contract.mjs tools/delivery-governance/test/pr-contract.test.mjs
git commit -m "feat: enforce pull request evidence"
```

### Task 4: Validate Repository Content Safely

**Files:**

- Create: `tools/delivery-governance/src/repository.mjs`
- Create: `tools/delivery-governance/test/repository.test.mjs`
- Create: `.markdownlint-cli2.jsonc`
- Create: `.gitignore`

**Interfaces:**

- Consumes: repository root path.
- Produces: `validateRepository(root): Promise<string[]>`.

- [ ] **Step 1: Write failing tests with temporary repositories**

Use `mkdtemp` and create isolated cases proving:

- valid Markdown, YAML, TOML, JSON, JSON Schema, and schema examples pass;
- a broken relative Markdown link fails;
- malformed `.github/workflows/*.yml` fails;
- malformed `.pr_agent.toml` fails;
- invalid JSON fails;
- `sample-workspace.json` failing `workspace.schema.json` fails;
- a PEM private-key header fails;
- GitHub token, AWS access key, and quoted password assignment patterns fail;
- `.exe`, `.msi`, `.dll`, `.pdb`, `.zip`, `.7z`, and `.rar` fail;
- `.git`, `node_modules`, `coverage`, `dist`, `out`, and `release` are not
  traversed.

- [ ] **Step 2: Confirm tests fail**

Run:

```bash
node --test tools/delivery-governance/test/repository.test.mjs
```

Expected: failure because `repository.mjs` is absent.

- [ ] **Step 3: Implement the focused validators**

Use the following exported boundary:

```js
export async function validateRepository(root) {
  return [
    ...(await validateStructuredFiles(root)),
    ...(await validateSchemaExamples(root)),
    ...(await validateMarkdownLinks(root)),
    ...(await validateTrackedContent(root)),
  ];
}
```

Parse YAML with `parseAllDocuments`, TOML with `parse`, and JSON with
`JSON.parse`. Validate the contract examples with `Ajv2020`:

```js
const SCHEMA_EXAMPLES = [
  [
    "docs/architecture/v1/contracts/plugin-manifest.schema.json",
    "docs/architecture/v1/examples/binomo-provider.plugin.json",
  ],
  [
    "docs/architecture/v1/contracts/workspace.schema.json",
    "docs/architecture/v1/examples/sample-workspace.json",
  ],
];
```

Scan text for these narrow, reviewable patterns:

```js
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:api[_-]?key|client[_-]?secret|password)\s*[:=]\s*["'][^"'\s]{8,}["']/i,
];
```

The scanner reports relative path, rule name, and line number without echoing the
matched secret value.

- [ ] **Step 4: Add Markdown and generated-output policy**

`.markdownlint-cli2.jsonc` must enable default rules, disable line-length
enforcement, and require fenced-code languages. `.gitignore` must include:

```gitignore
node_modules/
coverage/
dist/
out/
release/
*.exe
*.msi
*.dll
*.pdb
*.zip
*.7z
*.rar
*.log
*.local
.env
.env.*
```

- [ ] **Step 5: Run repository tests and the real repository validation**

Run:

```bash
npm --prefix tools/delivery-governance test
npm --prefix tools/delivery-governance run lint:markdown
npm --prefix tools/delivery-governance run validate:repository
```

Expected: all commands exit `0`; no application build is attempted.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .markdownlint-cli2.jsonc tools/delivery-governance
git commit -m "feat: validate governance repository content"
```

### Task 5: Configure Reviewers and Code Ownership

**Files:**

- Create: `.github/CODEOWNERS`
- Create: `.coderabbit.yaml`
- Create: `.pr_agent.toml`
- Create: `tools/delivery-governance/test/reviewer-config.test.mjs`

**Interfaces:**

- Consumes: approved reviewer matrix.
- Produces: parseable reviewer configuration with current-head manual Qodo
  reviews and automatic non-draft CodeRabbit reviews.

- [ ] **Step 1: Write configuration tests**

Assert:

- `CODEOWNERS` assigns all paths to `@EmpRider`;
- CodeRabbit ignores drafts, reviews `epic/.*`, performs incremental review,
  enables request-changes workflow, and defines the three approved custom checks;
- the pull-request author cannot override failed CodeRabbit custom checks;
- Qodo push review is disabled;
- Qodo publishes only action-required findings inline;
- Code Review AI is not configured as an automatic task-PR command.

- [ ] **Step 2: Confirm tests fail**

Run:

```bash
node --test tools/delivery-governance/test/reviewer-config.test.mjs
```

Expected: failure because the configuration files are absent.

- [ ] **Step 3: Add Code Ownership**

```text
* @EmpRider
```

- [ ] **Step 4: Add CodeRabbit configuration**

```yaml
language: en-US
early_access: false
reviews:
  profile: assertive
  request_changes_workflow: true
  high_level_summary: true
  review_status: true
  review_details: true
  auto_review:
    enabled: true
    drafts: false
    auto_incremental_review: true
    base_branches:
      - "^epic/.*$"
  path_filters:
    - "!**/dist/**"
    - "!**/out/**"
    - "!**/release/**"
    - "!**/coverage/**"
  path_instructions:
    - path: "**/*"
      instructions: |
        Verify the linked Jira acceptance criteria and approved architecture.
        Block behavior outside scope, correctness defects, unmeasured
        performance-sensitive changes, unnecessary dependencies, speculative
        abstractions, duplicate layers, and avoidable complexity. Prefer the
        smallest complete solution. Verify failure-path tests and ensure no
        deferred feature is exposed as partially working UI.
  pre_merge_checks:
    override_requested_reviewers_only: true
    title:
      mode: error
      requirements: |
        Task PR titles must use "ECDD-N: imperative summary". Epic PR titles
        must use "ECDD-N: merge epic summary". N must match the head branch.
    issue_assessment:
      mode: error
    custom_checks:
      - name: Scope alignment
        mode: error
        instructions: |
          Pass only when every changed behavior is required by the linked Jira
          acceptance criteria or approved architecture and unrelated refactoring
          is absent.
      - name: Performance safety
        mode: error
        instructions: |
          Pass when changed performance-sensitive paths include relevant,
          reproducible measurements and do not regress their declared budget.
          Pass non-performance-sensitive changes only when the PR explains why.
      - name: Simplicity
        mode: error
        instructions: |
          Pass only when no smaller clear implementation satisfies the same
          requirement and the change contains no speculative abstraction,
          duplicate layer, unnecessary dependency, or unused extension point.
chat:
  auto_reply: false
```

Calibration, not the presence of these keys, determines whether the connected
CodeRabbit entitlement enforces custom pre-merge checks.

- [ ] **Step 5: Add Qodo configuration**

```toml
[config]
disable_auto_feedback = true

[github_app]
handle_push_trigger = false
pr_commands = []
push_commands = []

[review_agent]
comments_location_policy = "both"
inline_comments_severity_threshold = 3
issues_user_guidelines = """
Verify correctness, the linked Jira acceptance criteria, failure paths, and the
approved ERC-chart architecture. Treat behavior outside scope as actionable.
"""
compliance_user_guidelines = """
Prefer the smallest complete implementation. Flag speculative abstractions,
duplicate layers, unnecessary dependencies, unrelated refactoring, missing
performance evidence, hidden deferred features, and untested failure paths.
"""
```

The runbook invokes Qodo with `/agentic_review` only after deterministic checks
and CodeRabbit findings are clear on the stable head commit.

- [ ] **Step 6: Run configuration and repository validation**

Before running calibration, configure the installed Semgrep project for
diff-aware pull-request scanning of this repository. New high- and
critical-severity code findings are blocking; verified-secret findings are
blocking when that Semgrep capability is available. Lower-confidence findings
remain visible without becoming a noise gate. Keep the independent repository
secret scanner active regardless of Semgrep product capabilities.

In the Code Review AI installation settings, select `main` as the target branch
or manual invocation when either option is supported. If the provider
automatically consumes a review on a task-to-epic pull request and exposes no
scope control, calibration fails and normal product pull requests remain paused.

Run:

```bash
npm --prefix tools/delivery-governance test
npm --prefix tools/delivery-governance run validate:repository
```

Expected: YAML and TOML parse, reviewer assertions pass, and no review provider is
invoked locally.

- [ ] **Step 7: Commit**

```bash
git add .github/CODEOWNERS .coderabbit.yaml .pr_agent.toml tools/delivery-governance/test/reviewer-config.test.mjs
git commit -m "ci: configure automated code reviewers"
```

### Task 6: Add the Stable Delivery-gates Workflow

**Files:**

- Create: `.github/workflows/delivery-gates.yml`
- Create: `tools/delivery-governance/src/application-contract.mjs`
- Create: `tools/delivery-governance/src/aggregate.mjs`
- Create: `tools/delivery-governance/test/application-contract.test.mjs`
- Create: `tools/delivery-governance/test/aggregate.test.mjs`

**Interfaces:**

- Consumes: GitHub pull-request event, root `package.json` when present, and
  dependent job results.
- Produces: one stable required check named `Delivery gates`.

- [ ] **Step 1: Write failing application-contract tests**

The absence of a root `package.json` must produce:

```js
{
  applicationPresent: false,
  errors: [],
  message: "Application gates: not applicable; root package.json is absent."
}
```

When a root manifest exists, require these exact scripts:

```js
export const REQUIRED_APPLICATION_SCRIPTS = [
  "format:check",
  "lint",
  "typecheck",
  "test:unit",
  "test:integration",
  "build",
  "test:performance",
  "audit:ci",
  "version:check",
];

export const REQUIRED_WINDOWS_SCRIPTS = [
  "package:win",
  "smoke:installer",
];
```

Test one failure per missing script and one valid manifest.

- [ ] **Step 2: Write failing aggregate-result tests**

Cover:

- governance failure always fails;
- no application manifest accepts skipped application jobs;
- an application manifest requires Linux success;
- epic-to-main with an application manifest requires Windows success;
- task-to-epic accepts a skipped Windows job;
- cancelled jobs fail.

Expose:

```js
export function aggregateResults({
  governance,
  applicationLinux,
  applicationWindows,
  applicationPresent,
  epicToMain,
}) {
  return { ok, summary };
}
```

- [ ] **Step 3: Confirm tests fail**

Run:

```bash
node --test tools/delivery-governance/test/application-contract.test.mjs tools/delivery-governance/test/aggregate.test.mjs
```

Expected: both modules are missing.

- [ ] **Step 4: Implement the two pure modules**

Do not run npm commands from these modules. They validate the command contract and
aggregate results only, making every branch testable without GitHub Actions.

- [ ] **Step 5: Add the workflow**

Use:

```yaml
name: Delivery gates

on:
  pull_request:
    branches:
      - main
      - "epic/**"
    types:
      - opened
      - reopened
      - synchronize
      - ready_for_review
      - edited

permissions:
  contents: read

concurrency:
  group: delivery-gates-${{ github.event.pull_request.number }}
  cancel-in-progress: true
```

The workflow uses these immutable actions:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
  with:
    fetch-depth: 0
    persist-credentials: false
    ref: ${{ github.event.pull_request.head.sha }}
- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
  with:
    node-version: 24.18.1
    package-manager-cache: false
```

Define four jobs with these exact displayed names:

1. `Governance`
2. `Application / Linux`
3. `Application / Windows`
4. `Delivery gates`

`Governance` checks out the pull-request commit with no write token, installs the
governance tool using `npm ci --ignore-scripts`, runs all governance tests,
validates the PR event at `$GITHUB_EVENT_PATH`, validates the repository, and
emits `application_present`. It validates both event SHAs, computes base
ancestry, and supplies the changed-file list from
`git diff --name-only "$PR_BASE_SHA" "$PR_HEAD_SHA"` to the branch policy.

`Governance` and `Application / Linux` use `ubuntu-24.04`.
`Application / Windows` uses `windows-2025`.

`Application / Linux` runs only when that output is `true` and executes:

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:performance
npm run audit:ci
npm run version:check
```

`Application / Windows` runs only for an `epic/*` pull request targeting `main`
when the application is present. It runs the same root quality contract plus:

```powershell
npm run package:win
npm run smoke:installer
```

`Delivery gates` uses `if: always()`, receives all three results, calls
`aggregate.mjs`, writes the summary to `$GITHUB_STEP_SUMMARY`, and exits nonzero
for every invalid combination.

Record that both pinned actions are maintained by GitHub's `actions`
organization and use MIT-licensed source. Do not introduce another action without
recording its maintainer, license, immutable SHA, and necessity in the review
runbook.

- [ ] **Step 6: Run all local tests and syntax validation**

Run:

```bash
npm --prefix tools/delivery-governance test
npm --prefix tools/delivery-governance run validate:repository
```

Expected: the workflow parses, aggregation tests pass, and the real repository
reports application gates as not applicable.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/delivery-gates.yml tools/delivery-governance
git commit -m "ci: add stable delivery gates"
```

### Task 7: Store and Apply Repository Rules as Desired State

**Files:**

- Create: `.github/rulesets/main.json`
- Create: `.github/rulesets/epic.json`
- Create: `tools/delivery-governance/src/github-admin.mjs`
- Create: `tools/delivery-governance/test/github-admin.test.mjs`

**Interfaces:**

- Consumes: repository name, desired-state JSON, and an administration-write
  token only when `--apply` is selected.
- Produces: idempotent repository settings and rulesets; dry-run is the default.

- [ ] **Step 1: Write mocked-fetch tests**

Prove:

- dry-run never sends a mutation;
- apply patches repository merge settings to allow squash and merge commits,
  disable rebase, and delete merged task branches;
- Actions default workflow permission becomes `read`;
- an existing named ruleset is updated and a missing named ruleset is created;
- a non-2xx API response fails without attempting later writes;
- authorization headers and tokens never appear in logs.

- [ ] **Step 2: Add the initial `main` ruleset**

Use:

```json
{
  "name": "ERC main",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "deletion"
    },
    {
      "type": "non_fast_forward"
    },
    {
      "type": "pull_request",
      "parameters": {
        "allowed_merge_methods": ["merge"],
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": true,
        "required_approving_review_count": 1,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          {
            "context": "Delivery gates"
          }
        ],
        "strict_required_status_checks_policy": true
      }
    }
  ]
}
```

- [ ] **Step 3: Add the initial `epic/*` ruleset**

Use:

```json
{
  "name": "ERC epic branches",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/epic/*"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "deletion"
    },
    {
      "type": "non_fast_forward"
    },
    {
      "type": "pull_request",
      "parameters": {
        "allowed_merge_methods": ["squash"],
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": true,
        "required_approving_review_count": 1,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "do_not_enforce_on_create": true,
        "required_status_checks": [
          {
            "context": "Delivery gates"
          }
        ],
        "strict_required_status_checks_policy": true
      }
    }
  ]
}
```

Exact Semgrep or AI status names are deliberately absent until Task 9 records
them from real calibration runs.

- [ ] **Step 4: Implement the administration client**

Use Node's global `fetch`, API version `2026-03-10`, and these endpoints:

```text
PATCH /repos/EmpRider/ERC-Chart-Desktop-App
PUT /repos/EmpRider/ERC-Chart-Desktop-App/actions/permissions/workflow
GET /repos/EmpRider/ERC-Chart-Desktop-App/rulesets
POST /repos/EmpRider/ERC-Chart-Desktop-App/rulesets
PUT /repos/EmpRider/ERC-Chart-Desktop-App/rulesets/{ruleset_id}
```

The apply mode reads `ERC_CHART_GITHUB_ADMIN_TOKEN`; it exits before any request
when the variable is absent. Never persist, print, or copy this credential.

- [ ] **Step 5: Test and inspect the dry-run**

Run:

```bash
npm --prefix tools/delivery-governance test
node tools/delivery-governance/src/github-admin.mjs --dry-run
```

Expected: tests pass and dry-run prints only target endpoints, rule names, and
non-secret settings.

- [ ] **Step 6: Commit desired state before applying it**

```bash
git add .github/rulesets tools/delivery-governance
git commit -m "ci: define protected branch rules"
```

- [ ] **Step 7: Apply only after bootstrap PR 1 merges**

Run the apply mode from an authenticated owner environment and then read back
repository settings and both rulesets. If administration-write access is
unavailable, stop at this step and have the owner run the same checked-in client;
do not weaken or partially apply the rules.

### Task 8: Document Review Order, Capacity, and Application Handoff

**Files:**

- Create: `docs/governance/REVIEW-RUNBOOK.md`
- Create: `docs/governance/APPLICATION-GATE-CONTRACT.md`
- Create: `docs/governance/CALIBRATION-PROCEDURE.md`
- Create: `docs/governance/calibration-evidence.schema.json`
- Create: `tools/delivery-governance/test/governance-docs.test.mjs`

**Interfaces:**

- Consumes: approved reviewer matrix and observed provider behavior.
- Produces: one operational procedure and a strict evidence schema.

- [ ] **Step 1: Write documentation-contract tests**

Assert that the runbook contains:

- deterministic checks before AI review;
- CodeRabbit before Qodo;
- Qodo `/agentic_review` on stable heads only;
- Code Review AI on epic-to-main only;
- eight first-pass plus two re-review monthly allocation;
- review invalidation after any code commit;
- independent approval last;
- fail-closed behavior for missing Qodo epic capacity;
- no administrator bypass;
- exact handling for comments versus stable status checks.

Assert that the application contract lists all scripts from Task 6 and assigns
`package:win`, `smoke:installer`, checksum, tag, and GitHub Release publication to
ECDD-62.

- [ ] **Step 2: Add the review runbook**

For each task PR:

1. keep draft status while code changes;
2. run local deterministic commands;
3. mark ready and wait for `Delivery gates`, Semgrep, and CodeRabbit;
4. resolve all actionable findings;
5. request `/agentic_review` from Qodo on the stable head during the trial;
6. rerun affected deterministic tests after fixes;
7. request independent `@EmpRider` approval;
8. squash merge only after current-head evidence is clear.

For each epic PR, repeat that sequence, then invoke Code Review AI once all
earlier gates are clear, preserve two monthly re-reviews, obtain independent
approval, and merge with a merge commit.

The runbook must state that bot comments are evidence, not GitHub approvals, when
the bot does not publish a counted review or stable status.

When the Qodo trial ends, task-to-epic Qodo review becomes conditional only
through a reviewed governance change that records continued capacity or removes
that task-level requirement. Epic-to-main remains fail-closed if paid or
qualified open-source Qodo access is not active. There is no silent transition
and no administrator bypass.

- [ ] **Step 3: Add the application gate contract**

Record each root script from Task 6, its owner issue, expected exit behavior, and
whether it runs on Linux, Windows, or both. State that ECDD-54 removes
`tools/delivery-governance/package-lock.json`, includes the tool in the root npm
workspace, and moves its dependency graph into the single root
`package-lock.json`.

- [ ] **Step 4: Add the calibration evidence schema**

Require:

```json
{
  "calibratedAt": "date-time",
  "codingAuthor": "string",
  "independentApprover": "EmpRider",
  "taskPullRequest": "integer",
  "epicPullRequest": "integer",
  "qodoTrialEndsOn": "date",
  "reviewers": {
    "coderabbit": {
      "login": "string",
      "representation": "check|review|comment",
      "observedContexts": ["string"]
    },
    "semgrep": {
      "login": "string",
      "representation": "check",
      "observedContexts": ["string"]
    },
    "qodo": {
      "login": "string",
      "representation": "check|review|comment",
      "observedContexts": ["string"]
    },
    "codeReviewAi": {
      "login": "string",
      "representation": "check|review|comment",
      "observedContexts": ["string"]
    }
  },
  "assertions": {
    "separateAuthor": true,
    "coderabbitComprehensive": true,
    "semgrepBlocks": true,
    "qodoTaskAndEpic": true,
    "codeReviewAiEpicOnly": true,
    "staleApprovalDismissed": true,
    "directPushRejected": true,
    "forcePushRejected": true,
    "documentationMergeCreatedNoRelease": true
  }
}
```

The committed evidence file is created only from real observations. Read the
exact Qodo trial end date shown in the Qodo portal; do not infer it from the
installation date.

- [ ] **Step 5: Run all governance validation**

Run:

```bash
npm --prefix tools/delivery-governance test
npm --prefix tools/delivery-governance run lint:markdown
npm --prefix tools/delivery-governance run validate:repository
```

Expected: all tests and documentation checks pass.

- [ ] **Step 6: Commit**

```bash
git add docs/governance tools/delivery-governance/test/governance-docs.test.mjs
git commit -m "docs: add delivery governance runbooks"
```

### Task 9: Merge Bootstrap and Run Two-level Calibration

**Files:**

- Create after observation:
  `docs/governance/calibration-evidence.json`
- Modify after observation:
  `.github/rulesets/main.json`
- Modify after observation:
  `.github/rulesets/epic.json`

**Interfaces:**

- Consumes: merged bootstrap configuration, separate coding identity, reviewer
  apps, and real GitHub check/review output.
- Produces: calibrated required-check names and proof that every approved
  reviewer path works on the current head.

- [ ] **Step 1: Finish bootstrap PR 1**

Push the complete governance implementation to
`bootstrap/delivery-governance`. Run every local command from Tasks 1-8, update
the PR body with exact results, and mark the PR ready. Do not represent
CodeRabbit's earlier draft-skip status as a review pass.

- [ ] **Step 2: Merge the one-time bootstrap and apply initial rules**

After the user confirms the diff, merge PR 1, verify its commit on `main`, delete
the bootstrap branch, apply Task 7's initial rulesets, and confirm a
documentation-only merge created no tag or release.

- [ ] **Step 3: Create Jira calibration work**

Create one governance calibration epic in project `ECDD` and one child task. Use
the Jira-returned keys in branch names and pull-request bodies; do not reuse
ECDD-53 or invent issue numbers.

- [ ] **Step 4: Verify the separate coding identity before writing calibration branches**

The coding GitHub App or machine user creates the epic branch from current
`main` and the task branch from that epic. If the author resolves to `EmpRider`,
stop calibration and product work until a separate identity is connected.

- [ ] **Step 5: Exercise task-to-epic gates**

Open the task PR as draft. Add a temporary non-production JavaScript fixture with
an obvious injection sink so Semgrep must block it. Mark ready, record the
Semgrep failure and CodeRabbit comprehensive review, return to draft, remove the
fixture, add a harmless calibration record, and push one coherent fix commit.

Wait for deterministic checks and CodeRabbit to clear, then comment:

```text
/agentic_review
```

Record Qodo's identity, output representation, reviewed head SHA, and actionable
finding state. Do not invoke Code Review AI. Obtain current independent approval
from `EmpRider` and squash merge into the calibration epic.

- [ ] **Step 6: Exercise epic-to-main gates**

Open the calibration epic PR to `main`. Confirm `Delivery gates`, Semgrep, a
comprehensive CodeRabbit review, and Qodo review on the stable head. Invoke Code
Review AI once and record it as one consumed first-pass monthly review.

Have `EmpRider` approve, push a harmless reviewable commit with the separate
author, and verify the approval becomes stale. Rerun applicable reviewers on the
new head and obtain a new independent approval.

- [ ] **Step 7: Verify branch enforcement**

Using the separate coding identity, attempt a normal direct push and a
non-fast-forward push to the calibration epic and `main`. Both must be rejected.
Do not use an administrator bypass.

- [ ] **Step 8: Commit real evidence and observed check names**

Populate `calibration-evidence.json` from GitHub's current-head results. Add to
the two ruleset JSON files only status names that were stable, successful, and
observed in the repository during the previous seven days. `Delivery gates` and
the observed Semgrep check are required. Add an AI reviewer status only when that
provider actually emitted a stable pass/fail status; comment-only and
review-only providers remain enforced by the independent runbook.

- [ ] **Step 9: Reapply and verify the final rulesets**

Run all governance tests, apply the updated desired state, read it back, and
confirm missing required checks, stale approval, unresolved conversations, and
missing Code Owner approval each block merge.

- [ ] **Step 10: Merge calibration and retire its epic branch safely**

Merge the calibrated epic PR with a merge commit. Because the generic
`epic/*` ruleset blocks deletion, the administration client must:

1. verify the epic PR is merged and its recorded head SHA matches the branch;
2. add only that exact merged branch to the epic ruleset exclusion list;
3. delete that branch;
4. remove the temporary exclusion immediately; and
5. read back the active generic ruleset.

This preserves the no-bypass rule while allowing verified merged epic cleanup.

- [ ] **Step 11: Mark governance active**

Update the design status to `Implemented and calibrated`, add links to both
calibration PRs and evidence, rerun all checks, and commit:

```bash
git add docs/governance docs/superpowers/specs .github/rulesets
git commit -m "docs: record calibrated delivery gates"
```

### Task 10: Gate the Start of Product Implementation

**Files:**

- Modify: `README.md`
- Modify: `docs/architecture/v1/IMPLEMENTATION-BACKLOG.md`
- Test: `tools/delivery-governance/test/governance-docs.test.mjs`

**Interfaces:**

- Consumes: successful Task 9 evidence.
- Produces: an explicit prerequisite for ECDD-53 product-code work.

- [ ] **Step 1: Extend the documentation test**

Assert that the README links the approved delivery workflow and calibration
evidence, and that Epic 1 lists active calibrated governance as an entry
condition.

- [ ] **Step 2: Confirm the new assertions fail**

Run:

```bash
node --test tools/delivery-governance/test/governance-docs.test.mjs
```

Expected: failure because the two documents do not yet contain the prerequisite.

- [ ] **Step 3: Add the prerequisite**

State plainly that no product-code task may merge until
`calibration-evidence.json` validates and every assertion is `true`. Link the
delivery design, runbook, and evidence from README.

- [ ] **Step 4: Run the final local suite**

Run:

```bash
npm ci --prefix tools/delivery-governance --ignore-scripts
npm --prefix tools/delivery-governance test
npm --prefix tools/delivery-governance run lint:markdown
npm --prefix tools/delivery-governance run validate:repository
git diff --check
```

Expected: every command exits `0`, application checks remain explicitly not
applicable, and no release artifact exists.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/architecture/v1/IMPLEMENTATION-BACKLOG.md tools/delivery-governance/test/governance-docs.test.mjs
git commit -m "docs: gate product work on review calibration"
```

## Final Verification Checklist

- [ ] `bootstrap/delivery-governance` was used once and deleted.
- [ ] The only stable aggregate workflow status is named `Delivery gates`.
- [ ] No skipped application job is described as a successful build.
- [ ] Pull-request branch direction and Jira evidence tests cover allowed and
  rejected cases.
- [ ] Markdown, YAML, TOML, JSON, JSON Schema examples, secret-like content, and
  binary exclusions are validated.
- [ ] CodeRabbit comprehensive review is proven for both base-branch levels.
- [ ] Semgrep blocks a deliberate finding at both required levels.
- [ ] Qodo reviews both levels during the trial and is tied to the current head.
- [ ] Code Review AI is absent from task PRs and one calibration epic review is
  counted against the monthly first-pass allocation.
- [ ] `EmpRider` approval counts only on PRs authored by another identity.
- [ ] New code dismisses stale approval and invalidates old AI evidence.
- [ ] Direct pushes, force pushes, deletion, unresolved conversations, and
  missing approvals are blocked as designed.
- [ ] Rulesets contain only check names observed from real repository runs.
- [ ] A documentation-only merge produces no application tag or release.
- [ ] ECDD-54 owns the transition to one root npm lockfile.
- [ ] ECDD-62 remains the sole owner of NSIS packaging and release publication.
