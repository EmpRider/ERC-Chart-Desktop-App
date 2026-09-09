# Indicator SDK v2 current-state inventory

**Jira:** ECDD-217  
**Parent:** ECDD-135 / ECDD-216  
**Baseline:** `main` at the start of the SDK v2 optimization work on 2026-09-09  
**Target design:** `docs/superpowers/specs/2026-09-09-indicator-sdk-v2-redesign-design.md`  
**Implementation plan:** `docs/superpowers/plans/2026-09-09-indicator-sdk-v2-redesign-implementation.md`

## Decision

The existing implementation is a strong runtime foundation, but it is not the final SDK v2 authoring model. The worker, incremental execution, provisional/finalized state handling, bounded state, drawing reconciliation, validation, and recovery paths should be retained where their contracts remain valid. The execution-order authoring model, manual persistence identity, manual history helpers, and legacy public authoring surface must be replaced.

There is no legacy indicator source compatibility requirement. Current indicators will be rewritten against the final v2 API after the SDK/runtime work is complete. Compatibility shims must not constrain the v2 design.

Provider-aware MTF acquisition and per-TA timeframe overrides remain owned by ECDD-142 and are not duplicated by this optimization work.

## Current implementation map

| Area | Current `main` | v2 assessment | Follow-up |
| --- | --- | --- | --- |
| Public SDK exports | `packages/indicator-sdk/src/index.ts` exports the scalar authoring API together with legacy/runtime-facing types and array-oriented helpers. | Replace with a v2-only public surface. Runtime-only contracts must stay internal. | ECDD-225, ECDD-226 |
| Authoring execution context | `authoring-context.ts` stores `kernelIndex`, `inputIndex`, `plotIndex`, and `signalIndex`; `useKernel()` restores state by execution position. | Blocking v2 gap. Runtime state needs stable hidden call-site identity. | ECDD-219, ECDD-220 |
| Indicator execution | `indicator.ts` already separates discovery, historical replay, building bars, finalized bars, committed drawings, signals, and bounded snapshots, but explicitly rejects changed input/TA/plot order. | Preserve the committed/provisional lifecycle; replace order-based identity and unconditional-call restrictions. | ECDD-220, ECDD-221 |
| Inputs | `input.ts` discovers inputs by index and defaults persistence keys to `input_<index>`; authors can supply explicit keys. Parameter normalization already handles missing/stale/invalid values safely. | Keep normalization. Replace declaration-order persistence with compiler-generated stable identity and remove normal author-written keys. | ECDD-219, ECDD-220, ECDD-225 |
| Source/history model | `series.ts` exposes current-candle price helpers plus `series`, `appendSeries`, and `laggedValue`; maintained complex indicators keep their own bounded history arrays. There is no canonical `close[1]`, `close.at(1)`, or `history(close, 1)` source-history contract. | Blocking v2 gap. Add one canonical committed/provisional history engine and compiler history lowering. | ECDD-218 |
| Stateful TA | Stateful scalar TA kernels already execute incrementally and use committed/provisional state through `useKernel()`. Kernel identity is positional and calls must remain unconditional/in the same order. | Keep efficient kernels; re-key state by hidden call-site identity and allow conditional execution. | ECDD-219, ECDD-220, ECDD-221 |
| Scalar plots | `plot.ts` assigns `plot_<index>` keys and validates plot declarations by execution position. Conditional value-plot calls are rejected. | Replace positional identity; conditional plots must keep stable metadata/settings. | ECDD-219, ECDD-221 |
| Shapes | `plot.shape` currently reuses scalar plot metadata and supports direction, color and width, but does not expose the final v2 text/text-color/text-size contract. | Complete the v2 marker text contract and renderer mapping. | ECDD-223 |
| Persistent drawings | The drawing engine already reconciles committed/provisional geometry and bounded retention, but `plot.box`, `plot.segment`, `plot.remove`, and `plot.drawings` require author-controlled IDs/scope keys. | Keep reconciliation internals; replace normal author IDs/scopes with hidden call-site/object identity and a handle-style public API. | ECDD-219, ECDD-222 |
| Signals | `signal.ts` emits finalized-only signals, which is a useful correctness foundation. Default identity is `signal_<index>` and explicit author IDs are supported. | Preserve finalized-only lifecycle; generate stable identity internally and permit conditional calls. | ECDD-219, ECDD-221, ECDD-222 |
| Worker runtime | `packages/indicator-runtime/src/worker-entry.ts` already supports full snapshot/rebuild plus incremental building/rollover updates, validates bounded output, and transmits visuals only when `visualRevision` changes. | Preserve this boundary and adapt it to final v2 state/source contracts rather than rebuilding the transport model. | ECDD-220, ECDD-227, ECDD-229 |
| Renderer orchestration | `packages/renderer/src/indicator-worker-runtime.ts` retries with a rebuild when the worker requires a snapshot and rejects stale data/config generations. | Preserve recovery/generation safety. Extend only for final v2 plot/drawing payloads. | ECDD-223, ECDD-227 |
| Maintained examples | `atr-rope-utbot.ts` is already on the scalar authored runtime, but it still contains explicit input keys, custom retained histories, drawing IDs/scopes, and other v1.5-era authoring patterns. | Rewrite against final v2 syntax after the primitives are complete; use it as a migration/regression fixture. | ECDD-224, ECDD-228 |
| Authoring docs | `INDICATOR-AUTHORING.md` documents legacy API support, positional/unconditional restrictions, manual keys, manual drawing IDs/scopes, and bounded custom history helpers as normal usage. | Rewrite around the v2-only contract after APIs stabilize. | ECDD-226 |
| Contract tests | Existing SDK/runtime tests cover provisional replacement, rollover, bounded state, invalid declarations, worker recovery, and snapshot validation. They do not prove stable call-site identity, source-history syntax parity, source reordering, or conditional stateful calls. | Retain current correctness coverage and add explicit v2 fixtures. | ECDD-227, ECDD-228 |
| Performance gates | Existing tools exercise large history, structured series, drawings, ATR/tick paths, and worker budgets. The current docs explicitly do not claim a real multi-chart application FPS/live-update guarantee. | Preserve/tighten component gates and add a real multi-chart authored-indicator live-update gate. | ECDD-229 |

## Keep versus replace

### Keep and adapt

- Incremental history/building/rollover execution instead of full-history work on every live update.
- Committed/provisional rollback semantics for state and drawings.
- Bounded series, points, drawings, and signals.
- Runtime snapshot validation and dense timeline validation.
- Worker snapshot/rebuild recovery and stale-generation checks.
- Stateful O(1) or amortized O(1) TA kernels where already implemented correctly.
- Host-side input normalization for stale, missing, invalid, bounded, and stepped values.
- Finalized-only committed signal emission.

### Replace for final v2

- Execution-order identity for inputs, TA kernels, recurrence, plots, drawings, and signals.
- `input_<index>`, `plot_<index>`, `signal_<index>`, and normal author-written persistence keys/IDs.
- The rule that stateful calls must be unconditional and execute in identical order on every bar.
- Author-maintained history arrays as the normal way to read prior source values.
- Normal author-facing `plot.drawings(key, ...)`, `plot.remove(id)`, and drawing IDs.
- Legacy/array authoring exports and documentation that would force compatibility constraints onto v2.

## Gap classification and implementation order

1. **Source/history contract — ECDD-218.** Define the canonical source object/history semantics before other v2 runtime work depends on them.
2. **Compiler identity — ECDD-219.** Generate stable hidden identities for every stateful/declarative authoring call.
3. **Runtime identity storage — ECDD-220.** Move settings/state/output persistence from positional arrays to generated identities while retaining committed/provisional execution.
4. **Conditional execution — ECDD-221.** Remove same-order/unconditional restrictions after identity is stable.
5. **Drawing/signal identity — ECDD-222.** Remove normal author persistence IDs and expose v2 lifecycle semantics.
6. **Shape text — ECDD-223.** Complete marker text/text-size behavior through SDK, runtime payload, and renderer.
7. **Example migration — ECDD-224.** Rewrite ATR Rope and UT Bot using only the final v2 API.
8. **Public export cleanup — ECDD-225.** Remove v1-only authoring/runtime exports; no compatibility layer is required.
9. **Documentation — ECDD-226.** Publish only the final v2 authoring model and explicitly defer MTF/provider work to ECDD-142.
10. **Contract fixtures — ECDD-227.** Lock identity, conditional execution, history parity, provisional rollback, finalized advancement, and drawing reconciliation.
11. **Migration regressions — ECDD-228.** Prove rewritten ATR Rope/UT Bot outputs remain correct on equivalent candles.
12. **Performance gates — ECDD-229.** Retain current component budgets and add large-history, live/provisional, finalized, and real multi-chart live-update gates.

## ECDD-217 acceptance check

- A current implementation map exists above for SDK, runtime, worker, renderer, examples, docs, tests, and performance tooling.
- Gaps are classified into public API, compiler/transform, runtime/state, examples, documentation, tests, and performance work with explicit Jira ownership.
- Already-complete runtime foundations are identified so later tasks change only what final v2 requires.
- MTF/provider-specific source acquisition remains explicitly deferred to ECDD-142.
