# ECDD-57 Custom Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the sandboxed renderer through a root-contained `erc-app://` Electron protocol.

**Architecture:** Pure URL-to-asset policy lives in `@erc-chart/electron-main`; the desktop app supplies the Electron protocol adapter. Application startup and shutdown own handler lifecycle.

**Tech Stack:** TypeScript 6, Electron 43, Node test runner, esbuild

## Global Constraints

- Preserve the ECDD-55 BrowserWindow security baseline.
- Register schemes before Electron readiness and handlers only after readiness.
- Serve only the fixed `app` host from the built renderer root.
- Do not implement CSP, navigation policy, IPC sender validation, or fuses in this task.
- Follow test-first red-green-refactor cycles.

---

### Task 1: Pure asset URL policy

**Files:**

- Create: `packages/electron-main/src/protocol.ts`
- Modify: `packages/electron-main/src/index.ts`
- Test: `packages/electron-main/test/protocol.test.mjs`

**Interfaces:**

- Produces: `rendererProtocolScheme`, `rendererEntryUrl`, and `resolveRendererAssetUrl(requestUrl, rootPath)`.

- [ ] Write resolver tests for valid, invalid, malformed, and traversal-shaped URLs.
- [ ] Run the focused test and confirm it fails because the API is absent.
- [ ] Implement the minimal pure resolver.
- [ ] Run the focused test and confirm it passes.

### Task 2: Application protocol lifecycle

**Files:**

- Modify: `packages/electron-main/src/application.ts`
- Test: `packages/electron-main/test/application.test.mjs`

**Interfaces:**

- Consumes: a `registerRendererProtocol(rootPath)` adapter returning an unregister callback.
- Produces: URL-based window loading and bounded handler cleanup.

- [ ] Change fixture expectations to require registration before loading and cleanup on failure/shutdown.
- [ ] Run focused tests and confirm the expected contract failures.
- [ ] Replace `loadFile` with `loadURL` and integrate protocol lifecycle.
- [ ] Run focused tests and confirm they pass.

### Task 3: Electron adapter and artifact paths

**Files:**

- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/paths.ts`
- Modify: `apps/desktop/test/paths.test.mjs`

**Interfaces:**

- Produces: the privileged scheme registration, Electron handler adapter, renderer root, and fixed entry URL.

- [ ] Write path and registration-facing expectations first.
- [ ] Run focused tests and capture the expected failure.
- [ ] Register the scheme and adapt `protocol.handle`, `net.fetch`, and `protocol.unhandle`.
- [ ] Run focused tests and confirm they pass.

### Task 4: Full verification and delivery

**Files:**

- Modify if required by behavior: `tools/runtime-build.test.mjs`, `tools/electron-smoke.mjs`

- [ ] Run formatting, lint, typecheck, unit, integration, runtime build, Electron smoke, audit, and version checks.
- [ ] Confirm `git diff --check` is clean.
- [ ] Commit, push the task branch, open a draft PR, and follow the task-to-epic review runbook.
