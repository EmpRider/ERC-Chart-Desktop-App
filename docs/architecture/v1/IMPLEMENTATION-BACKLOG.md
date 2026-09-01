# ERC-chart MVP Implementation Backlog

Version: 1.0 draft
Ordering: dependency order, not a calendar estimate

## Global definition of done

An item is done only when:

- production code and automated tests are complete;
- public/internal contracts are versioned and documented;
- expected failure paths are tested;
- privileged boundaries validate inputs and redact secrets;
- performance-sensitive code has measurements;
- no deferred feature is exposed as partially working UI;
- Windows x64 packaging remains buildable.

## Epic 0 — Architecture validation spikes

### Deliverables

- freeze provider, indicator, IPC, manifest, workspace, and market-data contract version 1;
- Binomo test-account protocol validation;
- confirm Windows Credential Manager bridge approach;
- prove SQLite WAL access from two independent ERC-chart processes;
- prototype four klinecharts instances with synthetic 100,000-candle data, required interactions, and thin presentation/overlay extensions;
- prototype one Node-disabled indicator worker per instance and measure 20 workers;
- select final minimum PC based on prototype measurements.

### Exit criteria

- no unresolved feasibility blocker;
- protocol findings are recorded without credentials;
- performance figures establish a viable rendering/worker approach;
- high-risk assumptions in the architecture are accepted or replaced through ADRs.

## Epic 1 — Repository, build, and secure desktop shell

### Deliverables

- TypeScript monorepo/package boundaries;
- Electron main, preload, sandboxed renderer, data utility, provider utility, and SDK packages;
- strict lint/type/test gates;
- `erc-app://` custom protocol;
- CSP, navigation denial, IPC sender validation, and Electron fuse policy;
- React dark-theme shell;
- tab and one-to-four chart layout model;
- multiple application instances;
- NSIS x64 installer pipeline with auto-update disabled.

### Exit criteria

- clean Windows 10/11 smoke install launches the sandboxed shell;
- renderer has no Node globals;
- unauthorized IPC and navigation tests pass;
- two independent application instances can run.

## Epic 2 — Local database, workspace, and credentials

### Deliverables

- SQLite schema and migration runner;
- WAL, busy timeout, transactions, and corruption recovery;
- provider-profile metadata;
- Windows Generic Credential create/read/delete;
- workspace version 1 serializer/validator;
- settings and plugin registry persistence;
- local redacted rotating log service.

### Exit criteria

- two processes concurrently read/upsert candles without corruption;
- workspace restores tabs/layouts/charts/indicators but contains no drawings;
- automated scans find no plaintext test secret in DB, workspace, log, argv, or environment;
- Credential Manager failure has no plaintext fallback.

## Epic 3 — Provider SDK and plugin installer

### Deliverables

- provider contract test kit;
- manifest JSON Schema and runtime validator;
- ZIP/folder staging and validation;
- traversal/link/size/extension/integrity defenses;
- signed-production and unsigned-Developer-Mode policy;
- versioned activation, disable, uninstall, and rollback;
- provider utility-process supervisor and MessagePort protocol;
- permission review UI.

### Exit criteria

- malicious package fixtures are rejected;
- incompatible API versions cannot activate;
- a provider crash does not close the renderer;
- Production Mode cannot load unsigned packages;
- no install/build script executes.

## Epic 4 — Market-data service and Binomo adapter

### Deliverables

- normalized candle/tick validation;
- typed-array series store and revisions;
- historical cache, newest-N query, de-duplication, gap repair, and retention;
- building/finalized candle state machine;
- provider-declared timeframe/alignment/derivation support;
- bounded live tick buffers;
- feed/subscription multiplexing across chart slots;
- Binomo history and live adapter;
- reconnect/backoff/heartbeat/resubscription and authentication UX;
- instrument/timeframe selector data.

### Exit criteria

- test profile loads history and updates a building candle;
- reconnect repairs a deliberately created gap;
- duplicate, malformed, out-of-order, and obsolete responses follow deterministic tests;
- TLS validation remains enabled;
- no browser tab/hook is needed.

## Epic 5 — Chart integration (klinecharts)

### Deliverables

- klinecharts v10 integration in `@erc-chart/renderer`;
- data-service to klinecharts data adapter (candle feed, building candle updates);
- presentation modes for candlestick, area, and line (area mode with transparent fill, or a thin presentation extension only if parity requires it);
- axes, grid, live-price marker, status bar through klinecharts API;
- pointer-anchored wheel zoom, horizontal pan, and future space;
- X/Y-axis drag and reset;
- crosshair and OHLC/change hover;
- Jump to Latest;
- resize and device-pixel-ratio handling;
- cancellation/generation handling on series changes;
- klinecharts theme configuration matching ERC-chart dark theme.

### Exit criteria

- behavioral tests match the confirmed reference interactions;
- obsolete symbol/timeframe responses never appear;
- synthetic four-chart workload meets the provisional frame target or produces an approved replacement ADR;
- klinecharts version is pinned and validated against 100,000-candle dataset.

## Epic 6 — klinecharts drawing integration

### Deliverables

- klinecharts built-in overlays for trend, horizontal, vertical, and Fibonacci tools;
- thin klinecharts overlay extensions using `rect` and `text` figures for rectangle and free-text tools;
- no custom chart engine, coordinate renderer, or MVP undo/redo stack;
- drawing style/theme alignment with ERC-chart design;
- delete and style editing through klinecharts API;
- per-chart isolation and cleanup on chart/tab close;
- session-only lifecycle: drawings are not persisted in workspace schema v1.

### Exit criteria

- each tool has creation/edit/delete tests through klinecharts APIs and the thin rectangle/text extensions;
- pan/zoom preserves drawing anchoring (klinecharts native behavior);
- restart proves drawings are intentionally absent while the workspace restores.

## Epic 7 — Indicator SDK and runtime

### Deliverables

- TypeScript/JavaScript SDK and examples;
- configuration/input/output/plot declarations;
- history, tick, bar, and disposal lifecycle;
- one Node-disabled Web Worker per active instance;
- typed-array snapshot plus incremental deltas;
- five-indicator chart limit;
- MTF access;
- explicit cross-indicator bindings and dependency DAG;
- line, hline, histogram, band/fill, shape, line segment, box, and text plots;
- generation/revision rejection, budgets, quotas, termination, and bounded restart;
- inert `SignalCandidate` contract.

### Exit criteria

- contract fixture plugins pass;
- missing/circular dependencies are rejected before calculation;
- a hung worker is terminated without affecting another indicator/chart;
- stale output cannot render after a config/data generation change;
- no signal broadcast or consumer UI exists.

## Epic 8 — Workspace integration and UX hardening

### Deliverables

- end-to-end provider profile flow;
- symbol/timeframe/chart-type controls;
- plugin manager and Developer Mode warning;
- indicator selection/configuration/panel controls;
- clear connection/stale/auth/error states;
- last-workspace autosave/restore;
- keyboard/focus/accessibility pass for non-canvas controls;
- first-run and empty-state guidance for basic users.

### Exit criteria

- a new user can install, connect, open four charts, add indicators, draw, restart, and restore the workspace without developer tools;
- secrets never reappear in normal UI after save;
- errors contain recovery actions.

## Epic 9 — Release hardening

### Deliverables

- full stress, fault, security, and multi-instance tests;
- Windows 10/11 x64 installer matrix;
- dependency and license inventory;
- code-signing integration when certificate is available;
- local support diagnostics review;
- migration/upgrade rehearsal;
- release checklist and known limitations.

### Exit criteria

- all MVP release gates in the architecture specification pass;
- no high/critical unresolved security issue;
- performance passes on the agreed minimum PC;
- setup/uninstall and upgrade preserve intended user data;
- the release clearly identifies post-MVP exclusions.

## Post-MVP Epic 10 — Signal broadcasting

- signal bus;
- consumer plugin contract;
- routing/filtering;
- idempotency, retry, dead-letter, and audit;
- provisional/finalized delivery rules;
- failure and privacy model.

## Post-MVP Epic 11 — Replay and backtesting

- replay clock;
- live-like indicator execution;
- compute workers;
- backtest configuration/results;
- trade navigation;
- reference behavior parity catalogue closure.

## Post-MVP Epic 12 — Execution and analysis

- separate security/risk architecture approval;
- trade execution;
- result monitoring;
- trade history/P&L;
- optional stake modes;
- optimizer/reporting.
