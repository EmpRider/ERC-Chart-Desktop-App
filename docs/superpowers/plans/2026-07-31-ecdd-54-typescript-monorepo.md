# ECDD-54 TypeScript Monorepo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the frozen ERC-chart workspace units as a strict npm/TypeScript monorepo with enforceable public package boundaries and a complete baseline command contract.

**Architecture:** Use one root npm workspace and one lockfile. Application packages expose only their root entry point, extend one strict TypeScript base configuration, and declare dependencies through `@erc-chart/*` workspace names. A small repository tool validates the approved workspace inventory, dependency direction, deep imports, escaping relative imports, and cycles before ESLint runs.

**Tech Stack:** Node.js `24.18.1`, npm `11.9.0`, TypeScript `6.0.3`, ESLint `10.8.0`, typescript-eslint `8.65.0`, Prettier `3.9.6`, and Node's built-in test runner.

## Global Constraints

- Preserve every directory name and responsibility frozen in `docs/architecture/v1/CONTRACT-BASELINE-v1.md`.
- Use npm workspaces and exactly one root `package-lock.json`; remove `tools/delivery-governance/package-lock.json`.
- Keep `packages/contracts` dependency-free and allow SDK and chart-core packages to depend only on it.
- Reject cross-package relative imports, `@erc-chart/*` deep imports, undeclared workspace imports, disallowed dependencies, and circular dependencies.
- Do not implement Electron behavior, chart behavior, provider behavior, storage behavior, plugin runtimes, UI, packaging, or installer behavior.
- Root format, lint, typecheck, unit-test, integration-test, build, audit, and version checks must be deterministic and non-interactive.
- `package:win` and `smoke:installer` remain explicit ECDD-62 deferred gates and must not pretend to package an installer.

---

### Task 1: Executable Workspace Contract

**Files:**

- Create: `tools/workspace-boundaries/package.json`
- Create: `tools/workspace-boundaries/src/workspace-contract.mjs`
- Create: `tools/workspace-boundaries/src/cli.mjs`
- Create: `tools/workspace-boundaries/test/workspace-contract.test.mjs`
- Create: `tools/workspace-boundaries/workspace-contract.json`

**Interfaces:**

- Consumes: repository root containing npm workspace manifests and TypeScript sources.
- Produces: `validateWorkspace(root): Promise<string[]>` and a CLI that exits nonzero after printing any validation error.

- [x] **Step 1: Write failing tests for the approved inventory and public-entry contract**

  Create fixtures that omit an approved workspace, omit an export, and include every required workspace. Assert exact actionable errors and an empty error list for the valid fixture.

- [x] **Step 2: Run the tests to verify RED**

  Run: `node --test tools/workspace-boundaries/test/workspace-contract.test.mjs`

  Expected: FAIL because `src/workspace-contract.mjs` does not exist.

- [x] **Step 3: Implement inventory and manifest validation**

  Load the checked-in contract map, expand only `apps/*` and `packages/*`, require the 13 frozen application units, and verify each has a scoped name, description, private/version declaration, `types`, root-only `exports`, and `tsconfig.json`.

- [x] **Step 4: Add failing dependency/import/cycle tests**

  Test a disallowed manifest dependency, an undeclared package import, a deep scoped import, a relative import escaping its workspace, and a two-package cycle. Each fixture must fail for the named behavior, not because setup is malformed.

- [x] **Step 5: Implement dependency graph and source import validation**

  Parse static `import`, `export ... from`, and dynamic `import()` specifiers from `.ts`/`.tsx` files; validate scoped package imports against manifest dependencies and validate the manifest graph with deterministic depth-first cycle detection.

- [x] **Step 6: Run the focused suite to verify GREEN**

  Run: `node --test tools/workspace-boundaries/test/workspace-contract.test.mjs`

  Expected: all workspace-contract tests pass.

### Task 2: Root npm and TypeScript Scaffold

**Files:**

- Create: `package.json`
- Create: `package-lock.json`
- Create: `.nvmrc`
- Create: `.npmrc`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `.prettierignore`
- Create: `tools/application-gates/src/deferred-gate.mjs`
- Modify: `tools/delivery-governance/package.json`
- Delete: `tools/delivery-governance/package-lock.json`

**Interfaces:**

- Consumes: `validateWorkspace(root)` from Task 1.
- Produces: root commands `format:check`, `lint`, `typecheck`, `test:unit`, `test:integration`, `build`, `test:performance`, `audit:ci`, `version:check`, `package:win`, and `smoke:installer`.

- [x] **Step 1: Add a failing integration test for the root command/workspace contract**

  Extend the workspace-contract tests to validate root workspace globs, the pinned Node/npm declarations, a single root lockfile, required scripts, and project references for every approved TypeScript unit.

- [x] **Step 2: Run the focused suite to verify RED**

  Run: `node --test tools/workspace-boundaries/test/workspace-contract.test.mjs`

  Expected: FAIL with missing root manifest/config errors.

- [x] **Step 3: Add the minimal root toolchain and configurations**

  Pin all direct dependencies exactly, include `apps/*`, `packages/*`, and `tools/*` as npm workspaces, configure strict ESM TypeScript project references, and make lint run boundary validation before ESLint.

- [x] **Step 4: Consolidate the governance lockfile**

  Remove the nested lockfile and run `npm install --ignore-scripts` once from the root to create the only lockfile.

- [x] **Step 5: Run the focused suite to verify GREEN**

  Run: `npm run test:integration`

  Expected: the root/workspace integration contract passes.

### Task 3: Frozen Package Units and Minimum Contracts

**Files:**

- Create: `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/src/index.ts`
- Create: equivalent manifest, TypeScript config, and `src/index.ts` for `contracts`, `electron-main`, `preload`, `renderer`, `chart-core`, `data-service`, `provider-sdk`, `provider-runtime`, `indicator-sdk`, `indicator-runtime`, `storage`, and `testing`.
- Create: `packages/contracts/src/versions.ts`
- Create: `packages/contracts/src/identifiers.ts`
- Create: `packages/contracts/src/market-data.ts`
- Create: `packages/contracts/src/envelopes.ts`
- Create: `packages/contracts/src/plugins.ts`

**Interfaces:**

- Produces: positive integer `ContractVersion`; branded provider/feed/instrument/timeframe IDs; finite normalized `Candle` and `Tick` shapes using Unix milliseconds UTC; versioned request/response/error envelopes; plugin compatibility identifiers; and the eight frozen version constants, all exported only from `@erc-chart/contracts`.
- All other units expose an intentionally empty root module until their owning implementation issue.

- [x] **Step 1: Add failing type-level contract fixtures**

  Add a `packages/contracts/test/contract-types.test.ts` fixture compiled by a no-emit test TypeScript project. Include valid assignments and `@ts-expect-error` cases for zero contract versions, unbranded identifiers, missing envelope versions, and non-contract fields.

- [x] **Step 2: Run contract typecheck to verify RED**

  Run: `npm run typecheck`

  Expected: FAIL because the contract public API and workspace projects are absent.

- [x] **Step 3: Create every frozen workspace and the minimal contract API**

  Give each manifest its frozen responsibility as the description, a root-only export, and only allowed `workspace:*` dependencies. Implement no business behavior outside the permitted stable contract concepts.

- [x] **Step 4: Run typecheck and build to verify GREEN**

  Run: `npm run typecheck && npm run build`

  Expected: all TypeScript projects type-check and emit their own `dist` output.

### Task 4: Documentation and Complete Verification

**Files:**

- Create: `docs/development/MONOREPO.md`
- Modify: `README.md`
- Modify: `.gitignore`
- Modify: `docs/superpowers/plans/2026-07-31-ecdd-54-typescript-monorepo.md`

**Interfaces:**

- Produces: contributor-facing package map, dependency rules, root command guide, and ECDD-62 deferred-gate explanation.

- [x] **Step 1: Document the package map and dependency rules**

  Copy the frozen responsibilities without changing them, explain public root imports, list forbidden imports, and document `npm ci` plus every runnable ECDD-54 baseline command.

- [x] **Step 2: Mark executed plan steps complete and scan for plan defects**

  Verify no placeholder language, mismatched function names, or missing acceptance criterion remains; then update completed checkboxes.

- [x] **Step 3: Verify from a clean dependency state**

  Run `npm ci --ignore-scripts`, then run formatting, lint, typecheck, unit tests, integration tests, build, performance baseline, audit, version check, governance tests, repository validation, and Markdown lint.

- [x] **Step 4: Review the final diff against ECDD-54**

  Confirm all 13 frozen units exist, the root lockfile is the only lockfile, forbidden dependencies/imports/cycles fail tests, and no deferred product behavior entered the branch.

- [x] **Step 5: Commit the implementation**

  Run:

  ```bash
  git add --all
  git commit -m "ECDD-54: establish TypeScript monorepo boundaries"
  ```
