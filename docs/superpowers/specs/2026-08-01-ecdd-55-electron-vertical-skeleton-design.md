# ECDD-55 Electron Vertical Skeleton Design

Date: 2026-08-01
Status: approved
Owner: EmpRider
Jira: ECDD-55
Parent epic: ECDD-53

## Purpose

Create the smallest executable vertical skeleton that proves the accepted ERC
Chart desktop process boundaries. A built Electron application must start,
create a sandboxed renderer window, expose one narrow typed preload bridge, and
render deterministic dummy content. The data-service and provider-runtime
packages must also contain launchable utility-process entry points, while the
provider and indicator SDK packages expose only the minimum versioned authoring
interfaces needed to establish their public boundaries.

This task proves composition and isolation. It does not implement product
features assigned to later Epic 1 tasks.

## Confirmed constraints

- Build from the ECDD-54 monorepo on `task/ECDD-55-electron-skeleton`, targeting
  `epic/ECDD-53-repository-build`.
- Use Electron 43.2.0 and strict TypeScript.
- The renderer uses `nodeIntegration: false`,
  `nodeIntegrationInWorker: false`, `contextIsolation: true`, `sandbox: true`,
  and `webSecurity: true`.
- Preload exposes an application-specific object only. It never exposes raw
  `ipcRenderer`, Electron modules, filesystem access, process access, or a
  generic send/invoke function.
- Provider and indicator failures must remain outside the renderer and must not
  terminate the application shell.
- Provider and indicator plugin authoring remains JavaScript/TypeScript only;
  no native executable, Python, package-install script, or runtime TypeScript
  compiler is introduced.
- No secrets, credentials, database behavior, provider protocol behavior,
  chart behavior, or drawings are implemented.
- Auto-update remains disabled.

## Approaches considered

### 1. Targeted Electron skeleton with small boundary-specific bundles — selected

Compile the Node-side TypeScript packages normally. Produce a single bundled
CommonJS preload artifact because a sandboxed Electron preload cannot import
ES modules. Produce a browser-compatible renderer artifact plus static HTML,
without introducing React or a general development server. Keep Electron
lifecycle, window construction, and process supervision in their owning
packages.

This adds only the build capability required by the real runtime boundaries,
keeps the existing package ownership intact, and leaves React and the custom
protocol to their assigned tasks.

### 2. Introduce a full Electron/Vite/React application toolchain now

This would make live development convenient, but it would pull React shell,
asset routing, development-server behavior, and later Epic 1 decisions into
ECDD-55. It is rejected as premature scope and unnecessary dependency surface.

### 3. Use handwritten JavaScript and static files outside the package model

This would boot with little tooling, but it would bypass the strict TypeScript
contracts and public package boundaries established by ECDD-54. It is rejected
because the resulting proof would not exercise the architecture that future
tasks must extend.

## Architecture

### Desktop composition

`apps/desktop` is the executable composition root. It supplies resolved paths
for the built preload, renderer document, data-service utility entry, and
provider-runtime utility entry to `packages/electron-main`. It contains no
window-security policy or SDK business logic.

The executable performs no single-instance locking. That preserves the
accepted requirement that two independent application instances can run; the
full multi-instance acceptance test remains owned by its later Epic 1 task.

### Electron main

`packages/electron-main` owns:

- application ready/activate/window-all-closed lifecycle;
- creation of the initial `BrowserWindow`;
- the frozen secure `webPreferences` values;
- registration of the one skeleton IPC handler before renderer load;
- startup and orderly termination of the data utility process;
- a provider utility-process launcher that remains idle until a profile is
  requested; and
- local reporting of utility-process exit without closing the renderer.

The window loads the local renderer document with `loadFile` as an explicit
temporary boot mechanism. ECDD-57 replaces that mechanism with `erc-app://`.
Navigation denial, full sender authorization, CSP hardening, Electron fuses,
and the final protocol policy remain in their assigned later tasks and are not
represented as complete here.

Main exports focused lifecycle and window-factory functions that accept narrow
adapters. Tests inspect actual option values and lifecycle behavior without
opening a graphical window.

### Preload bridge

`packages/preload` owns the versioned renderer bridge type and its installation
function. The runtime artifact is a single CommonJS bundle suitable for an
Electron sandboxed preload.

The initial global is `window.ercChart`. It exposes only:

```ts
interface ErcChartBridge {
  getRuntimeInfo(): Promise<RuntimeInfo>;
}

interface RuntimeInfo {
  readonly ipcContractVersion: ContractVersion;
  readonly applicationName: "ERC Chart";
}
```

`getRuntimeInfo` invokes one fixed, namespaced channel. It accepts no renderer
input and returns no version details for Node.js, Chromium, Electron, operating
system, filesystem, or environment. The result is validated before it crosses
the bridge.

### Dummy renderer

`packages/renderer` owns a browser-only `renderDevelopmentShell` function and a
minimal document entry. It renders deterministic content into a required root
element:

- product name: `ERC Chart`;
- milestone label: `Development shell`;
- process status while starting; and
- `Secure bridge connected` after a valid `RuntimeInfo` response.

An unavailable or malformed bridge produces a visible `Shell unavailable`
state and a safe message. The dummy page contains no chart, provider controls,
tabs, layouts, settings, React, or production-theme claim.

### Utility-process entry points

`packages/data-service` defines a launchable utility entry with a minimal
versioned ready/shutdown control protocol. It owns no SQLite, series, workspace,
or feed behavior in this task. Main launches it once per application instance,
waits for readiness with a bounded timeout, and terminates it during orderly
shutdown.

`packages/provider-runtime` defines the same lifecycle shape for a provider
utility entry, plus a launcher contract keyed by a provider-profile identifier.
No provider process is started at boot because no active provider profile
exists. No adapter is loaded, and no network connection or credential transfer
occurs.

Unexpected utility exit is converted into a safe local status event. It is not
allowed to close the application window or expose raw error content to the
renderer.

### SDK public surfaces

The SDKs freeze only interfaces already required by the accepted architecture.

`packages/provider-sdk` exports:

- versioned plugin identity and host compatibility metadata;
- provider capability declarations for instruments, native timeframes, live
  data, and optional derived-timeframe support;
- a provider adapter lifecycle with `connect`, `disconnect`, capability read,
  historical request, and subscription entry points; and
- normalized `Candle`/`Tick` output types imported from `packages/contracts`.

It does not define Binomo fields, authentication storage, reconnect policy,
manifest installation, or runtime loading.

`packages/indicator-sdk` exports:

- versioned plugin identity and host compatibility metadata;
- declarative inputs, outputs, plots, and live-tick requirement;
- history, building-bar, finalized-bar, tick, and disposal lifecycle shapes;
  and
- the inert versioned `SignalCandidate` data shape accepted by ADR-012.

It does not execute algorithms, create workers, enforce budgets, resolve
dependencies, render plots, or broadcast signals.

All SDK values crossing a process or plugin boundary carry the applicable
contract version. Unknown or malformed versions fail closed in boundary
validators; implementation-only objects never cross those boundaries.

## Runtime flow

1. The desktop composition root starts Electron main with resolved artifact
   paths.
2. Main registers the fixed runtime-info handler and starts the data utility.
3. After application readiness, main creates one secure window and loads the
   local renderer document.
4. The sandboxed preload installs `window.ercChart`.
5. The renderer requests `RuntimeInfo`, validates it, and changes the dummy
   status to `Secure bridge connected`.
6. A smoke mode records renderer readiness and exits cleanly without changing
   normal application behavior.
7. On application shutdown, main requests data-utility shutdown and applies a
   bounded forced termination only if it does not exit.

## Failure behavior

- Missing renderer, preload, or utility artifacts fail startup with a safe,
  deterministic error and a non-zero smoke-test result.
- Data utility startup timeout is reported as unavailable; no unbounded wait is
  permitted.
- A provider utility failure affects only that provider launcher instance.
- A bridge response with an unsupported IPC contract version is rejected by the
  renderer.
- Raw thrown objects, stack traces, paths, environment values, and credentials
  do not cross into renderer-visible messages.
- Cleanup is idempotent so partial startup cannot leave child processes alive.

## Testing and verification

Implementation follows test-driven development. Tests must first fail for the
missing behavior and then pass with the smallest implementation.

Required evidence:

- contract tests for bridge, utility lifecycle, provider SDK, indicator SDK,
  and inert `SignalCandidate` shapes;
- unit tests for exact secure `BrowserWindow` preferences and lifecycle events;
- tests proving preload exposes only the fixed bridge methods;
- DOM tests for connected and unavailable dummy-renderer states without Node
  globals;
- utility-process readiness, timeout, unexpected-exit, and idempotent-shutdown
  tests;
- an Electron boot smoke test that reaches renderer-ready state and exits zero;
- unchanged workspace-boundary, format, lint, strict type-check, unit,
  integration, build, audit, and version gates; and
- no installer or release claim from ECDD-55.

Performance-sensitive loops are not introduced. The PR records startup timing
for the boot smoke test as observational evidence, not as the final release
performance gate.

## Out of scope

- `erc-app://` and `erc-plugin://`;
- final CSP, navigation/new-window denial, IPC sender authorization, and
  Electron fuse policy;
- React, dark-theme production shell, tabs, layouts, and chart slots;
- chart rendering or indicators executing in workers;
- SQLite, workspace persistence, Credential Manager, or provider credentials;
- provider installation, adapter loading, Binomo protocol, and network access;
- NSIS packaging, installer smoke tests, checksums, tags, and releases; and
- auto-update behavior.

## Delivery and Development Version 1 milestone

ECDD-55 is delivered through the approved task-to-epic workflow: deterministic
gates, Semgrep, CodeRabbit, stable-head Qodo review when available, resolved
threads, and squash merge into `epic/ECDD-53-repository-build`.

The application does not merge to `main` or publish a release immediately after
ECDD-55. The remaining Epic 1 tasks must first complete the custom protocol,
security hardening, React shell/layout work, multi-instance proof, and ECDD-62
Windows packaging/release automation.

When all Epic 1 exit criteria pass, the epic-to-`main` pull request uses
Delivery Gates, Semgrep, CodeRabbit, stable-head Qodo evidence when available,
and Code Review AI. The reviewed merge sets application version
`0.1.0-dev.1`, and the release workflow publishes the exact tested `main`
commit as a GitHub pre-release named Development Version 1 under immutable Git
tag `v0.1.0-dev.1`, with:

```text
ERC-Chart-Setup-0.1.0-dev.1.exe
ERC-Chart-Setup-0.1.0-dev.1.exe.sha256
```

The release notes identify it as the Epic 1 development shell, list known
limitations, state whether the executable is signed, and keep automatic updates
disabled. A failed test, package, smoke, or checksum step creates no published
tag or release.

The later stable Epic 1 release remains `v0.1.0`; the development pre-release
does not consume or move that stable tag.

## Acceptance criteria

- A clean build produces an executable Electron entry and all required runtime
  artifacts.
- The Electron app reaches the deterministic dummy renderer-ready state.
- The window security preferences exactly match the accepted sandbox baseline.
- The renderer has no Node globals and receives no raw Electron API.
- The bridge contains only `getRuntimeInfo` and rejects malformed or unsupported
  results.
- The data utility starts, reports ready, and shuts down; provider utility
  launch contracts are present without starting a provider at boot.
- Provider and indicator SDK public interfaces are versioned, documented, and
  restricted to the approved responsibilities.
- Expected startup, bridge, utility-exit, and shutdown failures are tested and
  contained.
- All repository gates pass and Windows packaging remains explicitly deferred
  to ECDD-62.
- No later Epic 1 feature is exposed as partially working UI.
