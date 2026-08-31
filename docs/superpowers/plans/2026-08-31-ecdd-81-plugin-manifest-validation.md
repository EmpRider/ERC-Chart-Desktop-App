# ECDD-81 Plugin Manifest Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a strict plugin manifest v1 JSON Schema, runtime validator, public types, and regression coverage.

**Architecture:** Keep the contract in `@erc-chart/contracts`, using one dependency-free schema artifact and one handwritten boundary validator. The validator returns stable paths/codes while enforcing cross-field and hostile-object rules the schema cannot express.

**Tech Stack:** TypeScript, JSON Schema 2020-12 object, Node test runner.

## Global Constraints

- No new dependency.
- Accept only provider and indicator manifest v1.
- Reject unknown fields and incompatible host API ranges.
- Validate integrity declarations; do not read or hash package files.
- Signing, staging, activation, and permission approval remain out of scope.

---

### Task 1: Runtime contract and schema

**Files:**

- Modify: `packages/contracts/src/plugins.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/plugin-manifest.test.mjs`
- Test: `packages/contracts/test/contract-types.test.ts`

**Interfaces:**

- Produces: `PluginManifest`, `PluginManifestReport`, `pluginManifestSchema`, `inspectPluginManifest`, `isPluginManifest`.

- [ ] **Step 1: Write failing runtime tests**

Add valid provider/indicator fixtures. Assert exact acceptance, malformed values, unsupported versions, incompatible host ranges, traversal paths, invalid SHA-256 values, duplicate/unsorted declarations, unknown fields, and hostile object rejection.

- [ ] **Step 2: Verify red**

Run: `npm run build && node --test packages/contracts/test/plugin-manifest.test.mjs`

Expected: fail because manifest exports do not exist.

- [ ] **Step 3: Add compile-time usage**

Extend `contract-types.test.ts` with a valid `PluginManifest` and an expected type error for a non-versioned manifest number.

- [ ] **Step 4: Implement minimum contract**

Add the closed schema object, manifest/report types, pure validation helpers, stable report creation, compatibility classification, and type predicate to `plugins.ts`. Re-export them from `index.ts`.

- [ ] **Step 5: Verify green**

Run: `npm run build && node --test packages/contracts/test/plugin-manifest.test.mjs && npm run typecheck`

Expected: all plugin-manifest tests and typecheck pass.

### Task 2: Repository verification

**Files:**

- Modify only if a gate exposes a scoped defect.

- [ ] **Step 1: Run quality gates**

Run: `npm run format:check && npm run lint && npm run typecheck`

Expected: pass.

- [ ] **Step 2: Run test gates**

Run: `npm run test:unit && npm run test:integration`

Expected: pass, except the known local Windows symlink test may report `EPERM` when Developer Mode is unavailable.

- [ ] **Step 3: Review diff**

Run: `git diff --check` and review only ECDD-81 files for correctness, contract drift, security boundaries, and unnecessary complexity.
