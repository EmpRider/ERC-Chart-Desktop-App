# ERC-chart Architecture Decision Records

Version: 1.0 draft
Date: 2026-07-30

Statuses:

- **Accepted**: directly confirmed by the product owner or required by an accepted product constraint.
- **Proposed**: architecture baseline selected for implementation planning; change requires an explicit replacement ADR.
- **Deferred**: intentionally not implemented in the MVP.

## ADR-001 — Implement ERC-chart from zero

Status: **Accepted**

### Context

The supplied Signal project contains useful chart, indicator, Binomo, replay, backtesting, and execution behavior. The product owner explicitly requires a new architecture rather than a migration of that codebase.

### Decision

Use the Signal project only for behavioral evidence, protocol investigation, parity tests, and the post-MVP feature catalogue. Do not copy its application architecture or treat its source modules as the ERC-chart foundation.

### Consequences

- New contracts can be provider-neutral and desktop-native.
- Existing indicators do not need to load unchanged.
- Behavioral parity must be expressed as tests rather than shared code.
- Delivery must budget for reimplementation rather than wrapping the userscript.

## ADR-002 — Windows 10/11 x64 Electron and TypeScript baseline

Status: **Proposed**

### Context

The MVP is a Windows `.exe`, and all third-party authoring is JavaScript/TypeScript. The application needs multiple windows/processes, local storage, secure OS integration, canvas UI, and plugin workers.

### Decision

Use a current supported Electron release with strict TypeScript, a React application shell, and an independent TypeScript chart engine. Build an x64 NSIS `.exe` through electron-builder.

### Consequences

- One language and contract model spans the application and SDK.
- Electron/Chromium security updates become release responsibilities.
- Memory performance must be tested under the full four-chart workload.
- The chart engine must not import Electron or React.

## ADR-003 — Privilege and failure boundaries

Status: **Proposed**

### Context

Provider I/O, SQLite operations, chart rendering, and indicator calculation have different privilege and performance characteristics.

### Decision

Use:

- Electron main process for lifecycle, privileged OS APIs, plugin installation, and process supervision;
- a sandboxed, Node-disabled renderer for UI and chart rendering;
- a data-service utility process for SQLite, series state, aggregation, and feed routing;
- a supervised provider utility process per active provider profile;
- a Node-disabled Web Worker per active indicator instance.

### Consequences

- Provider/indicator crashes remain local.
- IPC contracts and supervision are mandatory.
- Additional process memory is accepted to obtain responsiveness and containment.
- A provider utility process is not a complete malicious-code sandbox; Production Mode must require trust.

## ADR-004 — Custom layered Canvas 2D chart engine

Status: **Proposed**

### Context

The required interactions, indicator primitives, transient drawings, and 100,000-candle data model need predictable behavior. The reference demonstrates the viability of Canvas 2D when only visible data is rendered.

### Decision

Build a custom layered Canvas 2D engine from zero. Store series in typed arrays, render only the visible interval, use dirty layers, and use density reduction for line/area charts.

### Consequences

- ERC-chart controls exact interaction and plugin behavior.
- The engine can later adopt WebGL behind its renderer interface if measurements require it.
- Accessibility and non-canvas controls remain in the React shell.
- Renderer performance tests become a release gate.

## ADR-005 — Versioned, capability-declared plugin packages

Status: **Proposed**

### Context

Plugins are installed from ZIP/folders; there is no MVP store. JavaScript and TypeScript are the only authoring languages. Unsigned plugins are allowed only in Developer Mode.

### Decision

Require `plugin.json`, a compatible host API range, a precompiled ESM JavaScript entry, declared permissions/capabilities, and package integrity metadata. Never run package scripts or native executables.

Production Mode loads trusted signed packages only. Developer Mode may load unsigned packages after an explicit warning and restart.

### Consequences

- TypeScript authors compile before packaging.
- Plugin installation is deterministic and does not need npm.
- Provider permissions and trust are visible.
- A future store can reuse the same package contract.

## ADR-006 — SQLite WAL for non-secret local state

Status: **Proposed**

### Context

ERC-chart caches historical candles, saves workspaces/settings, tracks plugins, and allows multiple application instances.

### Decision

Use a local per-user SQLite database in WAL mode with migrations, short transactions, unique candle keys, batched upserts, a busy timeout, and bounded retries.

### Consequences

- Readers and a writer can operate concurrently on the same computer.
- All database access must remain local; a network share is unsupported.
- Multi-instance write contention must be tested.
- Cached market data is rebuildable; workspace data needs atomic writes and migration coverage.

## ADR-007 — Windows Credential Manager for provider secrets

Status: **Accepted**

### Context

The user confirmed Windows Credential Manager. The supplied Python proof of concept contains an embedded credential that must not be repeated.

### Decision

Use Generic Credentials through core-owned `CredWriteW`/`CredReadW` integration. Store only credential target references in SQLite. No plaintext fallback is allowed.

### Consequences

- The core includes a small signed Windows-specific bridge.
- Credentials are unavailable on unsupported platforms, which is acceptable for this MVP.
- Profile deletion must remove the matching Generic Credential.
- Tests must prove secrets never enter logs, argv, environment variables, workspace, or database.

## ADR-008 — Four charts per window; multiple independent application instances

Status: **Accepted**

### Context

The user specified a maximum of four charts per window and additional windows as separate application instances.

### Decision

Do not enforce a single-instance application lock. Each instance owns its window/renderers/services and may share the per-user SQLite cache under the concurrency rules in ADR-006.

### Consequences

- Multiple instances may open separate provider connections.
- Workspace-session saves must avoid silently overwriting the same named workspace.
- Performance testing includes at least two concurrent instances.

## ADR-009 — Provider-owned capability and timeframe declaration

Status: **Accepted**

### Context

Supported timeframes must come from the provider adapter, not from a global hard-coded list.

### Decision

Each provider declares instruments, native historical timeframes, live capabilities, optional derived timeframes, and bar alignment. The core exposes only compatible choices for the selected series.

### Consequences

- A provider may add or remove a timeframe without a core release.
- Indicator MTF access is validated against current provider capabilities.
- Generic aggregation is allowed only when the adapter supplies safe alignment and base-timeframe metadata.

## ADR-010 — 100,000 active candles and five indicators per chart

Status: **Accepted**

### Context

These are explicit product limits and define the stress workload.

### Decision

Enforce a hard active-series limit of 100,000 candles and five active indicator instances in each chart slot. Use typed arrays, incremental updates, off-UI-thread calculations, and bounded plot output.

### Consequences

- The UI must explain the limit rather than silently truncating an arbitrary range.
- Indicator plugins cannot allocate unlimited history or drawing objects.
- The exact minimum PC remains a release decision based on measured results.

## ADR-011 — Persist workspaces but not drawings in MVP

Status: **Accepted**

### Context

Local workspaces are required, while saving drawings with a workspace was explicitly excluded from the MVP.

### Decision

Workspace schema version 1 stores tabs, layouts, chart configuration, viewport, and indicators. Drawing objects live only in renderer memory and are discarded on application exit.

### Consequences

- Drawing undo/redo is session-only.
- The schema reserves no ambiguous drawing field.
- Adding drawing persistence later requires a new workspace schema version and migration.

## ADR-012 — Define signal candidates; defer signal runtime

Status: **Accepted / Deferred implementation**

### Context

The reference indicators can emit signals, but the product owner moved signal broadcasting to the first post-MVP phase.

### Decision

Freeze a minimal versioned `SignalCandidate` data shape in the indicator SDK. Do not implement consumer plugins, external delivery, routing, retry, persistence, or broadcasting in the MVP.

### Consequences

- Indicator APIs remain forward-compatible.
- Signal controls must not appear as partially functional MVP UI.
- Post-MVP Phase 1 owns delivery semantics and reliability.

## ADR-013 — Historical cache is not an offline mode

Status: **Accepted**

### Context

Historical caching is required, but the user explicitly does not require an offline mode.

### Decision

Use cache for warm start and gap reduction. When disconnected, clearly label data stale and disable live-dependent behavior. Do not market or test a complete offline workflow.

### Consequences

- Startup may render cached data before a connection becomes Live.
- Offline correctness, long-term stale-data navigation, and offline plugin behavior are not MVP acceptance requirements.

## ADR-014 — Binomo is an isolated first-party adapter

Status: **Accepted**

### Context

The supplied JavaScript and Python prove historical/live Binomo access, but the observed interfaces may not be a stable public API.

### Decision

Implement Binomo as a first-party TypeScript provider plugin behind the generic provider contract. Run a protocol/terms validation spike before committing the production adapter. Never use a browser WebSocket hook or disabled TLS verification.

### Consequences

- Protocol changes affect the adapter rather than chart core.
- Release depends on confirming authentication, instruments, timeframes, TLS, rate limits, and permitted use.
- The reference credential must be rotated if valid.
