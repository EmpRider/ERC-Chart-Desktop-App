# ECDD-55 Electron Vertical Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the smallest executable Electron vertical skeleton that boots a secure sandboxed window, connects a narrow typed preload bridge, renders deterministic dummy content, and establishes launchable utility and SDK package boundaries.

**Architecture:** `apps/desktop` composes artifact paths and starts the lifecycle owned by `packages/electron-main`. Shared wire data stays in `packages/contracts`; preload, renderer, data utility, provider utility, and SDKs each expose one focused public boundary. Electron 43.2.0 supplies the runtime, esbuild emits the sandbox-compatible CommonJS preload and browser renderer artifacts, and Node's test runner plus a lightweight DOM implementation exercise real behavior.

**Tech Stack:** Node.js 24.18.1, npm 11.9.0, TypeScript 6.0.3, Electron 43.2.0, esbuild 0.28.1, linkedom 0.18.13, Node test runner.

## Global Constraints

- Branch: `task/ECDD-55-electron-skeleton`; target: `epic/ECDD-53-repository-build`.
- Renderer preferences are exactly `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `contextIsolation: true`, `sandbox: true`, and `webSecurity: true`.
- Preload exposes only `window.ercChart.getRuntimeInfo()`; no raw Electron, IPC, filesystem, process, or generic invoke API crosses the bridge.
- The data utility starts at application boot; the provider utility remains idle until explicitly launched.
- Utility failure must not close the renderer, and shutdown must be bounded and idempotent.
- No React shell, custom protocol, final CSP/navigation policy, chart, provider protocol, persistence, installer, tag, or release is implemented by ECDD-55.
- Development Version 1 is later published after all Epic 1 work and reviews as application `0.1.0-dev.1`, tag `v0.1.0-dev.1`, with `.exe` and `.sha256` GitHub pre-release assets.
- Every production behavior follows RED → GREEN → REFACTOR; tests assert observable behavior rather than source text.

---

### Task 1: Freeze Delivery Metadata and Runtime Dependencies

**Files:**

- Modify: `docs/superpowers/specs/2026-08-01-ecdd-55-electron-vertical-skeleton-design.md`
- Create: `docs/superpowers/plans/2026-08-01-ecdd-55-electron-vertical-skeleton.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tools/workspace-boundaries/workspace-contract.json`
- Modify: `tools/workspace-boundaries/test/workspace-contract.test.mjs`

**Interfaces:**

- Consumes: ECDD-54 root scripts and exact workspace inventory.
- Produces: pinned Electron/build/test dependencies and required `start`, `build:runtime`, and `smoke:electron` script contracts.

- [ ] **Step 1: Record the approved pre-release semantics**

Update the design so Development Version 1 is `0.1.0-dev.1`, immutable tag `v0.1.0-dev.1`, and pre-release assets `ERC-Chart-Setup-0.1.0-dev.1.exe` plus its `.sha256` file. Keep all release work deferred beyond ECDD-55.

- [ ] **Step 2: Write the failing root-script contract test**

Add literal expectations that the required script inventory contains `start`, `build:runtime`, and `smoke:electron`. The mutation caught is removing a real runtime command while leaving compile-only gates green.

- [ ] **Step 3: Verify RED**

Run: `node --test tools/workspace-boundaries/test/workspace-contract.test.mjs`

Expected: FAIL because the three runtime scripts are absent.

- [ ] **Step 4: Install the minimal pinned dependencies and scripts**

Add exact dev dependencies `electron@43.2.0`, `esbuild@0.28.1`, and `linkedom@0.18.13`. Add root commands that build runtime artifacts, start the built desktop entry with Electron, and run the boot smoke harness. Update the executable contract inventory.

- [ ] **Step 5: Verify GREEN and commit**

Run the focused workspace-contract suite and `npm run boundaries:check`.

Commit: `ECDD-55: pin Electron skeleton toolchain`

---

### Task 2: Add Runtime, Utility, and SDK Contract Surfaces

**Files:**

- Create: `packages/contracts/src/runtime.ts`
- Create: `packages/contracts/src/utility-process.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/test/runtime.test.mjs`
- Create: `packages/contracts/test/utility-process.test.mjs`
- Create: `packages/provider-sdk/test/provider-sdk.test.mjs`
- Modify: `packages/provider-sdk/src/index.ts`
- Create: `packages/indicator-sdk/test/indicator-sdk.test.mjs`
- Modify: `packages/indicator-sdk/src/index.ts`
- Create: `packages/provider-sdk/test/provider-sdk.types.ts`
- Create: `packages/indicator-sdk/test/indicator-sdk.types.ts`

**Interfaces:**

- Consumes: `ContractVersion`, `CompatibilityRange`, `Candle`, `Tick`, branded identifiers, and existing v1 version constants from `@erc-chart/contracts`.
- Produces: `RuntimeInfo`, `runtimeInfoChannel`, `isRuntimeInfo`, `UtilityControlMessage`, `UtilityStatusMessage`, `isUtilityControlMessage`, `isUtilityStatusMessage`, provider adapter contracts, indicator lifecycle/plot contracts, and inert `SignalCandidate`.

- [ ] **Step 1: Write failing runtime and utility validator tests**

Test literal valid messages and malformed values. A validator must reject wrong versions, extra application names, unknown utility message types, and non-string error-code values without throwing.

- [ ] **Step 2: Verify RED**

Run: `npm run build --workspace @erc-chart/contracts && node --test packages/contracts/test/runtime.test.mjs packages/contracts/test/utility-process.test.mjs`

Expected: FAIL because the exports do not exist.

- [ ] **Step 3: Implement minimal shared wire contracts**

Implement `RuntimeInfo` as `{ ipcContractVersion, applicationName: "ERC Chart" }`, fixed channel `erc-chart:runtime-info`, and a discriminated ready/shutdown/stopped/error utility protocol. Validators must use explicit property checks and fail closed.

- [ ] **Step 4: Verify shared contracts GREEN**

Run the focused contracts tests and existing contracts suite.

- [ ] **Step 5: Write failing SDK runtime/type tests**

Provider tests require versioned metadata/capabilities and a typed adapter with `connect`, `disconnect`, `getCapabilities`, `requestHistory`, and `subscribe`. Indicator tests require versioned metadata, declarative input/output/plot definitions, history/building/finalized/tick/dispose hooks, and inert `SignalCandidate` data with no broadcaster method.

- [ ] **Step 6: Verify RED, implement minimal SDK exports, and verify GREEN**

Run `npm run typecheck` and the focused SDK runtime tests before and after implementation. Export interfaces only where runtime behavior is unnecessary; export the pinned contract-version values used by fixtures.

- [ ] **Step 7: Commit**

Commit: `ECDD-55: define skeleton boundary contracts`

---

### Task 3: Implement Data and Provider Utility Lifecycles

**Files:**

- Create: `packages/data-service/src/utility-entry.ts`
- Create: `packages/data-service/src/utility-runtime.ts`
- Modify: `packages/data-service/src/index.ts`
- Create: `packages/data-service/test/utility-runtime.test.mjs`
- Create: `packages/provider-runtime/src/utility-entry.ts`
- Create: `packages/provider-runtime/src/utility-runtime.ts`
- Modify: `packages/provider-runtime/src/index.ts`
- Create: `packages/provider-runtime/test/utility-runtime.test.mjs`
- Modify: `packages/data-service/package.json`
- Modify: `packages/provider-runtime/package.json`

**Interfaces:**

- Consumes: `UtilityControlMessage` and `UtilityStatusMessage`.
- Produces: `createUtilityRuntime(port)` for deterministic lifecycle behavior; launchable built `utility-entry.js` files; `ProviderLaunchRequest` keyed by a non-empty provider profile ID.

- [ ] **Step 1: Write failing data-utility tests**

Exercise a real in-memory port adapter. Assert one ready message, one stopped response to shutdown, ignored malformed input, and idempotent repeated shutdown. The mutation caught is a utility that never becomes ready or emits duplicate terminal states.

- [ ] **Step 2: Verify RED, implement minimal runtime, verify GREEN**

Run the focused test, implement only lifecycle state and message validation, then rerun it.

- [ ] **Step 3: Write failing provider-utility tests**

Assert the same lifecycle plus rejection of an empty provider profile identifier. Do not load an adapter or open a network connection.

- [ ] **Step 4: Verify RED, implement minimal runtime, verify GREEN**

Use the same versioned control protocol without sharing implementation-only state between workspaces.

- [ ] **Step 5: Add real Electron utility entry adapters**

Each entry reads `process.parentPort`, connects the package runtime to Electron's message port, reports a safe deterministic startup error when no parent port exists, and contains no secret/path echoing.

- [ ] **Step 6: Run focused tests, typecheck, and commit**

Commit: `ECDD-55: add utility process lifecycles`

---

### Task 4: Implement Secure Electron Main Lifecycle and Supervision

**Files:**

- Create: `packages/electron-main/src/window.ts`
- Create: `packages/electron-main/src/utility-supervisor.ts`
- Create: `packages/electron-main/src/application.ts`
- Modify: `packages/electron-main/src/index.ts`
- Create: `packages/electron-main/test/window.test.mjs`
- Create: `packages/electron-main/test/utility-supervisor.test.mjs`
- Create: `packages/electron-main/test/application.test.mjs`
- Modify: `packages/electron-main/package.json`

**Interfaces:**

- Consumes: Electron-like narrow adapters, `RuntimeInfo`, fixed IPC channel, renderer/preload/utility artifact paths.
- Produces: `secureWindowOptions(paths)`, `createUtilitySupervisor(adapter, options)`, and `startDesktopApplication(adapters, paths)`.

- [ ] **Step 1: Write failing secure-window option tests**

Assert the exact accepted web preferences, preload path, and absence of permissive overrides. The test must fail if any Node/sandbox/security flag is inverted.

- [ ] **Step 2: Verify RED, implement the pure window-options builder, verify GREEN**

Keep the builder free of Electron imports so the test exercises real production logic without graphical mocks.

- [ ] **Step 3: Write failing supervisor tests**

Use a deterministic fake child adapter to assert: bounded ready timeout, safe unexpected-exit status, renderer-independent failure, one shutdown request, forced termination after timeout, and idempotent cleanup.

- [ ] **Step 4: Verify RED, implement minimal supervisor, verify GREEN**

Timers are injected only as a narrow scheduler adapter so tests do not sleep; production uses real bounded timers.

- [ ] **Step 5: Write failing application lifecycle tests**

Assert IPC registration occurs before document load, data utility starts once, provider utility does not start at boot, activate recreates a missing window, non-macOS window close requests quit, and before-quit awaits cleanup.

- [ ] **Step 6: Verify RED, implement lifecycle composition, verify GREEN**

Return a small controller with idempotent `shutdown()`. Renderer-visible runtime info must contain only application name and IPC contract version.

- [ ] **Step 7: Run focused suites, typecheck, and commit**

Commit: `ECDD-55: implement secure Electron lifecycle`

---

### Task 5: Implement the Narrow Preload and Dummy Renderer

**Files:**

- Create: `packages/preload/src/bridge.ts`
- Create: `packages/preload/src/runtime-entry.ts`
- Modify: `packages/preload/src/index.ts`
- Create: `packages/preload/test/bridge.test.mjs`
- Create: `packages/renderer/src/development-shell.ts`
- Create: `packages/renderer/src/runtime-entry.ts`
- Modify: `packages/renderer/src/index.ts`
- Create: `packages/renderer/test/development-shell.test.mjs`
- Create: `apps/desktop/static/index.html`
- Create: `apps/desktop/static/styles.css`
- Create: `tools/build-runtime.mjs`
- Modify: `packages/preload/package.json`
- Modify: `packages/renderer/package.json`

**Interfaces:**

> Historical ECDD-55 interface: ECDD-59 replaces `renderDevelopmentShell` with
> the React `ApplicationShell` and `RuntimeApplicationShell` entry points.

- Consumes: fixed runtime-info channel and validator.
- Produces: `createErcChartBridge(invoke)`, `installBridge(expose, invoke)`, `renderDevelopmentShell(document, bridge)`, `preload.cjs`, `renderer.js`, copied HTML/CSS.

- [ ] **Step 1: Write failing preload bridge tests**

Assert the exposed object has exactly one own key, calls only the fixed channel with no arguments, returns valid runtime info, and rejects malformed responses with a safe error.

- [ ] **Step 2: Verify RED, implement bridge, verify GREEN**

Keep contextBridge/ipcRenderer imports in the runtime entry only; the public factory accepts narrow functions.

- [ ] **Step 3: Write failing renderer DOM tests**

With a real linkedom document, assert initial product/milestone/status content, connected state after a valid bridge response, and safe unavailable state for missing/rejected/malformed bridge responses. Assert the renderer path never needs `process`, `require`, or Electron.

- [ ] **Step 4: Verify RED, implement dummy shell, verify GREEN**

Use text content and stable semantic elements; no HTML injection, React, chart surface, tabs, layouts, controls, or production-theme claims.

- [ ] **Step 5: Write failing runtime-build integration test**

Execute the build script into a temporary directory and assert the preload output is CommonJS `.cjs`, renderer output is browser ESM, static assets exist, and no source path is embedded in renderer-visible content.

- [ ] **Step 6: Verify RED, implement esbuild/static copy script, verify GREEN**

The build script must fail on missing entry/static files and replace only its bounded generated runtime directory.

- [ ] **Step 7: Run focused tests, format/typecheck, and commit**

Commit: `ECDD-55: add sandboxed preload and dummy renderer`

---

### Task 6: Compose the Executable Desktop and Prove Boot

**Files:**

- Modify: `apps/desktop/src/index.ts`
- Create: `apps/desktop/src/paths.ts`
- Create: `apps/desktop/test/paths.test.mjs`
- Create: `tools/electron-smoke.mjs`
- Create: `tools/electron-smoke/preload-smoke.cjs`
- Modify: `apps/desktop/package.json`
- Modify: `package.json`

**Interfaces:**

- Consumes: built Electron main API and generated runtime artifacts.
- Produces: executable desktop composition entry, deterministic smoke-ready signal, `npm start`, and `npm run smoke:electron`.

- [ ] **Step 1: Write failing artifact-path tests**

Assert resolved paths target the built preload, renderer document, data utility, and provider utility relative to the executable module, independent of current working directory.

- [ ] **Step 2: Verify RED, implement path resolution, verify GREEN**

Validate required artifacts before starting Electron and return one safe startup error without exposing absolute paths to the renderer.

- [ ] **Step 3: Write the boot smoke harness before enabling the entry**

The harness builds artifacts, starts Electron with an isolated temporary user-data directory and smoke flag, and waits a bounded time for `ERC_CHART_SMOKE_READY`. The main process emits that marker only after the renderer reaches `Secure bridge connected` and verifies that Node globals remain unavailable. It then requests clean shutdown and exits non-zero on timeout, renderer failure, child leakage, or unsafe Node globals.

- [ ] **Step 4: Verify RED**

Run: `npm run smoke:electron`

Expected: FAIL because the desktop composition entry is not active.

- [ ] **Step 5: Implement desktop composition and verify GREEN**

Import real Electron adapters only in `apps/desktop`, call `startDesktopApplication`, preserve multiple independent instances by omitting single-instance locking, and keep provider launch idle.

- [ ] **Step 6: Run smoke twice and record duration**

Run the smoke command twice from a clean build. Both runs must reach renderer ready and exit zero without orphan utility processes. Record observational timing in the PR description, not as a release performance threshold.

- [ ] **Step 7: Commit**

Commit: `ECDD-55: compose bootable development shell`

---

### Task 7: Integrate Repository Gates and Delivery Evidence

**Files:**

- Modify: `package.json`
- Modify: `tsconfig.tests.json`
- Modify: `eslint.config.mjs` only if new runtime globals require a scoped override
- Modify: `docs/development/MONOREPO.md`
- Modify: `.github/workflows/delivery-gates.yml` only if the existing generic root commands do not discover the new smoke gate
- Modify: tests under changed packages as required by actual gate findings

**Interfaces:**

- Consumes: all ECDD-55 runtime packages and existing delivery governance.
- Produces: one deterministic local/CI verification sequence and current documentation for building/running the skeleton.

- [ ] **Step 1: Add every new test directory to the real root unit/integration commands**

Classify pure contract/lifecycle/DOM tests as unit tests and runtime-build/Electron boot tests as integration tests. Do not create a second hidden test path.

- [ ] **Step 2: Update developer documentation**

Document `npm start`, `npm run build:runtime`, and `npm run smoke:electron`; state that packaging and Development Version 1 remain deferred until ECDD-62 and the Epic 1 merge.

- [ ] **Step 3: Run focused mutation review**

For each new behavior, identify the wrong flag, wrong channel, malformed version, missing ready message, duplicate shutdown, provider-start-at-boot, or unavailable-bridge mutation that its test catches. Add a test only where a realistic mutation is unprotected.

- [ ] **Step 4: Run the fresh stop-on-error full suite**

Run in this order: delivery governance, workspace boundaries, format check, lint, typecheck, unit, integration, runtime build, Electron smoke, standard build, audit, and version check.

- [ ] **Step 5: Inspect generated artifacts and git diff**

Confirm generated `dist`/runtime output is ignored, no secret/path/debug dump is introduced, no later Epic 1 feature appears, and only ECDD-55 files changed.

- [ ] **Step 6: Commit final integration changes**

Commit: `ECDD-55: integrate Electron skeleton gates`

- [ ] **Step 7: Publish through the approved task-to-epic workflow**

Push `task/ECDD-55-electron-skeleton`, open a draft PR into `epic/ECDD-53-repository-build`, move Jira to `state-review`, wait for Delivery Gates, Semgrep, CodeRabbit, and current-head Qodo, fix verified findings test-first, require zero unresolved threads, and squash merge only when every required gate passes.
