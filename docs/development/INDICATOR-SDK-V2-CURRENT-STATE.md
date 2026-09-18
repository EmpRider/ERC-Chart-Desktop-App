# Indicator SDK v2 current-state inventory

**Original redesign:** ECDD-216 / ECDD-217 and follow-up tasks

**Pine-semantics correction:** ECDD-236 through ECDD-241 under ECDD-135

**Original design:** `docs/superpowers/specs/2026-09-09-indicator-sdk-v2-redesign-design.md`

**Correction design:** `docs/superpowers/specs/2026-09-15-indicator-sdk-v2-pine-semantics-correction-design.md`

**Correction plan:** `docs/superpowers/plans/2026-09-15-indicator-sdk-v2-pine-semantics-correction-implementation.md`

## Current decision

Indicator SDK v2 has one public authoring model: metadata-only
`defineIndicator(...)` followed by Pine-style top-level TypeScript/JavaScript
statements using direct price globals, `bar`, `input.*`, `ta.*`, `plot.*`,
`signal()`, history indexing, and compiler-managed persistent `var` state.

Authors do not create a per-bar runtime callback/context, persistence IDs,
execution-order counters, source-option tables, replay/finalization plumbing,
worker messages, provider subscriptions, or positional drawing reconciliation.
Those mechanics remain in the compiler/SDK/runtime/host layers.

There is no legacy indicator authoring compatibility requirement. The public SDK
root intentionally exposes only the v2 authoring facade and author-relevant
metadata/result types. Internal runtime helpers may continue to exist when the
worker/runtime requires them; they are not compatibility promises.

### Correction chronology

The September 14 Phase 16 acceptance was valid evidence for the implementation
that existed at that time, but it is **not** the final acceptance evidence for the
Pine-semantics correction discovered on September 15. The correction work keeps
that historical evidence visible while superseding its author-experience claims.

- **ECDD-236** restored metadata-only top-level authoring, direct bar globals,
  concise inputs, source inputs, and compiler lowering.
- **ECDD-237** added compiler-managed scalar recurrence and Pine-style persistent
  `var` state with committed/provisional semantics and bounded collections.
- **ECDD-238** replaced positional dynamic-drawing reconciliation with opaque
  persistent box/segment handles.
- **ECDD-239** rewrote ATR Rope + UT Bot so remaining complexity is indicator
  domain logic rather than ERC runtime plumbing.
- **ECDD-240** removed legacy public authoring compatibility and kept authored
  packages behind the v2 compiler boundary.
- **ECDD-241** is the active final design-to-code compliance, documentation,
  regression, performance, and delivery-governance acceptance task for the
  correction epic. Fresh local implementation/performance evidence is recorded
  below; exact-head pull-request CI and task/epic promotion remain delivery gates
  until their live GitHub evidence exists.

No correction task rewrites the historical design documents to hide the
chronology. This file describes the current implementation instead.

### ECDD-241 fresh local acceptance evidence — 2026-09-19

The final audit re-read both approved SDK-v2 designs before assigning compliance
status. The implementation audit found no remaining maintained-source dependency
on the removed public recurrence/source-plumbing APIs and no author-visible
runtime lifecycle/context path.

Fresh local gates on `task/ECDD-241-final-sdk-v2-compliance`:

- build, format, workspace-boundary/lint and typecheck: PASS;
- unit: 653 total, 651 PASS, 0 FAIL, 2 expected Windows symlink skips;
- integration: 291/291 PASS;
- maintained indicator examples: 9/9 PASS;
- Electron runtime smoke: PASS;
- complete `test:performance`: PASS, including 100,000-bar history/runtime,
  2,000 drawings, 400,000 dependency points, provider-aware MTF, renderer
  alignment and four-chart/four-worker orchestration;
- dedicated 10,000-bar ATR Rope + UT Bot POC migration stress: PASS with a
  structural maximum of 440 retained overlays, below the unchanged 2,000
  drawing safeguard;
- version and `git diff --check`: PASS.

Local `audit:ci` is not counted as a product failure: this workstation is
running Node 25.9.0 / npm 11.19.0 with user-level `allow-scripts=9router`, while
the repository pins Node 26.8.1 / npm 12.0.2. The command therefore stops with
`EALLOWSCRIPTS`. The exact-head Delivery workflow must run the audit with the
pinned toolchain before ECDD-241 can be accepted or merged.

## Current implementation map

| Area                          | Current SDK v2 state                                                                                                                                                                                                                                                                                                                                            | Acceptance requirement                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Public authoring surface      | `packages/indicator-sdk/src/index.ts` exposes metadata-only `defineIndicator`, `input`, scalar `ta`, plots/drawing handles, signals, history, constants, whole-indicator controls, and author-relevant types. Runtime instance/snapshot contracts, source tokens, old history helpers, flat TA aliases, and low-level kernels are not public authoring exports. | Public-surface negative type tests must remain green; no compatibility facade may be reintroduced.                                      |
| Script execution model        | `script-transform.mjs` lowers one exported metadata-only declaration plus top-level script statements into the hidden runtime calculation callback. Direct `open/high/low/close/volume/hl2/hlc3/ohlc4` and `bar.index/time/confirmed` are compiler supplied.                                                                                                    | Maintained indicator source must not contain host/runtime context plumbing.                                                             |
| Inputs                        | Input declarations use compiler-generated stable identity. Concise titled overloads and advanced options are supported. Dynamic input multiplicity through loops/recursion fails at build time.                                                                                                                                                                 | `input.source(close, ...)` must own source selection without author source-token tables/switches.                                       |
| History and scalar recurrence | `close[n]` and derived-value history are compiler-lowered to hidden history state. Ordinary scalar recurrence commits finalized values and rolls building updates back to the same committed predecessor. `history(value, n)` remains an advanced explicit spelling.                                                                                            | Replay, building replacement, finalization, corrected-history reset, and unavailable-history behavior must agree.                       |
| Persistent domain state       | Authored `var` declarations lower to hidden persistent slots with stable declaration/invocation identity, initialize-once semantics, copy-on-write building rollback, finalized commit, rebuild reset, and the existing 4,096 collection-item bound.                                                                                                            | State must exist only for indicator/domain needs; SDK-owned opaque handles must preserve reference identity through state cloning.      |
| Stateful TA                   | Scalar TA kernels remain incremental with committed/provisional state. The authoring compiler canonicalizes ambiguous length-first source overloads such as `ta.ema(20, open)` and `ta.rsi(14, open)` before runtime execution while retaining direct-series provenance for MTF/signal semantics.                                                               | Source-first and approved length-first forms must be execution-equivalent; TA complexity gates remain bounded.                          |
| Plots and shapes              | Compiler-generated plot declarations provide hidden stable output identity. Shape location/text/text-size semantics flow through SDK, contracts, worker results, and renderer mapping.                                                                                                                                                                          | Conditional execution must not depend on unrelated call order.                                                                          |
| Persistent drawings           | `plot.box()` / `plot.segment()` return opaque handles. Creation assigns hidden logical identity once; `.set()` mutates geometry and `.delete()` removes it. Handle identity survives persistent-state cloning, insert/reorder/prune operations, and building rollback.                                                                                          | Keep the 2,000 drawing/change safeguards; do not solve churn by raising limits or exposing drawing IDs.                                 |
| Maintained examples           | `atr-bands.ts` is the compact canonical example. `atr-rope-utbot.ts` uses top-level inputs/globals, compiler-managed `var`, natural TA/history, finalized signals, and zone-owned drawing handles; its remaining state is Rope/UT Bot/POC/follow/MG domain state.                                                                                               | The production-like 10,000-bar POC migration regression must complete within the 2,000 drawing retention/change bounds.                 |
| Provider/MTF source engine    | ECDD-142 supplies provider-aware native/derived timeframe resolution, shared source acquisition, whole-indicator timeframe selection, and per-TA timeframe acquisition/alignment.                                                                                                                                                                               | No finalized lookahead; source leases/subscriptions and fallback remain host-owned.                                                     |
| Synthetic candles             | ECDD-232 keeps standard and Heikin Ashi as distinct source identities. Target timeframe construction occurs before HA transformation; repeated building revisions derive from finalized HA state and bounded-window advancement carries recursive seed/provenance.                                                                                              | Authors do not maintain HA buffers, rollback state, or synthetic provenance.                                                            |
| Signals                       | ECDD-233 commits only finalized events whose compiler-traced chart/TA/MTF dependencies are ready and source-confirmed. Commitment identity follows the confirmed source candle; corrected-history replay replaces stale downstream results.                                                                                                                     | No building-bar commitment, duplicate replay/live events, or lower-timeframe confirmation of an open higher-timeframe source candle.    |
| Cross-indicator dependencies  | ECDD-143/ECDD-149 validate explicit instance/output bindings before activation, reject missing/self/duplicate/circular/invalid bindings, order a runtime-owned DAG deterministically, preindex dependency history, and bound aggregate dependency payload to 400,000 points.                                                                                    | Dependency plumbing and transport keys stay outside normal indicator authoring.                                                         |
| Worker/runtime boundary       | ECDD-140/ECDD-145 retain validated columnar history/rebuild snapshots, bounded candle deltas, generation/revision rejection, quotas, deterministic failure settlement, restart behavior, output caps, and typed validation.                                                                                                                                     | Full-history/rebuild traffic and live deltas must remain bounded and stale work must not mutate current state.                          |
| Renderer orchestration        | Renderer code materializes source/dependency snapshots, keeps live updates incremental, rebuilds when required, rejects stale generations, maps outputs/drawings, and executes the dependency DAG upstream-first.                                                                                                                                               | Four-chart/four-worker acceptance and recovery/resource cleanup remain required.                                                        |
| Documentation                 | `INDICATOR-AUTHORING.md` now documents only metadata-only top-level v2 authoring, direct globals/history, `var`, source inputs, approved TA overloads, persistent drawing handles, source-confirmed signals, MTF, and HA.                                                                                                                                       | Example code in current docs must compile through the production authoring pipeline and must not teach removed author/runtime plumbing. |
| Performance/resource gates    | Existing gates cover large history, provisional/finalized updates, TA complexity, drawing workloads, worker materialization, MTF, renderer alignment, 400,000-point dependency payloads, and four-chart orchestration.                                                                                                                                          | ECDD-241 must rerun the complete exact-head gate plus the 10,000-bar flagship drawing stress before promotion.                          |

## Public/private boundary

The following are normal author concerns:

- indicator metadata;
- input declarations and settings metadata;
- direct current-bar prices and derived values;
- indicator mathematics and helper functions;
- history indexing and genuine persistent domain state;
- TA, plots, drawing handles, and signal conditions;
- requested whole-indicator/per-TA timeframe and candle type.

The following remain platform concerns:

- hidden call-site/persistence identity;
- discovery/replay/building/finalized execution phases;
- committed/provisional snapshots and corrected-history rebuilds;
- source-option tokens and provider acquisition/subscriptions;
- MTF aggregation/alignment and HA recursive transform state;
- worker generations/revisions, quotas, restart/recovery, and transport encoding;
- drawing registries/reconciliation/retention;
- signal event keys, deduplication, source revisions, and provenance;
- dependency graph scheduling and snapshot transport;
- host settings normalization.

If code is necessary only because ERC Chart has those runtime mechanics, it must
not be moved back into maintained indicator source.

## Preserved runtime foundations

The correction intentionally preserves runtime mechanisms that already satisfy
the approved design:

- incremental history/building/finalized execution;
- committed/provisional rollback semantics;
- 100,000-candle/result retention bounds and bounded state/drawings/signals;
- O(1) or amortized-O(1) steady-state TA kernels where applicable;
- provider-aware MTF source sharing/alignment;
- post-timeframe Heikin Ashi transformation and provenance;
- source-confirmed/no-lookahead signals;
- validated dependency DAG/bounded dependency payloads;
- typed worker snapshots/deltas, stale-generation rejection, quotas, and restart;
- renderer recovery and resource cleanup.

These mechanisms may be refactored behind their boundaries when required by the
corrected authoring model; they are not removed merely because authors no longer
see them.

## Correction acceptance checklist

ECDD-241 is complete only when fresh exact-head evidence marks every row below
PASS (or records an explicitly approved exception):

1. one public metadata-only top-level authoring model;
2. direct globals/helpers with compiler-owned hidden identity;
3. static input identity, source inputs, and dynamic-multiplicity rejection;
4. history, scalar recurrence, persistent `var`, rollback, and bounds;
5. approved `ta.*` overloads, replay behavior, MTF provenance, and complexity;
6. opaque persistent drawing handles with stable identity and unchanged bounds;
7. ATR Rope + UT Bot domain-only source and semantic parity;
8. no public legacy authoring compatibility;
9. provider/MTF acquisition and source lifecycle;
10. Heikin Ashi transform order, recursive rollback, and provenance;
11. finalized/source-confirmed signals, replay equivalence, and no-lookahead;
12. dependency DAG validation/order/history/bounds;
13. worker/runtime/renderer validation, quotas, recovery, and cleanup;
14. 100,000-bar/update, 400,000-dependency-point, four-chart/four-worker, MTF,
    drawing, and 10,000-bar flagship performance/resource coverage;
15. maintained examples and current public docs match the corrected surface;
16. current-state documentation supersedes the September 14 author-experience
    acceptance claim without falsifying its historical chronology;
17. repository-wide exact-head correctness/audit/version/format gates pass;
18. task-to-epic and epic-to-main delivery governance is satisfied.

After those checks, the correction task must repeat the design review with these
anti-drift questions: does source match the approved design, expose runtime
details, add ERC architecture to indicator code, weaken Pine-like authoring,
restore compatibility, place abstractions in the wrong layer, preserve
committed/provisional semantics, preserve no-lookahead, preserve MTF/provider and
HA behavior, preserve dependencies, preserve worker/resource bounds, make author
code simpler, and leave the flagship ATR Rope + UT Bot source cleaner rather than
more framework-aware?

## Historical acceptance and release notes

The original redesign sequence (ECDD-218 through ECDD-229 plus ECDD-232,
ECDD-233, ECDD-140, ECDD-145, ECDD-143/ECDD-149) established the runtime/source
foundations listed above. PR #157 / merge `990353bc8ad2022504c367f1baaee52caa4d8c90`
recorded the September 14 Phase 16 acceptance of that then-current model.

PR #161 later promoted that accepted state to `main`, followed by the `1.1.0`
release remediation. Those events remain valid history. They do not override the
September 15 correction design or substitute for ECDD-241's fresh final
design-to-code acceptance.
