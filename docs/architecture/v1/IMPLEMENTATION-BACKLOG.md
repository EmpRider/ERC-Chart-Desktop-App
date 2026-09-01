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
- permission review UI;
- public provider-definition/registration helper or equivalent stable contract for plugin metadata, config declaration, compatibility, and adapter creation;
- minimal provider adapter surface with `connect`, `disconnect`, `getCapabilities`, `getInstruments`, `requestHistory`, and `subscribe`, with `unsubscribe` owned by the returned subscription handle;
- provider-neutral instrument contract and discovery flow suitable for desktop symbol/instrument selectors;
- capability metadata that distinguishes native history/live behavior, tick-vs-candle delivery, and safe timeframe-derivation/alignment facts;
- restricted provider host services for brokered network access, credential leases, logging, time, and status reporting without exposing Electron/Node/filesystem/database internals;
- TypeScript provider examples covering both a tick-producing provider and a candle-producing provider;
- explicit provider/data-service responsibility boundary that keeps storage, gap policy, canonical revisions, tick-to-candle construction, general MTF aggregation, renderer updates, and indicator distribution outside provider plugins;
- dynamic provider-profile configuration model that distinguishes credentials, connection settings, endpoint/environment settings, provider-declared options, and capability-affecting fields;
- controlled provider reconfigure/reconnect/restart semantics so configuration changes cannot mutate an active adapter unpredictably;
- invalidation/resubscription hooks for chart and indicator consumers affected by provider-profile changes.

### Exit criteria

- malicious package fixtures are rejected;
- incompatible API versions cannot activate;
- a provider crash does not close the renderer;
- Production Mode cannot load unsigned packages;
- no install/build script executes;
- a provider can be authored and instantiated using only the public provider SDK contract without chart, storage, indicator, or renderer internals;
- provider instrument discovery supplies normalized instruments to the application selector path;
- tick and candle providers both normalize live events through the same provider/runtime -> Data Service boundary;
- provider-specific history paging/timestamp behavior remains inside the adapter while cache/gap decisions remain inside Data Service;
- provider capability metadata is sufficient for Data Service to accept native timeframes or safely derive supported timeframes without provider-owned general aggregation;
- provider configuration changes are validated and either applied through a documented safe transition or rejected with a stable error;
- secrets remain in Windows Credential Manager and never enter workspace/plugin configuration documents.

## Epic 4 — Market-data service and Binomo adapter

### Deliverables

- normalized candle/tick validation;
- typed-array series store and revisions;
- historical cache, newest-N query, de-duplication, gap repair, and retention;
- building/finalized candle state machine;
- provider-declared timeframe/alignment/derivation support;
- bounded live tick buffers;
- feed/subscription multiplexing across chart slots;
- provider-neutral series acquisition/subscription APIs usable by both chart and indicator consumers;
- canonical sharing/deduplication of compatible upstream series/subscriptions while keeping consumer state isolated;
- deterministic snapshot + building-bar replacement + finalized-bar append delta model;
- Binomo history and live adapter;
- Binomo-specific history chunk/paging, retry/rate-limit interpretation, and closing-time-to-opening-time normalization inside the Binomo adapter;
- explicit instrument identity on normalized Binomo live events rather than assuming the stream contains only the visible symbol;
- real Binomo provider transport through the provider runtime/network broker with no dependency on a Binomo browser tab or WebSocket monkey patch;
- reconnect/backoff/heartbeat/resubscription and authentication UX;
- instrument/timeframe selector data.

### Exit criteria

- test profile loads history and updates a building candle;
- reconnect repairs a deliberately created gap;
- duplicate, malformed, out-of-order, and obsolete responses follow deterministic tests;
- TLS validation remains enabled;
- no browser tab/hook is needed;
- chart and indicator consumers can share a canonical upstream series without duplicating provider subscriptions unnecessarily;
- derived timeframe building bars update incrementally using provider-declared alignment metadata;
- Binomo provider code contains no direct klinecharts, indicator-runtime, workspace, SQLite, or general MTF-aggregation dependency.

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
- klinecharts theme configuration matching ERC-chart dark theme;
- renderer-side adapter for klinecharts technical-indicator configuration events so parameter/style edits can be normalized into ERC-chart indicator-instance configuration.

### Exit criteria

- behavioral tests match the confirmed reference interactions;
- obsolete symbol/timeframe responses never appear;
- synthetic four-chart workload meets the provisional frame target or produces an approved replacement ADR;
- klinecharts version is pinned and validated against 100,000-candle dataset;
- klinecharts settings edits do not remain ephemeral chart-only state and can be persisted/restored through ERC-chart configuration.

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
- clean authoring surface with no public `ctx` or runtime-context object exposure;
- direct canonical series aliases such as `open`, `high`, `low`, `close`, `volume`, `hl2`, `hlc3`, and `ohlc4`;
- `ta.*` technical-analysis helper family with concise positional overloads and object/named-parameter forms;
- default source/timeframe rules (`close` and active chart timeframe unless function semantics state otherwise);
- canonical TA signature/metadata registry where practical so TypeScript overloads, runtime normalization, history requirements, and docs stay synchronized;
- internal normalization of every `ta.*` invocation into a provider-neutral dependency/request representation;
- independent, incremental, silent data handling for each distinct `ta.*` dependency;
- history/warm-up requirement discovery per TA function, including composed/nested requirements;
- provider-native MTF resolution and safely derived MTF fallback using provider-declared alignment metadata;
- no visible-chart timeframe side effect when an indicator requests another timeframe;
- compatible upstream series/subscription deduplication through the data service;
- configuration/input/output/plot declarations;
- explicit distinction between calculation-affecting inputs and presentation-only style settings;
- normalized `IndicatorInstanceConfig` runtime model separate from immutable plugin definition metadata;
- klinecharts settings synchronization: calculation changes increment configuration generation, style-only changes avoid unnecessary recalculation/data reload;
- workspace persistence/restore of normalized indicator inputs and presentation settings, including changes originating from klinecharts UI;
- history, tick, bar, and disposal lifecycle;
- one Node-disabled Web Worker per active instance;
- typed-array snapshot plus incremental deltas;
- separate tracking of source-data revision and indicator-configuration generation;
- stale result rejection after data, provider, instrument, timeframe, dependency, or configuration changes;
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
- no signal broadcast or consumer UI exists;
- `ta.rsi(14)` resolves to current timeframe + `close`;
- `ta.rsi(14, open)` resolves to current timeframe + `open`;
- `ta.rsi(14, "1h")` resolves to `1h` + `close` without changing the chart timeframe;
- object-form and equivalent positional overloads normalize to equivalent semantics;
- equivalent TA dependencies share upstream data acquisition where safe;
- different timeframe dependencies can load/fail/update independently;
- live updates use bounded deltas rather than retransmitting/recalculating complete history when unnecessary;
- unsupported MTF requests fail through a stable provider-neutral error;
- changing an RSI length through klinecharts settings invalidates old-generation calculation output;
- changing only an indicator line color does not trigger provider history reload or TA recalculation;
- workspace save/restore preserves settings edited through klinecharts UI;
- plugin code cannot access internal context, klinecharts instances, Electron/Node, provider adapters, storage, credentials, or transport internals.

## Epic 8 — Workspace integration and UX hardening

### Deliverables

- end-to-end provider profile flow;
- symbol/timeframe/chart-type controls;
- plugin manager and Developer Mode warning;
- indicator selection/configuration/panel controls;
- unified indicator configuration flow so ERC-chart controls, klinecharts native settings, workspace restore, and plugin defaults converge on one validated instance model;
- clear connection/stale/auth/error states;
- last-workspace autosave/restore;
- keyboard/focus/accessibility pass for non-canvas controls;
- first-run and empty-state guidance for basic users.

### Exit criteria

- a new user can install, connect, open four charts, add indicators, draw, restart, and restore the workspace without developer tools;
- secrets never reappear in normal UI after save;
- errors contain recovery actions;
- indicator input/style edits survive restart regardless of whether the edit originated in ERC-chart UI or the klinecharts indicator settings UI.

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
