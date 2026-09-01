# ERC-chart Contract Baseline v1

## Status

- Baseline ID: `erc-contract-baseline-v1`
- Contract generation: `1`
- Status: frozen for implementation
- Owner: `EmpRider`
- Effective gate: ECDD-54 TypeScript monorepo implementation
- Source architecture: `ERC-chart-Architecture-Specification-v1.md`

This document freezes names, ownership, dependency direction, and version identifiers. It does not claim that TypeScript interfaces, JSON Schemas, database migrations, or runtime implementations already exist.

## Workspace units

ECDD-54 must create or preserve these logical units. A unit may initially contain only configuration, contracts, or test fixtures, but its public responsibility must remain stable.

| Unit | Responsibility | May depend on |
| --- | --- | --- |
| `apps/desktop` | Electron application composition and packaging entry | public APIs from application packages |
| `packages/contracts` | pure versioned data shapes, error codes, capability identifiers, and validators | no application package |
| `packages/electron-main` | lifecycle, privileged APIs, process supervision, protocols, security policy | `contracts`, SDK public types where required |
| `packages/preload` | narrow renderer bridge generated from allowlisted IPC contracts | `contracts` only |
| `packages/renderer` | React shell, chart-slot composition, klinecharts integration, UI state and views | `contracts`, `klinecharts`, public SDK types |
| `packages/data-service` | canonical market-data state, candle building, cache coordination and revisions | `contracts`, `storage`, provider SDK public types |
| `packages/provider-sdk` | provider manifest and adapter authoring API | `contracts` only |
| `packages/provider-runtime` | validated provider loading and utility-process protocol | `contracts`, `provider-sdk` |
| `packages/indicator-sdk` | indicator manifest, inputs, outputs, plots, direct series aliases, and clean `ta.*` authoring API; no runtime context exposure | `contracts` only |
| `packages/indicator-runtime` | worker lifecycle, TA dependency normalization, history/MTF resolution coordination, dependency graph, config generations, budgets and output validation | `contracts`, `indicator-sdk` |
| `packages/storage` | SQLite, workspace persistence and migration APIs | `contracts` only |
| `packages/testing` | contract fixtures, builders and conformance helpers | public package APIs only |

Package names may use a repository scope such as `@erc-chart/*`. The directory names and responsibilities above are frozen; changing them requires the change-control process below.

## Dependency rules

1. `packages/contracts` is the lowest-level shared package and imports no application package.
2. SDK packages import only `packages/contracts` and language/runtime standard libraries.
3. `packages/renderer` integrates klinecharts for chart rendering and must not import Electron main internals, filesystem APIs, provider runtime internals, SQLite drivers, or Credential Manager code.
4. `packages/preload` exposes only allowlisted, typed contracts and must not export raw `ipcRenderer`.
5. Provider packages and runtime code must not import renderer or chart internals.
6. Indicator packages and runtime code must not import renderer, provider, storage, Electron, filesystem, process, or credential internals.
7. Public indicator SDK exports must not expose runtime-only context, worker transport, MessagePort, provider profile, cache, klinecharts instance, or revision-envelope implementation types.
8. Storage code owns persistence implementation; consumers use its public API and do not import SQLite drivers directly.
9. Cross-process messages use `packages/contracts`; private implementation objects never cross process boundaries.
10. Circular package dependencies are forbidden and must fail CI.

## State ownership

| State | Sole mutable owner | Read-only projection |
| --- | --- | --- |
| Application/window lifecycle | `packages/electron-main` | none |
| Privileged protocol and IPC authorization | `packages/electron-main` | `packages/preload` exposes an allowlisted view |
| Renderer bridge surface | `packages/preload` | `packages/renderer` consumes the exposed API |
| Viewport | klinecharts instance in `packages/renderer` | `packages/renderer` observes klinecharts viewport state |
| Selection | klinecharts instance in `packages/renderer` | `packages/renderer` observes selection state |
| Crosshair | klinecharts instance in `packages/renderer` | `packages/renderer` observes crosshair output |
| Session drawings | klinecharts instance in `packages/renderer` | drawings are session-only, not persisted |
| Canonical normalized market-data revision | `packages/data-service` | consumers receive versioned projections |
| Provider connection and adapter state | provider utility process through `packages/provider-runtime` | main/data service receive contract messages |
| Normalized provider-profile configuration | ERC-chart provider configuration model | provider runtime receives validated generation-scoped configuration; secrets remain external |
| Indicator calculation state | worker through `packages/indicator-runtime` | renderer/data service receive validated outputs |
| Indicator TA dependency graph and configuration generation | `packages/indicator-runtime` | renderer observes status/results; data service receives provider-neutral series needs |
| Normalized indicator-instance configuration | ERC-chart indicator configuration model | renderer/klinecharts and indicator runtime receive validated projections |
| Database and workspace persistence | `packages/storage` | `packages/data-service` and `packages/electron-main` issue commands through the public storage API and do not write persistence directly |
| Provider secrets | Windows Credential Manager through main-owned bridge | no package receives raw secret persistence access |

A projection must not mutate the source-owned state or become an independent source of truth. In particular, a klinecharts technical-indicator instance may expose editable UI state, but it is not the persisted source of truth for ERC-chart indicator configuration.

## Contract families

The following identifiers are the initial compatibility versions. Package semantic versions are separate and do not replace these contract versions.

| Contract family | Identifier | Initial version | Owner |
| --- | --- | ---: | --- |
| Host API | `hostApiVersion` | `1` | application composition |
| IPC | `ipcContractVersion` | `1` | Electron main/preload |
| Provider | `providerContractVersion` | `1` | provider SDK/runtime |
| Indicator | `indicatorContractVersion` | `1` | indicator SDK/runtime |
| Plugin manifest | `manifestVersion` | `1` | plugin lifecycle |
| Workspace | `workspaceSchemaVersion` | `1` | renderer/storage |
| Market data | `marketDataContractVersion` | `1` | data service |
| Database | `databaseSchemaVersion` | `1` | storage |

All persisted or cross-boundary documents must carry their applicable version identifier. Unknown major versions fail closed with a clear compatibility error.

## Indicator authoring contract rules

The public indicator contract must preserve the following semantic rules even if internal implementation changes:

- no public `ctx` or equivalent runtime-context object is required for normal authoring;
- common canonical series are addressable directly through SDK-provided aliases;
- omitted TA source defaults to `close` unless a function documents a different semantic default;
- omitted TA timeframe defaults to the active chart timeframe;
- positional overloads and equivalent object/named-parameter forms normalize to equivalent semantics;
- requesting another timeframe creates a background data dependency and must not change the visible chart timeframe;
- every TA dependency is resolved through provider-declared capabilities and provider-neutral data-service contracts;
- calculation-affecting configuration changes and presentation-only style changes are distinguishable so generation invalidation is deterministic;
- changes originating from klinecharts settings UI are normalized into the same indicator-instance configuration contract used by ERC-chart UI and workspace restore.

Internal dependency keys, history planners, worker transport, cache identities, revision counters, and klinecharts objects are not public compatibility surfaces.

## Minimum contract content for ECDD-54

ECDD-54 may create type placeholders only for the following stable concepts:

- `ContractVersion` positive integer type;
- provider/feed, instrument and timeframe identifiers;
- normalized `Candle` and `Tick` value objects using Unix milliseconds UTC;
- versioned request/response envelope carrying request ID and generation/revision;
- versioned error envelope with stable machine code and safe user message;
- plugin kind and compatibility range identifiers;
- workspace root document version identifier; and
- manifest root document version identifier.

Business behavior, complete provider fields, indicator algorithms, database tables, and UI models belong to their implementation tasks and must not be invented in ECDD-54.

## Compatibility policy

- Additive optional fields may remain within the same contract version when older consumers safely ignore them.
- Removing, renaming, changing meaning, changing units, or making an optional field required is breaking and requires a new contract version.
- New enum values require consumers to handle an unknown value safely or require a version increase.
- Every boundary validator rejects malformed, unsupported, or non-finite data.
- Contract tests must include oldest-supported, current, malformed, unknown-version, and stale-generation fixtures.
- Equivalent SDK overload forms are behavioral aliases; changing their normalized meaning is a breaking authoring-contract change.

## Change control

A frozen boundary can change only through:

1. an ADR describing the problem and alternatives;
2. affected package and process owners;
3. compatibility and migration analysis;
4. updated contract fixtures and failure-path tests;
5. an explicit version decision; and
6. a reviewed PR referencing the Jira issue that owns the change.

Implementation convenience alone is not sufficient justification for a boundary change.

## Deferred details and resolution gates

The following values are intentionally not frozen here:

- exact package/library versions: ECDD-54 implementation;
- complete built-in `ta.*` function catalogue and exact overload set: Epic 7 indicator SDK implementation;
- exact Binomo authentication and instrument fields: ECDD-43 before Epic 4 adapter implementation;
- Credential Manager bridge library/API: ECDD-44 before Epic 2 credential implementation;
- final SQLite busy timeout and cache limits: ECDD-45 and OD-007 before Epic 2 storage feature freeze;
- final minimum-PC target: ECDD-46 through ECDD-48 before release performance acceptance;
- final code-signing and trusted plugin authority: OD-005 and OD-006 before their release/plugin gates;
- final UI language and line/area source options: OD-008 and OD-009 before UI/chart feature freeze.

These deferred details do not block the frozen package boundaries and version identifiers.
