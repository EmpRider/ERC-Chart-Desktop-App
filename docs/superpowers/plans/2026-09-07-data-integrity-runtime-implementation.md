# ERC-chart Data Integrity and Runtime Ownership Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` only after this design is approved. Execute one phase at a time; preserve its regression evidence before continuing.

**Goal:** Prevent workspace loss and incorrect live candles, complete the approved data-service/cache boundary, and make current-state documentation trustworthy.

**Architecture:** Preserve the existing packages, provider SDK, canonical store, klinecharts integration, and indicator workers. Repair domain behavior inside `packages/data-service`, then host that same service in the data utility. Keep privileged installation, credentials, and supervision in main; execute SQLite operations through `packages/storage` in the data utility.

**Tech stack:** Windows 10/11 x64; Node.js `26.8.1`; npm `12.0.2`; Electron `44.0.0`; strict TypeScript `7.0.2` build tooling; existing React/klinecharts; `node:sqlite`; Node's built-in test runner. No new dependency required.

**Status:** Implementation in progress; Phase 6 validation updated 2026-09-08.
Phases 1–5 and their 56/56 Phase 5 focused result were reported complete at
handoff; that historical count is not a new run. September 8 passed 96 affected
regressions, 80 integration tests, typecheck, lint and four root Electron smokes.
The preceding full unit result (488 passed, 2 permission-skipped of 490) was
retained, not rerun for documentation. See the
[Phase 6 evidence and recovery record](../../development/DATA-INTEGRITY-VALIDATION.md)
for exact commands, migration/crash regressions and operator instructions.
The two remaining automated Phase 6 review gaps now have fresh focused evidence:
the production shell preserves canonical generation/revision metadata through its
cached chart path, and utility-owned upstream expiry reclaims request capacity
while the utility stays alive. The independent fresh closure run completed
`npm run build` successfully and passed the three exact focused regressions
(**3/3**, 2.43 s); the interrupted partial source/test edits already satisfied
the requirement, so no additional production-code change was needed in this run.
Phase 6 remains open for the manual shared-profile,
keyboard/screen-reader, and permission-dependent symlink checks below; no
MVP/release approval is implied.

The original design, source anchors, and pre-implementation observations below
are retained as historical context for inspected source version `0.3.6`, not as
claims about the current implementation.

## Global constraints

- Signal is behavioral/protocol evidence only. No Signal source copying, dependency, import path, browser hook, or userscript architecture.
- No credentials, real provider connections, or external service access during these phases' deterministic checks.
- Preserve four charts per window, five active indicators per chart, and the 100,000-active-candle product limit. Investigate whether the current finalized-plus-building accounting exceeds that last limit; tests must define the count explicitly.
- Preserve renderer sandbox, context isolation, Node-disabled indicator workers, restrictive Content Security Policy, trusted-sender checks, runtime payload validation, plugin trust/permission enforcement, and Windows Credential Manager. No plaintext fallback.
- Preserve workspace schema v1 and session-only drawings unless an approved compatibility change explicitly requires otherwise.
- Reuse existing functions and prepared SQL. No event bus framework, generic RPC framework, repository abstraction hierarchy, new chart engine, global state library, or shared daemon between application instances.
- All new asynchronous ownership paths need cancellation/invalidation and idempotent cleanup tests. All new user-visible errors need accessible text and keyboard-operable recovery.

## 1. Authority, evidence, and limits

### Authority

Read [architecture documentation precedence](../../architecture/v1/README.md#decision-authority) first. Explicit requirements and accepted decisions outrank illustrative contract examples and reference-project behavior.

- [Architecture Decisions](../../architecture/v1/ARCHITECTURE-DECISIONS.md), lines 50–72, 119–135, 157–191, 193–251, 277–312: process boundaries, WAL, independent instances, provider alignment, resource limits, cache-not-offline, and the accepted klinecharts replacement.
- [Contract Baseline](../../architecture/v1/CONTRACT-BASELINE-v1.md), lines 16–72 and 92–106: package dependencies, sole mutable state owners, SDK boundaries. `contracts` must not import `provider-sdk` or `storage` just to simplify a new transport.
- [Pre-development readiness](../../architecture/v1/PRE-DEVELOPMENT-READINESS.md), lines 5–45 and 48–81: architecture approval addendum and milestone gates. ADR-003 and ADR-006 still literally say “Proposed”; the readiness/baseline record makes their process/storage design the implementation baseline. Do not silently relabel every historical ADR “Accepted.”
- [Architecture specification](../../architecture/v1/ERC-chart-Architecture-Specification-v1.md), lines 200–218, 292–340, 373–449, 704–729: provisional performance gates, data utility ownership, canonical history/live flow, alignment and per-instance session copies.
- [Implementation backlog](../../architecture/v1/IMPLEMENTATION-BACKLOG.md), lines 114–145: cache, native/derived history, canonical revision and subscription-sharing acceptance. Later epic completion is not inferred from package version.
- [SDK implementation decisions](../../architecture/v1/SDK-IMPLEMENTATION-DECISIONS.md) and [provider SDK decisions](../../architecture/v1/PROVIDER-SDK-IMPLEMENTATION-DECISIONS.md): preserve canonical data sharing and adapter-owned protocol/paging; do not move generic aggregation into Binomo.

### Revalidation performed

The two existing audit scripts were read, then rerun against current TypeScript bundled in memory. Both remain local report artifacts, not repository regression coverage:

- `ERC-audit-reproductions.mjs`: five observed defects reproduced again. Its assertions deliberately expect the broken behavior; passing it is **not** an acceptance gate for fixes.
- `ERC-audit-existing-checks.mjs`: 46 checks passed across 12 pure data/indicator suites. No failures, cancellations, or skipped tests.
- `npm run lint`: passed, including workspace boundaries.
- Plan verification: 10 exact source citation ranges, 8 relative document links and 14 root-script names checked. Five standalone TypeScript examples passed snippet-scoped strict diagnostics against current source exports using the installed TypeScript compatibility API; the partial acquisition-order sketch was intentionally excluded. This is not a full-project typecheck or proof that the proposed implementation exists.
- The illustrative owner-checked SQL ran against in-memory SQLite: owner insert/update succeeded, wrong-owner overwrite changed zero rows. Markdown Prettier check passed. The companion canvas had no reported editor diagnostics; interactive rendering was not exercised.
- `ERC-plan-validation.mjs` is a local documentation-verification artifact beside the earlier audit artifacts. It checks references/examples without writing application output; rerun it with `node` and its absolute path. The proposed JavaScript regression is grounded in existing fixture symbols but was not appended to or run as a repository test.
- Node matched `26.8.1`; installed npm was `11.14.1`, below the pinned `12.0.2`. No dependency installation or toolchain change performed.
- Initial `git status --short` was clean. No application source, tests, lockfile, package metadata, or accepted architecture document was changed for this plan.

Five outcomes are measured synthetic correctness observations, not production impact estimates: timeframe deliveries `[1, 0]`; concurrent upstream count `2` and stop counts `[0, 1]`; derived OHLCV `12/13/11/13/4` instead of `10/20/5/13/9`; aligned open time `60000` instead of `90000`; two workspace saves left only the second document in one row.

Build, full typecheck, full test suite, Electron UI, real shared-profile startup, installed application, provider protocol, hardware performance, and live credentials were not verified. The existing performance command prints scaffold disposition only; it supplies no latency, frame-time, memory, or cache benchmark.

### Classification and priorities

1. **F1: confirmed data-loss defect, release-blocking for shared-profile use.** Fixed IDs plus unconditional upsert overwrite another instance's autosave.
2. **F2/F3: confirmed market-data correctness defects, release-blocking for affected combinations.** Tick fanout starves timeframes; derived history/live continuity loses source bars.
3. **F4: confirmed concurrency/resource defect.** Concurrent identical subscription acquisition leaks an upstream subscription. Fix before extending sharing or moving processes.
4. **F5: confirmed provider-contract defect, conditional exposure.** Nonzero provider alignment is ignored for tick candles. Zero-origin Binomo does not demonstrate the failure.
5. **F6: confirmed integration gap.** Cache APIs exist but the desktop market-data path does not use them. Required cache behavior remains incomplete; no measured performance severity is assigned.
6. **F7: confirmed architecture gap.** Data utility reports readiness without owning canonical processing. This is not proof of a measured main-thread performance failure.
7. **F8: confirmed documentation drift.** Refresh current status without rewriting historical delivery evidence.

Intentional decisions, not defects: klinecharts instead of custom chart-core; multiple independent provider processes between application instances; no drawing persistence; historical cache without a complete offline mode; no automatic-update client; signal broadcasting, replay, backtesting and execution outside this MVP. Signing, final minimum PC, provider feasibility/terms and cache disk policy remain release/roadmap gates, not evidence that their implementations failed.

## 2. Current architecture and source anchors

The domain decomposition is worth keeping: provider-neutral contracts, pure validation, typed-array canonical state, bounded ticks, explicit worker revisions, narrow preload APIs and existing SQLite transactions. The weaknesses are composition and lifecycle consistency, not a need for a new framework.

Main currently creates the canonical service directly:

```223:224:apps/desktop/src/main.ts
const providerData = createProviderDataService(providerUtilities);
providerDataReference.current = providerData;
```

The utility only handles shutdown and emits readiness:

```27:32:packages/data-service/src/utility-runtime.ts
  removeListener = port.onMessage((message) => {
    if (isUtilityControlMessage(message)) shutdown();
  });
  port.postMessage({ type: "ready", contractVersion: ipcContractVersion });

  return { shutdown };
```

Workspace main composition fixes both identities:

```128:130:apps/desktop/src/main.ts
const paths = resolveDesktopArtifacts(import.meta.url);
const lastWorkspaceId = "last-workspace";
const desktopInstanceId = "desktop-main";
```

Storage changes document ownership on conflict rather than checking it:

```1252:1260:packages/storage/src/index.ts
      `INSERT INTO workspaces
        (id, schema_version, name, document_json, instance_id, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         schema_version = excluded.schema_version,
         name = excluded.name,
         document_json = excluded.document_json,
         instance_id = excluded.instance_id,
         updated_at_ms = excluded.updated_at_ms`,
```

The renderer deliberately uses a single wire-document alias; it is not sufficient to change only `desktopInstanceId`:

```49:54:packages/renderer/src/workspace-persistence.ts
): PersistedWorkspace {
  return {
    schemaVersion: 1,
    id: workspaceId,
    name: "Last workspace",
    activeTabId: state.activeTabId,
```

Each demand sends accepted ticks only to its own canonical series despite a shared profile/instrument buffer:

```377:385:packages/data-service/src/provider-bridge.ts
            const normalized = normalizeTicks(ticks, demand.request);
            const accepted = tickBuffer.append(
              {
                providerProfileId: demand.providerProfileId,
                instrumentId: demand.request.instrumentId,
              },
              normalized,
            );
            const deltas = candleState.applyTicks(demand.seriesKey, accepted);
```

Acquisition awaits before publishing ownership; both callers can enter this branch:

```466:475:packages/data-service/src/provider-bridge.ts
    let demand = demands.get(key);
    if (demand === undefined) {
      const plan = await planFor(providerProfileId, request.timeframeId);
      demand = {
        providerProfileId,
        request: Object.freeze({ ...request }),
        seriesKey: await seriesKeyFor(providerProfileId, request),
        plan,
        sourceRequest: sourceRequestFor(request, plan),
        sourceCandles: new Map(),
```

Derived history discards its native input after aggregation; the independent live source map begins empty:

```283:291:packages/data-service/src/provider-bridge.ts
    const source = normalizeCandles(
      await upstream.requestHistory(providerProfileId, sourceRequest),
      sourceRequest,
    );
    return normalizeCandles(
      plan.target.native
        ? source
        : aggregateTimeframeCandles(source, plan.target)
            .filter(
```

Tick buckets separately implement epoch-zero alignment:

```49:52:packages/data-service/src/candle-state.ts
function bucketOpenTime(timestampMs: number, timeframeSeconds: number): number {
  const durationMs = timeframeSeconds * 1000;
  return Math.floor(timestampMs / durationMs) * durationMs;
}
```

History always hits upstream and replaces canonical history:

```619:633:packages/data-service/src/provider-bridge.ts
    requestHistory: async (providerProfileIdValue, request) => {
      const providerProfileId = requireProviderProfileId(
        providerProfileIdValue,
      );
      const normalized = await requestNormalizedHistory(
        providerProfileId,
        request,
      );
      candleState.loadHistory(
        await seriesKeyFor(providerProfileId, request),
        normalized,
        now(),
      );
      return normalized;
    },
```

Relevant existing APIs: `CanonicalSeriesKey` has profile, instrument, timeframe ID and seconds, but no alignment; `ProviderBarAlignment` has `mode`, `originMs`, `timeZone`; `TimeframePlan` contains `source` and `target`; `HistoricalCandleCache` exposes synchronous `newest`, `range`, `upsert`, `retain`. `createHistoricalCandleCache(database)` maps storage identity to profile/instrument/**seconds**, whereas canonical identity also includes timeframe ID. Review that mismatch before enabling persistent reuse.

## 3. Minimal target architecture

### Chosen approach and alternatives

**Choose incremental domain repairs followed by one process cutover.** Fix F4/F5 in the existing pure service, implement F2/F3 together around shared native-source state, then move this tested service unchanged into the data utility. Integrate persistent history there. This avoids fixing the same algorithm twice.

Keeping everything in main is fewer initial changes but abandons approved containment and permits synchronous SQLite waits in privileged UI coordination; it requires a replacement architecture decision. A new generalized actor/event-bus/database-service framework adds contracts and failure modes without fixing these eight findings. Neither is the default.

### Ownership

- **Main:** window lifecycle; trusted renderer authorization; provider supervision and network/credential broker; plugin file staging and OS operations; small request/event forwarding. Main must not own a second candle store or run aggregation.
- **Data utility:** one `ProviderDataService` per application instance; source/target series, canonical revisions, history acquisition, feed sharing, bounded queues, workspace session persistence, and SQLite connection(s) through storage APIs. It never receives provider secrets.
- **Provider utility per profile:** protocol authentication, normalization, provider-specific paging/retry/rate-limit interpretation. Its existing public SDK remains unchanged.
- **Renderer:** React controls, klinecharts projections, transient drawings/viewport, accessible stale/error state. Existing chart and indicator consumers use the same canonical revision stream.
- **Indicator workers:** calculation state, configuration generation, existing time/output budgets. No storage/provider imports.
- **Storage package:** SQL, validation, migrations, transactions and recovery implementation. It is a package executed in the data process, not a new background daemon.

Keep main-mediated provider messages for the first cutover; it already owns provider supervision and privileged brokers. Add direct transferable data ports only if measured serialization/latency violates the gate. Transfer copied snapshots, never detach the canonical store's arrays. `ProviderDataService.tickSnapshot` is synchronous today; no current desktop controller method exposes it. Do not pretend a synchronous cross-process implementation exists: leave it utility-local, or add an explicitly asynchronous contract only when a real caller needs it.

### Lifecycle and flows

1. Main creates a cryptographically random instance/session identity and a trusted local database-path initialization message. Data utility opens storage/migrations, installs request handlers, then reports ready. The current 5-second startup timeout must be tested against migration/lock contention, not automatically lengthened to hide failures.
2. Renderer requests history through existing allowlisted preload channels. Main validates and forwards a versioned, request-ID/generation-scoped command. Data utility resolves capabilities, source/target plans and bounded cache coverage; provider-specific paging stays upstream.
3. Native history seeds shared source state. Derived history is projected from that state; consumers receive the requested range while canonical state retains the useful union. A narrow backfill must not replace another consumer's newer bars or building candle.
4. A normalized tick is accepted once per profile/instrument input, then reaches every eligible active native source and affected target exactly once. Derived targets receive aggregates from source state, not an unrelated tick-built target that competes with native-candle aggregation.
5. Candle batches replace native bars by open time, rather than adding snapshot volume twice. Recompute only touched target buckets from retained source constituents. Cache finalized native bars and validated target results; never persist a building bar as final.
6. Profile invalidation increments a generation before awaits, stops ingress, rejects obsolete replies, releases old subscriptions, and retains last valid display state as stale. Restoration hydrates the current target bucket even if there are no missing target timestamps, repairs the finalized tail, then resumes delivery and clears stale status.
7. Shutdown freezes new UI mutations/acquisitions, flushes the latest workspace while storage is alive, closes live consumers, waits for or invalidates bounded pending operations, releases providers, then closes utility-owned SQLite and terminates the utility. The present controller stops the data utility before workspace flush; reorder this in the cutover.

Only one active mutable owner per source/target is allowed. A sink exception cannot block other sinks. A removed consumer cannot receive events or delete the replacement demand for the same key.

## 4. Issue-level implementation guidance

### F1 — Instance-safe workspace autosave

**Expected:** Two processes using the same user database retain independent session documents. Opening an old document creates a new session copy. Autosave never silently overwrites a named/shared workspace.

**Minimum design:** Keep `last-workspace` as the existing renderer wire alias. Translate it at the trusted persistence boundary to `session:<UUID>` owned by `instance:<UUID>`. Resolve startup from the newest validated session document with deterministic `(updated_at_ms, id)` ordering, falling back to legacy `last-workspace`; translate back to the wire alias on load. Insert the current session copy before first autosave, so a renderer restart uses its own row rather than reselecting a different process's newest session.

Persist using the existing `workspaces` table and document schema; no migration is needed for this first repair. Add storage APIs for session load/save policy rather than weakening generic workspace validation. SQL must validate owner and result count. Keep ordinary named `saveWorkspace` semantics explicit; do not silently reinterpret every existing caller.

**Illustrative TypeScript, proposed main-boundary mapping; existing imported types/functions, no existing session API implied:**

```typescript
import { randomUUID } from "node:crypto";
import type { PersistedWorkspace } from "@erc-chart/contracts";

const instanceId = `instance:${randomUUID()}`;
const sessionId = `session:${randomUUID()}`;

function sessionCopy(workspace: PersistedWorkspace): PersistedWorkspace {
  // The IPC handler must run isWorkspaceSaveRequest before this function.
  if (workspace.id !== "last-workspace") {
    throw new Error("Workspace session alias is invalid.");
  }
  return { ...workspace, id: sessionId };
}

function rendererCopy(workspace: PersistedWorkspace): PersistedWorkspace {
  return { ...workspace, id: "last-workspace" };
}
```

**Illustrative SQL for a proposed `saveWorkspaceSession` operation**, with seven bound values already serialized/validated as in `saveWorkspace`. `changes !== 1` is a conflict error, never success:

```sql
INSERT INTO workspaces
  (id, schema_version, name, document_json, instance_id, created_at_ms, updated_at_ms)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  schema_version = excluded.schema_version,
  name = excluded.name,
  document_json = excluded.document_json,
  updated_at_ms = excluded.updated_at_ms
WHERE workspaces.instance_id = excluded.instance_id;
```

Serialize saves per session and coalesce only not-yet-started UI snapshots to the latest revision; an older async save must never land after the latest. The preload already has a flush contract: preserve it through the utility move. Replace the renderer's swallowed autosave error with “Workspace not saved,” retry, and a close-time retry/cancel decision. Use a polite status region for pending/saved state and an alert for persistent failure; keyboard focus must return to the initiating control.

Retain legacy and prior session rows; no automatic deletion of user documents. The startup default can restore the newest copy, but release needs a small “Restore previous session” selector when multiple saved copies exist. Selecting a prior copy clones it; it never steals ownership. This is data recovery, not a full named-workspace manager. If that UI is intentionally deferred, record the limitation and provide a supported export/recovery path before calling multi-instance persistence complete.

**Files:** `packages/storage/src/index.ts`; `apps/desktop/src/main.ts`; `packages/electron-main/src/application.ts`; `packages/renderer/src/development-shell.tsx`; existing renderer persistence module only if alias handling needs extraction; `packages/contracts/src/workspace-persistence.ts` and `packages/preload/src/bridge.ts` for recovery listing/selection, not generic row access. Tests: storage, main workspace persistence, preload and renderer persistence suites; shared-database Electron scenario described in phase 1.

### F4 — Atomic demand acquisition and lifecycle fences

**Expected:** `Promise.all` acquisitions of one series create one upstream subscription and independent consumer handles. Every upstream closes once, including pending connections and failures.

**Root cause:** The map lookup precedes `await planFor` and `await seriesKeyFor`; two continuations both create and publish a demand. Pending acquisition is also absent from shutdown's demand snapshot.

**Small repair:** Resolve both plan and key, check a captured service/profile epoch, then re-read `demands.get(key)` immediately before synchronous create-and-publish. No await between recheck and map insertion. Use a per-profile invalidation epoch and a closed flag so an acquisition started before invalidation/shutdown cannot publish afterwards. A pending creation promise per key is an alternative, but is unnecessary if the recheck plus lifecycle fence suffices; capabilities can be promise-deduplicated separately only if tested request duplication warrants it.

**Illustrative replacement ordering inside existing `subscribe`**, after adding the named epoch/closed state; this is not a complete drop-in function:

```typescript
const startedEpoch = profileEpochs.get(providerProfileId) ?? 0;
const plan = await planFor(providerProfileId, request.timeframeId);
const seriesKey = await seriesKeyFor(providerProfileId, request);
if (closed || startedEpoch !== (profileEpochs.get(providerProfileId) ?? 0)) {
  throw new Error("Provider demand acquisition was invalidated.");
}
let demand = demands.get(key);
// Construct from plan/seriesKey and publish synchronously only if still absent.
// Keep existing numeric consumer IDs and the idempotent unsubscribe handle.
```

Increment `profileEpochs` synchronously in invalidation and set `closed` synchronously at shutdown. Check the same epoch before caching a capability/history response. On release or connection failure, delete only when `demands.get(key) === demand`; a late release must not delete a replacement. Use `Promise.allSettled` for cleanup where one unsubscribe failure must not skip remaining releases; propagate a sanitized aggregate failure after cleanup. Existing `connectPromise` generation checks remain useful.

**Files:** `provider-bridge.ts`, its existing test file. Apply the same atomic acquire/release rule to the source registry introduced for F2/F3, rather than building a second subscription mechanism.

### F5 — Provider alignment in tick construction

**Expected:** History, ticks, native source state and derived targets use the same declared boundaries. Origin `30000`, duration 60 seconds, tick `100000` produces open `90000`.

**Fix:** Reuse `alignedOpenTime`. Add an alignment argument to the internal `CanonicalCandleState.applyTicks` contract and thread `plan.source.alignment` into source construction. Preserve epoch-zero default for existing direct callers; production bridge calls must always pass declared alignment. Avoid expanding `CanonicalSeriesKey` with SDK objects simply to compute a bucket.

**Illustrative TypeScript signature/helper change in `candle-state.ts`:**

```typescript
import type { ProviderBarAlignment } from "@erc-chart/provider-sdk";
import { alignedOpenTime } from "./timeframes.js";

const epochAlignment: ProviderBarAlignment = Object.freeze({
  mode: "epoch",
  originMs: 0,
  timeZone: "UTC",
});

function bucketOpenTime(
  timestampMs: number,
  timeframeSeconds: number,
  alignment: ProviderBarAlignment = epochAlignment,
): number {
  return alignedOpenTime(timestampMs, timeframeSeconds, alignment);
}
```

Update both the `applyTicks` precheck and `candleFromTick` to use the same alignment. Extend the interface's third argument to `alignment?: ProviderBarAlignment`; extend implementations and callers together. Validate duration multiplication, aligned nonnegative open time and provider metadata at the trust boundary. A `session` label plus fixed origin is not a trading calendar or DST implementation; reject unsafe declarations rather than guessing. Tests should pin the supported fixed-origin behavior. Capabilities changing alignment require a new profile generation and stale cached-series invalidation.

**Files:** `candle-state.ts`, `provider-bridge.ts`, `timeframes.ts` only for validation required by new cases; candle-state/timeframes/provider-bridge tests. Public provider SDK shapes need no change.

### F2 and F3 — Shared native state, complete derived buckets

**Expected:** Every active target receives each accepted relevant tick once; history/live and reconnect preserve open/high/low/close/volume (OHLCV). Derived and native consumers of the same source share one upstream.

**Fix together:** Separate only the two real responsibilities currently combined in `LogicalDemand`: native upstream ownership and logical target sinks. Maintain native source records keyed by profile/instrument/source timeframe, and logical target records keyed by the existing `demandKey`. Keep this inside the bridge initially; extract `source-state.ts` only if the changed implementation cannot be read/tested coherently as one file.

- One source record owns its connection, generation, retained native bars and target references. One target owns its canonical key/plan and consumer handles. No sink-local dedup buffers.
- The shared profile/instrument tick buffer accepts an input once; distribute the accepted result to all active matching native source states, then project their changed buckets to targets. A duplicated callback from another source must not be necessary to update its targets. Snapshot targets before notification so unsubscribe/reentrancy is safe.
- For adapters emitting both ticks and candle snapshots, preserve replacement semantics: source candles replace the same source open time; ticks update its building bar. Document the provider's timestamp/volume interpretation. Equal-timestamp ticks without provider sequences remain governed by the existing bounded-buffer policy; do not claim perfect deduplication of distinct trades.
- History normalization returns/retains native bars before target projection. Merge by source open time with last-valid-source precedence. Keep live updates observed during hydration in a bounded generation-scoped queue; publish history first, replay queued live updates next. If exact overlap cannot be decided, refresh the authoritative current native candle; never invent volume.
- Hydrate a derived target's complete current source bucket on subscribe and restore even when target gap detection reports zero gaps. Query from `alignedOpenTime(now(), target.seconds, target.alignment)` through the current source boundary. Target OHLCV alone cannot reconstruct constituent source bars.
- Replace `sourceCandles.clear()` followed by immediate resume with hydration/repair before resume. A repair failure leaves the target stale; it must not emit a “complete” partial aggregate.
- Recompute only touched buckets, not the entire retained source history per tick. Remove the arbitrary 10,000-entry live map loop after the shared source tail has explicit retention. Preserve every constituent of the current target bucket; keep finalized source history within a declared cap. Reject unsupported source/target ratios that cannot fit safely rather than silently dropping part of a candle.
- Cold history load may replace an empty canonical series. Subsequent requests, pages, or overlapping consumers merge the retained union; return only the caller's requested slice. Old-generation history cannot overwrite newer live state or revisions.

**Illustrative TypeScript aggregation using existing contracts/functions**, assuming `nativeTail` has already been hydrated and bounded; these variable/helper names are proposed:

```typescript
import type { Candle } from "@erc-chart/contracts";
import type { ProviderTimeframeCapability } from "@erc-chart/provider-sdk";
import { aggregateTimeframeCandles, alignedOpenTime } from "./timeframes.js";

function projectTouchedBuckets(
  nativeTail: Map<number, Candle>,
  changed: readonly Candle[],
  target: ProviderTimeframeCapability,
): readonly Candle[] {
  for (const candle of changed) nativeTail.set(candle.openTimeMs, candle);
  const touched = new Set(
    changed.map((candle) =>
      alignedOpenTime(candle.openTimeMs, target.seconds, target.alignment),
    ),
  );
  return aggregateTimeframeCandles(
    [...nativeTail.values()].filter((candle) =>
      touched.has(
        alignedOpenTime(candle.openTimeMs, target.seconds, target.alignment),
      ),
    ),
    target,
  );
}
```

This example illustrates replacement and complete-bucket projection, not the final optimized lookup: it still scans the tail. Start with measured bounded sizes; use bucket-indexed source storage if the benchmark shows that scan violates the target. Do not add a second OHLCV algorithm beside `aggregateTimeframeCandles`.

**Files:** `provider-bridge.ts`, `candle-state.ts`, existing canonical/timeframe functions as necessary, and `provider-bridge.test.mjs`. Test revisions through the existing renderer/indicator incremental-sync suites, not just displayed close prices.

### F7 — Host the service, not a readiness placeholder

**Expected:** Data utility readiness proves initialized storage/service handlers; canonical work executes there. Utility death rejects pending requests and marks all affected charts stale without closing the shell or exposing secrets.

**Transport design:** Add one narrow data-utility protocol in `packages/contracts`, with exact discriminated request/response/event types, `ipcContractVersion`, correlation ID and service/profile generation. Reuse existing `ProviderHistoryLoadRequest`, `Candle`, `ProviderSeriesChange`, workspace validators and finite-array validation. Provider SDK authoring objects, sinks/functions, `Map`, `DatabaseSync`, errors with stacks, and private stores never cross IPC.

**Illustrative additive contract slice, not an existing API and not a full protocol:**

```typescript
import type { Candle } from "./market-data.js";
import type { ProviderHistoryLoadRequest } from "./provider-management.js";
import type { ipcContractVersion } from "./versions.js";

export interface DataHistoryCommand {
  readonly type: "data-history";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly generation: number;
  readonly request: ProviderHistoryLoadRequest;
}

export type DataHistoryReply = {
  readonly type: "data-history-result";
  readonly contractVersion: typeof ipcContractVersion;
  readonly requestId: string;
  readonly generation: number;
} & (
  | { readonly ok: true; readonly candles: readonly Candle[] }
  | { readonly ok: false; readonly code: string }
);
```

Complete the concrete protocol with capabilities/instruments, history, subscribe/unsubscribe, live candle/tick/error events, profile invalidation/restoration and storage operations actually used by desktop. Runtime validators must check exact fields, bounded IDs, safe generations, array lengths and identities. Reuse existing provider-supervisor request correlation patterns, not its source/module structure as a generic framework. Avoid broadening `UtilityControlMessage` to `unknown`; either extend its narrow union or keep a separate data-message channel alongside lifecycle status.

The new main-side client satisfies the existing `DesktopApplicationAdapters["providerData"]` async shape. `ProviderDataService` remains instantiated only in the utility runtime. The data utility uses a `ProviderDataUpstream` proxy to the already supervised providers through main. Raw credentials still travel only along the existing main/provider broker path.

**Storage cutover:** Move workspace session operations with the utility initialization, not after shutdown semantics are frozen. Initially the registry/profile main connection may coexist briefly as an explicitly documented transition; F7 is not closed at that point. Complete the cutover by replacing `database: DatabaseSync` injection in provider management and both import services with exactly their required asynchronous storage operations. Keep file installation and Credential Manager compensation in main. `ProviderManagementService.snapshot` becomes async; current IPC invocation already supports promises. Never put arbitrary `query(sql)` or filesystem paths in a renderer API.

Use operation-specific commands for profile create/update/delete/list/get and plugin put/activate/disable/delete/list; keep transactions synchronous within storage. Existing multi-step import rollback must still disable/remove only the staged version and restore prior activation on error. A DB timeout is not permission to delete a successfully installed profile/plugin blindly: read back operation outcome or use a bounded idempotency identifier for the affected mutation.

**Files:** new `packages/contracts/src/data-utility.ts` plus root export/tests; `packages/data-service/src/utility-entry.ts`, `utility-runtime.ts` and public exports; a focused main client at `apps/desktop/src/data-service-client.ts`; `apps/desktop/src/main.ts`; `packages/electron-main/src/utility-supervisor.ts`, `application.ts`; provider/indicator import and provider management services/tests; `tools/build-runtime.mjs` only if packaging the new entry requires it. Update package-boundary rules only for a documented necessary dependency, not to permit main importing data internals or contracts importing SDK packages.

### F6 — Enable cache in the final owner

**Expected:** Bounded finalized history comes from SQLite when available; provider requests cover only missing required history plus a deliberate freshness tail. Current building bars are live/provider data. A disconnected cache result is explicitly stale, not a complete offline product.

**Reuse:** `createHistoricalCandleCache`, `createCanonicalCandleState({ cache })`, `findCandleGaps`, `newest`, `range`, batched `upsertCandles` and indexed retention already exist. Wiring `cache` into candle state only enables writes; it does not fix reads or provider overfetch.

**Illustrative utility composition with existing APIs:**

```typescript
import { openStorageDatabase } from "@erc-chart/storage";
import {
  createCanonicalCandleState,
  createHistoricalCandleCache,
  createProviderDataService,
  type ProviderDataUpstream,
} from "@erc-chart/data-service";

async function openDataService(
  databasePath: string,
  upstream: ProviderDataUpstream,
) {
  const database = await openStorageDatabase(databasePath);
  try {
    const cache = createHistoricalCandleCache(database);
    const candleState = createCanonicalCandleState({ cache });
    const service = createProviderDataService(upstream, { candleState });
    return { database, cache, service };
  } catch (error) {
    database.close();
    throw error;
  }
}
```

This composition is illustrative from an application/test caller; inside `packages/data-service`, use local relative module imports rather than a self-package import. It does not implement cache acquisition or shutdown. Production closes the returned database only after service drain and workspace flush.

**Before serving cache hits:**

- Resolve identity collision: `history-cache.storageKey` currently drops timeframe ID/alignment. Use a bounded cache identity including native timeframe ID, seconds, alignment mode/origin/time zone and provider configuration generation/fingerprint relevant to data semantics. Default: an explicit versioned cache-key change in storage, not JSON stuffed into the 128-character `feedId`. A DB migration may rebuild candle/cache-state tables because they are disposable; retain all workspace/profile/plugin/settings records. Define persisted source identity before populating production cache.
- Distinguish canonical in-memory revisions from cross-process storage ordering. Existing source revisions restart with a new service. Cache conflict policy must not assume a process-local revision proves a newer provider observation; retain deterministic valid-source precedence and test two writers.
- Bound `[fromMs, toMs]`, convert to aligned candle-open bounds, enforce limits, and paginate gap enumeration itself. `findCandleGaps` walks every step; an unbounded year-scale request must not block the utility. Market closures are not automatically data loss: do not retry empty closed-session intervals forever or synthesize bars.
- For explicit finalized ranges, cache coverage can avoid provider history entirely. For newest-N/current requests, refresh the most recent finalized overlap and building bucket by policy. Tests assert which request is expected, not an unrealistic zero-network promise for live freshness.
- Store native source history so derived current-bucket hydration reuses it. A derived target cache hit alone cannot satisfy source continuity. Share identical in-flight range work only after generation/cancellation behavior is correct.
- Cache corruption/read failure may fall back to fresh provider data with a sanitized diagnostic; workspace storage failure must surface and preserve unsaved work. Disk-full/write failure must not be reported as provider-invalid-candle. Split market-data validation errors from persistence errors in live callbacks.

**Files:** `provider-bridge.ts`, `history-cache.ts`, `candle-state.ts`, storage index/migration tests; utility composition; `history-cache.test.mjs`, provider-bridge tests and a synthetic restart integration test.

### F8 — Accurate current-status documentation

Update `README.md` current status and `docs/development/MONOREPO.md` current release/shell sections after each relevant phase. Describe source `0.3.6` capabilities separately from verified release artifacts: live provider/chart/worker code exists, but this plan's cache/process/correctness gaps remain until their gates pass. Keep automatic updates excluded and production signing gated. Preserve dated ECDD plans and historical changelog entries. Add one link to this plan from the development guide when implementation begins; record completion evidence, not only checkboxes. Review `tools/application-gates/src/scaffold-performance.mjs` so its name/output cannot be mistaken for the eventual measured performance gate.

## 5. Dependency-ordered execution phases

Each phase is a separate reviewable change. Begin with a failing regression; implement the minimum; run the focused gate and full required gates; inspect the diff; record evidence. Do not mix a transport migration with a new candle algorithm.

### Phase 0 — Freeze reproducible acceptance inputs

- [ ] Capture current commit/status and pinned toolchain. Align npm to `12.0.2` before release validation; preserve lockfile.
- [ ] Port the five observed-defect scenarios into existing repository tests, changing assertions to expected **correct** outcomes. Do not commit tests that celebrate broken behavior.
- [ ] Add deferred-promise fixtures for capability/history/subscribe races, with explicit release order and no sleep-based timing.
- [ ] Record current source-only checks/lint as baseline; establish real build/test baseline using section 7 in an implementation workspace.

**Gate:** Each new regression fails for the claimed cause, not stale `dist`, missing exports or toolchain mismatch. No production source changes yet.

### Phase 1 — Protect user documents first

- [ ] Implement F1 session translation, ownership-checked save and serialized writes; preserve legacy load and schema v1.
- [ ] Add save failure/retry/close behavior and recoverable prior-session selection, retaining keyboard navigation and accessible status.
- [ ] Test two independent database connections to the same temporary file, concurrent autosaves, reopened sessions, renderer reload and legacy restore.
- [ ] Extend the Electron smoke with a shared application database scenario. Keep separate Chromium user-data directories if Chromium profile locking requires them, but inject one test-only storage path via a trusted test entry; also manually verify actual shared-profile product behavior. Existing `smoke:multi-instance` only proves isolated-profile boot.

**Gate:** Both independently edited documents survive; one owner cannot mutate the other's row; flush failure never reports saved; legacy and ordinary restart smoke still pass. No cache schema change.

### Phase 2 — Make acquisition and alignment deterministic

- [ ] Implement F4 acquire recheck, profile/service epoch fences, identity-checked deletion and complete cleanup.
- [ ] Implement F5 aligned tick buckets using the existing timeframe function.
- [ ] Add shutdown-during-capability/subscribe, invalidate-before-history-resolve, failed-connect retry, double unsubscribe and same-key replacement tests.

**Gate:** Concurrent same-key acquisitions create one upstream; every acquired upstream is stopped exactly once; no state/event mutation after invalidation; `100000` with origin `30000` yields `90000`; epoch-zero tests remain unchanged.

### Phase 3 — Unify source continuity and tick fanout

- [ ] Implement F2/F3 source records, shared acquisition and complete current-bucket hydration together.
- [ ] Merge history/backfill without wiping newer canonical data; queue and replay bounded live ingress during hydration.
- [ ] Repair current buckets on reconnect even without a missing target timestamp; surface stale state until complete.
- [ ] Preserve canonical generation/revision, dirty range, provisional/finalized behavior and downstream indicator semantics.

**Gate:** Both native timeframes update regardless of callback order; native and derived same-source consumers share upstream; all OHLCV fields and indicator results match the reference calculation across history/live/reconnect. Overflow and failed hydration cannot emit silently partial candles.

### Phase 4 — Cut over process and persistence ownership

- [ ] Add concrete versioned data messages/validators and test request/event correlation with fake ports.
- [ ] Instantiate the already-repaired service in the utility; replace main service construction with the asynchronous client. Preserve provider broker boundaries.
- [ ] Move session storage, then profile/plugin operations into the same utility-owned storage boundary. Re-test import activation/rollback and credential compensation without real credentials.
- [ ] Reorder shutdown so workspace flush completes before data utility termination; reject new work once draining starts. Delete the readiness-only implementation and transitional main DB connections.

**Gate:** A synthetic history/live request traverses the real utility and records a different process ID from main; killing it rejects pending commands, drops old-generation replies and marks data stale while shell remains operational. Main has no canonical constructor or SQLite connection; package boundaries pass. Recovery can start a new supervisor/client generation without treating old `ready` as success.

### Phase 5 — Cache-backed history and safe persistent identity

- [ ] Implement and verify versioned cache identity/migration before first production write.
- [ ] Wire cache read/gap/provider/merge/finalized-write flow in the utility, reusing phase 3 native hydration.
- [ ] Add fresh-process warm-load, bounded missing-range, stale/freshness-tail and two-writer contention tests with synthetic providers.
- [ ] Separate cache I/O failures from malformed provider data and workspace errors.

**Gate:** Warm explicit finalized range makes zero history calls; newest-N makes only documented freshness/gap calls; a partial cache fetches only required missing ranges; no building candle persists; native source constituents survive target-cache warm loads. Migration preserves user documents and rejects incompatible old binaries safely.

### Phase 6 — Validate and publish truthful status

- [x] Run section 7 local gates; record command, toolchain, exit status, elapsed time, environment and fixture sizes. September 8 reran typecheck, lint, integration, four root smokes and 96 affected tests with cache-local npm `12.0.2`; the immediately preceding 488-pass/2-skip full unit result is explicitly carried forward. Global tooling/pins remain unchanged. Network/installer gates are separate below.
- [x] Run the measured stress workload and process-failure/restart tests; capture before/after evidence rather than asserting optimization from code shape. Retained domain stress/GC measurements supplement the current real utility smoke: pending history/write/subscribe reject on kill, the actual renderer displays stale status and stays interactive, delayed old work is fenced, acknowledged workspace survives, fresh utility restart succeeds. The same renderer is closed before restart; automatic same-window recovery and full performance acceptance are not claimed.
- [x] Update current-status docs, migration/recovery instructions and real performance-gate documentation. Keep release/signing/provider verification gaps explicit. The evidence record now compares all protected migration tables and provides ordinary shared-profile startup/keyboard/symlink reproduction instructions.
- [ ] Review boundaries/invariants/security/accessibility and the final changed behavior. The fresh closure run passed the three exact focused regressions, **3/3**: the shell preserves full canonical series metadata through cached chart updates, including coalesced revisions, and utility-owned upstream expiry reclaims all 256 request slots before shutdown while late results are ignored. No automated blocker remains in this requested scope. Phase 6 remains open for the manual shared-profile, keyboard/screen-reader and permission-dependent symlink checks below.

**Gate:** Phase evidence is reproducible; deferred roadmap remains separate; no “perfect,” “production ready,” or “all goals achieved” claim without the corresponding release gates.

## 6. Regression matrix as executable cases

Use `node:test` and `node:assert/strict`, existing fixture style and public package exports. Extend the current `.mjs` tests rather than adding a framework. New TypeScript type fixtures go in the existing contracts/typecheck path.

**Runnable proposed regression appended to `packages/data-service/test/provider-bridge.test.mjs`:** it uses that file's actual `createUpstream`, `createSink`, `request`, `createProviderDataService`, `test` and `assert` symbols.

```javascript
test("concurrent demand shares one upstream and releases it once", async () => {
  const fixture = createUpstream();
  const service = createProviderDataService(fixture.upstream);
  try {
    const handles = await Promise.all([
      service.subscribe("profile-a", request, createSink().sink),
      service.subscribe("profile-a", request, createSink().sink),
    ]);
    assert.equal(fixture.subscriptions.length, 1);
    await Promise.all(handles.map((handle) => handle.unsubscribe()));
    assert.deepEqual(
      fixture.subscriptions.map((item) => item.unsubscribeCount),
      [1],
    );
  } finally {
    await service.shutdown();
  }
});
```

Required additional cases, with exact expected outcomes:

- **Tick fanout:** one profile, `BTCUSD`, native `1m` and `5m`, one identical tick delivered through every active upstream. Each timeframe publishes once. Reverse callback/acquisition order; add a second profile and assert isolation. Repeat same sink twice: each handle is still an independent logical subscription.
- **Derived continuity:** 1m bars `(time, O,H,L,C,V)` = `(0,10,20,5,11,2)`, `(60000,11,12,9,12,3)`; load 5m at `now=120000`; live `(120000,12,13,11,13,4)` must yield `(0,10,20,5,13,9)`. Replace that native bar twice: no volume compounding. Repeat after reconnect with no target gap and with cache-only finalized source bars.
- **History/live races:** settle earlier request after later request; change timeframe/profile while pending; unsubscribe during hydration; emit live data while history is pending. No old generation is delivered; latest source bars and target extrema survive. A small backfill does not shrink another consumer's full snapshot.
- **Alignment:** origin `30000`, 60 seconds, times `89999/90000/100000/149999/150000`; expect bucket starts `30000/90000/90000/90000/150000`. Cover nonzero derived origins, invalid metadata and negative computed open time rejection.
- **Lifecycle:** `Promise.all` same-key acquisition; reject one connect; unsubscribe before connect resolution; shutdown before capability completion; stale old handle after same-key replacement; one unsubscribe rejects. All tracked work settles, unrelated consumers remain intact, upstream release counts are exact.
- **Workspace:** A/B same DB and initial document; A saves title A, B title B; two owned rows persist. Wrong-owner update changes zero rows and surfaces conflict. Latest save wins only within its own session. Legacy row remains byte-equivalent. Disk-full/busy/close-time error preserves dirty state and recovery choice.
- **Cache:** empty/full/partial ranges, unordered/revised duplicate bars, unknown volume, closed-market gaps, restart, changed alignment/profile data semantics, same seconds with distinct timeframe IDs, corrupt disposable rows, disk-full and two SQLite writers. Compare OHLCV, ordering, uniqueness and requested upstream bounds, not just row counts.
- **Utility:** unknown fields/version, oversized batches, wrong profile/instrument, duplicate response, expired request, cross-generation live event, service crash during history/write/subscribe, late unsubscribe acknowledgement and full queue. No leaked timers/listeners/handles or secret-bearing error payloads.
- **Downstream compatibility:** building updates do not compound ATR/RSI state; historical correction produces rebuild/dirty metadata; chart and indicator see the same generation/revision. Preserve five-indicator limit, drawing non-persistence, live stale labels, and keyboard access to recovery controls.

### September 8 acceptance traceability

The current evidence record contains the exact test commands, fixture sizes,
wall times and remaining actions. Counts alone do not certify every permutation:

- Fanout, source sharing, derived native constituents, reconnect hydration,
  live/history races and fixed-origin alignment have existing provider-bridge,
  timeframe and cache regressions. The fresh affected run includes all 21
  provider-bridge cases; earlier full-unit evidence covers the timeframe tests.
- The added two-tick-tail/ten-tick case preserves all processed OHLCV and
  canonical revision metadata despite late history. This is synchronous
  processing followed by retained-tail eviction, not an unimplemented staged
  ingress queue or proof of backlog-repair performance.
- Added hydration cancellation/replacement and client crash/late-release tests
  prove tested ownership fences and exact cleanup. Client capacity/expiry and
  utility capacity/shutdown are covered separately. The fresh utility-runtime
  regression fills all 256 upstream slots, expires utility-owned deadlines while
  the utility remains alive, admits fresh work immediately and ignores late old
  results; the connected client/utility case also releases a late subscription.
- Real busy/full workspace failures preserve acknowledged rows and recovery;
  real full-cache failure returns all valid provider candles. Failed close-time
  flush remains rejected until retry is acknowledged. Existing renderer and
  launcher tests cover save retry and close retry/cancel.
- Migration coverage now compares every protected non-cache table, unchanged
  legacy migration records, empty disposable caches and a clean foreign-key
  check. Fresh-process cache equality and real shared-SQLite desktop cases
  remain covered without touching real provider credentials.
- The extended real utility smoke now covers active-renderer stale status,
  continued UI operation, pending history/write/subscribe rejection, prior
  acknowledged workspace preservation, old callback cleanup and distinct-PID
  restart. The new accessible stale label fixes an observed red smoke.
- Existing ATR/RSI provisional calculation, chart authoritative reset, worker
  revision, indicator-limit, drawing-exclusion and focus-independent-demand
  tests remain useful. **Production revision delivery now has direct coverage:**
  the central shell stores the full canonical series change alongside its cached
  candles, rejects stale generation/revision events, and the production-shell
  regression demonstrates historical correction, generation rollover and
  coalesced revision gaps reaching both chart reset and indicator rebuild paths.
- Actual ordinary shared-Chromium-profile startup and keyboard/screen-reader
  recovery remain manual. The two symlink fixtures require an already-permitted
  machine; they are reported skips, not a newly invented zero-skips gate.

## 7. Reproducible validation commands

Run from PowerShell and preserve the current implementation workspace. The
original design-stage assignment intentionally did not execute these commands;
Phase 6 has now run them against the existing dirty tree as instructed. See the
linked evidence record for fresh results and exceptions. Run one step at a time
and stop on nonzero exit; build commands write generated output.

```powershell
Set-Location 'D:\Dhana\My project\Binomo\ERC-Chart-Desktop-App'
node --version
npm --version
npm run build
npm run typecheck
npm run lint
node --test packages/data-service/test/*.test.mjs packages/storage/test/*.test.mjs packages/contracts/test/*.test.mjs
node --test packages/electron-main/test/*.test.mjs packages/preload/test/*.test.mjs apps/desktop/test/*.test.mjs packages/renderer/test/*.test.mjs
npm run test:unit
npm run test:integration
npm run smoke:electron
npm run smoke:workspace-restart
npm run smoke:multi-instance
npm run smoke:indicator-worker
npm run format:check
```

`test:unit` already builds; running `build` first is useful for the earlier focused commands, not a requirement to rebuild redundantly every iteration. Existing tests import `dist`; do not interpret stale/missing `dist` failures as source regressions. All script names above are present in current root `package.json`. The multi-instance smoke now also exercises shared application storage through a trusted test entry with separate Chromium session directories; actual shared-profile manual validation remains open as specified in phase 1.

Use the existing report checks only as a read-only baseline, until the corrected scenarios exist in repository tests:

```powershell
node 'C:\Users\Empire Rider\.cursor\projects\d-Dhana-My-project-Binomo-ERC-Chart-Desktop-App\canvases\ERC-audit-existing-checks.mjs'
node 'C:\Users\Empire Rider\.cursor\projects\d-Dhana-My-project-Binomo-ERC-Chart-Desktop-App\canvases\ERC-audit-reproductions.mjs'
```

For documentation formatting, use the already-installed Prettier directly; the root formatting script does not include `docs/superpowers/plans`:

```powershell
node node_modules/prettier/bin/prettier.cjs --check docs/superpowers/plans/2026-09-07-data-integrity-runtime-implementation.md
```

Network/package release gates are separate and require suitable authorization/environment: `npm run audit:ci`, `npm run package:win`, `npm run smoke:installer`, `npm run checksum:installer`. Installer smoke installs/uninstalls software; run on a disposable Windows test machine. Provider terms/protocol/authentication verification requires a separately approved test account; never put credentials in a command, report or fixture.

### Performance and backpressure evidence

**Measured now:** the linked Phase 6 evidence includes synthetic domain stress, post-GC lifecycle samples and real cache/utility/shared-storage process checks. The original design baseline contained 46 passing source-only checks. Test-run duration is not a chart-performance baseline; no before/after full-application measurements exist.

**Existing provisional acceptance targets**, from architecture section 5: 60 FPS normal pan/zoom; p95 frame time below 33 ms with four charts; p95 normalized-ingress-to-visible latency below 100 ms; p95 cached 100,000-candle open below 2 seconds; soft total-memory target below 1 GB for one window with four 100,000-candle charts and five workers per chart. Benchmark machine: Windows x64, four logical cores, 8 GB RAM, integrated graphics, SSD; final minimum hardware remains owner-approved.

**Proposed measurement procedure:** collect pre-cutover and post-cutover runs on identical hardware, dataset and build mode; 30 warm opens, 30 cold opens, ten minutes pan/zoom/live load, twenty indicator workers, then two concurrent instances sharing SQLite. Record frame intervals, per-process event-loop delay, ingress-to-paint timestamps, RSS/heap per process, upstream subscription/request counts, queue depth/high-water marks, cache hit/miss/range counts and SQLite busy/failure counts. Sum memory across main/renderer/utilities/workers; avoid double-counting shared OS pages where the measurement tool supports it.

Use a deterministic 100 ticks/second fixture with a 1,000 ticks/second burst for ten seconds as an engineering stress input, not a promised provider rate. Record measured throughput and backlog recovery time; no sustained resource growth after 100 acquire/release and 20 invalidate/restore cycles. Suggested acceptance: all logical handles/timers return to zero and post-GC retained heap reaches a stable plateau, rather than an arbitrary exact-byte equality.

Bound pending transport requests (initial proposed cap 256 per instance) and staged ingress (initial proposed cap 4096 ticks per source, matching the existing default tail capacity). These are proposed starting budgets, not measured safe limits. Reject excess new work with stable sanitized error codes. Batch history to bounded messages. Coalesce display-only building updates after canonical processing; never silently drop raw ticks and claim correct OHLCV. If an ingress queue overflows, invalidate/mark stale and repair from authoritative history; tick-only inputs without recoverable history must report data loss. Preserve finalized bars and earliest dirty range when coalescing. Test deadlines with injected schedulers. Provider retry/backoff remains adapter-owned; the data bridge must not multiply retries on top of it.

## 8. Persistence migration, compatibility, and rollback

### Workspace repair

New session IDs and owner checks use the existing schema. Legacy `last-workspace` remains untouched and readable; new code clones it. Renderer/preload wire shape can remain v1 through alias translation. Session recovery additions require strict new request validators, not a workspace schema bump. Do not auto-prune user documents to solve cache disk pressure.

Rolling back the application to current `0.3.6` reads only legacy `last-workspace`, not newer session rows. Keep a backup/export and a documented operator restore of a chosen session to the legacy ID **only while all instances are stopped**; an old binary must not run alongside newer writers during migration/recovery. Restoring an old backup discards subsequent changes unless those session documents are exported first. Never silently rewrite a shared workspace for rollback convenience.

### Cache schema and concurrency

At design baseline, storage migrations contained versions 1 and 2 while exported `databaseSchemaVersion` still equaled 1. The Phase 6 follow-up defines this export as the highest supported on-disk migration, now 3, and asserts equality in the storage tests. Historical migration records and SDK/IPC contract versions remain unchanged.

The cache identity change may rebuild only `candles` and `series_cache_state`. Back up the database consistently before migration. Either use a SQLite-supported backup operation or stop all application instances and checkpoint/close before copying; copying only the main file while WAL writers run is unsafe. Preserve workspace/profile/plugin/settings/credential-reference rows exactly. Never read the referenced credentials.

`openStorageDatabase` currently reads the migration version before entering each transaction. Two first-run instances can therefore observe the same old version. Re-read/apply migrations under the same `BEGIN IMMEDIATE` serialization boundary, with bounded busy handling and a two-process migration test, before expanding production multi-instance database use. This is a source-observed concurrency risk, not one of the five rerun reproductions.

Use short synchronous transactions; no awaits/network/aggregation inside `withTransaction`. Existing `busy_timeout=5000` is a starting behavior, not a complete retry policy. Coordinate a small bounded retry deadline with workspace-close/utility timeouts; report exhaustion instead of hanging. Cache writes may be retried idempotently; workspace writes retain latest dirty state until acknowledged. Avoid a full 5-second synchronous wait blocking live processing unnoticed: measure contention and tune connection timeout/batches in the utility.

Unknown newer migration versions already fail closed. Cache rollback may discard rebuildable cache data, but user data needs export/backup preservation and an explicit compatibility path. Do not weaken the newer-schema rejection merely to permit an old binary. Recovery/quarantine must never replace an entire database silently because one cache row is invalid.

### Internal transport compatibility

An additive private data-utility protocol can use current `ipcContractVersion` with new discriminants when all packaged processes ship together; change the version when existing message semantics become incompatible. Test mismatched runtime artifacts fail startup cleanly. Keep branded instrument/timeframe IDs validated at boundaries; illustrative strings in JavaScript fixtures are not permission to cast unknown provider values in production.

## 9. Review gates, risks, and remaining decisions

“Clean architecture” here means testable invariants: one mutable owner; public package imports only; small explicit commands; no secret-bearing transport; normalized canonical revisions shared by charts/indicators; bounded memory/work; deterministic disposal; durable acknowledged saves; and accurate status documentation. It does not mean speculative layers or a promise of perfection.

Required review questions:

- Does every async completion check service/profile generation before state mutation and delivery?
- Can a late release erase a replacement demand, or a late history response erase live extrema/volume?
- Does each deduplicated tick reach every affected source/target exactly once?
- Are all constituents present before a derived bucket is called complete?
- Does shutdown flush user documents before terminating the owner of SQLite?
- Can malformed IPC/cache/provider data fail locally without leaking secrets or poisoning unrelated series?
- Are recovery/error controls readable, keyboard-operable and tested?
- Do real process/SQLite tests supplement import-boundary lint?

Remaining owner decisions are narrow, not broad architecture preferences:

1. Approve the startup “new session cloned from newest valid copy” default and minimal prior-session recovery UX. Full named-workspace editing remains out of scope.
2. Approve cache identity migration details and final disk-retention policy (OD-007). Prefer correctness/isolation over reusing ambiguous existing cache rows.
3. Confirm supported fixed-origin/session alignment semantics; a full exchange calendar/DST model is not implied by current SDK fields.
4. Confirm crash recovery UX: offer bounded data-service restart and reconnect rather than an infinite automatic loop. Existing utility supervisor is single-start; restart must use a new supervised generation or an explicitly tested extension.
5. Confirm release hardware/signing/provider feasibility gates from the readiness record; this design cannot close them without their measurements and approvals.

No new dependency, provider protocol feature, chart rewrite, signal runtime, offline mode or generic storage framework is proposed. No implementation begins until this plan is reviewed.
