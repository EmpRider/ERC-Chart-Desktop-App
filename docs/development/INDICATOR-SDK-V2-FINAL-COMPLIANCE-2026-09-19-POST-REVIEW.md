# Indicator SDK v2 Final Compliance — ECDD-263 Post-Review Refresh

**Date:** 2026-09-19

**Task:** ECDD-263 — SDK v2 refresh final compliance after comprehensive review
corrections

**Task branch:** `task/ECDD-263-final-compliance-refresh`

## Authority and evidence rule

This is the current final compliance artifact after the governed
ECDD-242..ECDD-262 comprehensive-review correction sequence. The original
ECDD-241 checklist in `INDICATOR-SDK-V2-FINAL-COMPLIANCE-2026-09-19.md` remains a
historical snapshot and is intentionally not rewritten.

The requirements below are derived from:

- `docs/superpowers/specs/2026-09-09-indicator-sdk-v2-redesign-design.md`;
- `docs/superpowers/specs/2026-09-15-indicator-sdk-v2-pine-semantics-correction-design.md`;
- `docs/superpowers/plans/2026-09-15-indicator-sdk-v2-pine-semantics-correction-implementation.md`;
- `docs/development/INDICATOR-SDK-V2-CURRENT-STATE.md`;
- current public SDK/compiler/runtime/maintained-indicator source and fresh gates.

Historical intent is not proof. A row is PASS only when current code plus a
fresh verification path covers the requirement. Delivery evidence that can only
exist after a future merge is explicitly external and must be recorded in
GitHub/Jira rather than fabricated in this file.

## Design-to-code acceptance matrix

|   # | Normative requirement                                                                                                                                     | Current implementation evidence                                                                                                                                                                                          | Verification evidence                                                                                                      | Status                    |
| --: | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
|   1 | One public metadata-only top-level SDK v2 authoring model.                                                                                                | `packages/indicator-sdk/src/index.ts` exposes metadata, `input`, scalar `ta`, plots/drawing handles, signals, history, constants and whole-indicator controls; package exports expose only the public root.              | Fresh integration/public-surface negatives plus `npm run build:plugins`.                                                   | PASS                      |
|   2 | Direct price/bar globals and ordinary helpers use compiler-owned hidden identity.                                                                         | Script/callsite/history transforms own generated evaluator bindings and identity; maintained source receives no ERC context parameter.                                                                                   | Fresh top-level/callsite/history compiler coverage in the 303/303 integration run.                                         | PASS                      |
|   3 | Inputs have static identity, source semantics and dynamic-multiplicity rejection.                                                                         | Compiler extracts declarations and source inputs while runtime source tokens remain internal.                                                                                                                            | Fresh input identity/reorder/helper/loop/recursion package coverage in integration.                                        | PASS                      |
|   4 | History, scalar recurrence, persistent `var`, rollback, reset and bounds match Pine-style semantics.                                                      | History lowering keeps bar-derived values series-capable, genuine arrays distinct, scalar/persistent state hidden and bounded. ECDD-262 additionally aligns derived bracket/`.at(1)` classification with lowering arity. | Fresh derived-history, genuine-array and unsupported-`.at()` regressions plus recurrence/persistent-state package tests.   | PASS                      |
|   5 | Approved `ta.*` overloads preserve replay, MTF provenance and bounded complexity.                                                                         | Compiler canonicalizes supported overloads; runtime kernels retain committed/provisional state and provenance.                                                                                                           | Fresh integration overload/provenance coverage; 100,000-update TA complexity gate passed for all required kernels.         | PASS                      |
|   6 | Persistent drawings use opaque handles with stable identity and unchanged 2,000 safeguards.                                                               | `plot.box()`/`plot.segment()` handles own hidden identity; `.set()`/`.delete()` update one logical drawing and survive persistent-state rollback/reorder.                                                                | Fresh handle/reorder regressions; 100,000 x 2,000 drawing gate and 10,000-bar POC stress passed.                           | PASS                      |
|   7 | ATR Rope + UT Bot contains domain logic only and preserves accepted semantics.                                                                            | Maintained source uses metadata-only top-level inputs/globals, TA/history, persistent domain state, opaque drawing handles and finalized signals.                                                                        | Fresh 9/9 maintained-indicator suite plus compiled semantic/provisional/reorder integration fixtures.                      | PASS                      |
|   8 | No public legacy indicator authoring compatibility remains.                                                                                               | No public callback/context, recurrence facade, source-token table, positional drawing sync or compatibility export path is exposed. Internal runtime helpers remain internal only.                                       | Fresh maintained-source forbidden-surface search and public-root negative coverage.                                        | PASS                      |
|   9 | Provider/MTF acquisition and source lifecycle remain host-owned and no-lookahead.                                                                         | Shared source engine owns native/derived acquisition, timeframe selection/alignment, revisions and leases.                                                                                                               | Fresh integration source planning/provenance/signal dependency coverage; exact-head full performance remains row 14.       | PASS                      |
|  10 | Heikin Ashi transform order, recursive rollback, source identity and provenance remain correct.                                                           | Target timeframe construction precedes HA; synthetic identity/provenance and bounded recursive seed remain host-owned.                                                                                                   | Fresh integration runtime/source regressions preserve the accepted HA/source contract.                                     | PASS                      |
|  11 | Signals commit only finalized/source-confirmed events and preserve replay equivalence/no-lookahead.                                                       | Compiler traces dependencies; runtime commits finalized confirmed-source identities and replaces stale corrected-history results.                                                                                        | Fresh finalized-only flagship tests plus compiler dependency/provisional/replay integration coverage.                      | PASS                      |
|  12 | Dependency DAG validates bindings/order/history and enforces aggregate bounds.                                                                            | Runtime validates explicit instance/output bindings, topologically orders them, preindexes history and caps aggregate payload at 400,000 points.                                                                         | Fresh integration dependency coverage plus 400,000-point payload gate, max 1,114.19 ms < 5,000 ms.                         | PASS                      |
|  13 | Worker/runtime/renderer boundaries preserve typed transport, stale rejection, quotas, recovery and cleanup.                                               | Typed-array snapshots/bounded deltas, generation/revision fencing, worker quotas/restart bounds and cleanup remain host/runtime concerns.                                                                                | Fresh integration supervisor/orchestration coverage, worker smoke, and snapshot materialization max 31.93 ms < 60,000 ms.  | PASS                      |
|  14 | Performance/resource coverage exercises the approved large-history and multi-instance limits.                                                             | Existing limits remain unchanged, including 2,000 drawing/change and 400,000 dependency-point safeguards.                                                                                                                | Fresh full `test:performance` under Node 26.8.1 plus the 10,000-bar flagship stress; all configured budgets passed.        | PASS                      |
|  15 | Maintained examples and current public docs teach only corrected SDK v2.                                                                                  | `atr-bands.ts`, `atr-rope-utbot.ts`, `INDICATOR-AUTHORING.md` and README use/describe the corrected top-level model.                                                                                                     | Fresh production plugin build, full SDK-v2 doc re-read, and maintained-source forbidden-surface scan.                      | PASS                      |
|  16 | Current-state documentation preserves chronology while reflecting all review corrections.                                                                 | ECDD-241 remains historical; current-state chronology now includes ECDD-242..ECDD-262 and this ECDD-263 refresh.                                                                                                         | Current documentation diff plus prior exact-tree format/lint and fresh `git diff --check`.                                 | PASS                      |
|  17 | Repository-wide exact-tree correctness, format, lint, type, build, integration, maintained-indicator, performance, Electron, version and diff gates pass. | No implementation exception is allowed for documentation refresh.                                                                                                                                                        | Fresh Node 26.8.1/npm 12.0.2 local gates plus exact-head Delivery, Semgrep and required CodeRabbit status.                 | PASS                      |
|  18 | Task-to-epic and epic-to-main governance is satisfied without stale review evidence.                                                                      | Task merge uses current-head required statuses/conversation resolution; epic promotion additionally requires comprehensive CodeRabbit and the configured manual review sequence.                                         | GitHub/Jira exact-head evidence. A tracked commit cannot prove its own future merges, so final merge evidence is external. | EXTERNAL DELIVERY PENDING |

## Fresh ECDD-263 verification

The ECDD-263 tree has only documentation changes over merge
`237701774ac4d3da31a474fb5294817f205fcd15`; no SDK/runtime source is modified by
this task. Fresh/current-tree evidence collected before the task PR includes:

- `npm run format:check`: PASS;
- `npm run lint`: PASS;
- `npm run typecheck`: PASS;
- `npm run build`: PASS;
- `npm run test:unit`: 654 total, 652 PASS, 0 FAIL, 2 expected Windows
  symlink-capability skips;
- `npm run test:integration`: 303/303 PASS, 0 FAIL, 0 skipped. This fresh run
  includes derived-history/genuine-array/unsupported-`.at()` ECDD-262 coverage,
  compiler identity/input/source/TA/signal behavior, ATR Rope semantic parity,
  provisional replacement and drawing identity;
- `npm run test:legacy-indicators`: 9/9 PASS, including the 10,000-bar POC
  migration stress and paginated-history drawing-update case;
- `npm run build:plugins`: PASS; built Binomo, ATR Rope + UT Bot and ATR Bands;
- Electron development, workspace-restart, multi-instance and indicator-worker
  smokes: PASS under Node `26.8.1` / npm `12.0.2`;
- `npm run version:check`: PASS (`Workspace boundaries: valid`);
- `git diff --check`: PASS;
- maintained-source audit: no `readInputs`, `priceSources`, `priceValue`, public
  `series(...)`, `appendSeries`, `laggedValue`, `plot.sync`, `plot.drawings`,
  `plot.remove`, `ctx`, or `runtimeIdentity` use under
  `packages/indicator-examples/src`; the SDK public root exports `history` but
  does not export `series`, `priceSources`, or `priceValue`;
- full `npm run test:performance`: PASS under Node `26.8.1`. Representative
  exact-tree measurements were authoring transform overhead 39.38 ms < 100 ms;
  package build 658.79 ms < 5,000 ms; 100,000-bar persistent history 699.83 ms;
  100,000-bar runtime identity 40,706.86 ms < 60,000 ms with maximum building
  update 1.46 ms < 100 ms; worker snapshot materialization maximum 45.72 ms <
  60,000 ms; 400,000 dependency points 1,025.08 ms < 5,000 ms; 100,000 bars
  with 4,096 retained persistent items 7,158.14 ms; all required 100,000-update
  TA kernels below 9 ms < 1,000 ms; 100,000 bars with 2,000 stable drawings
  25,306.57 ms < 60,000 ms; 250 bars x 2,000 real drawing updates 298.29 ms <
  5,000 ms; 100,000-bar ATR Rope history 18,950.14 ms; provider MTF alignment
  657.23 ms < 60,000 ms; renderer MTF alignment 11.46 ms < 1,000 ms; and the
  four-chart/four-worker 100,000-bar workload 25,365.20 ms < 60,000 ms with a
  maximum building update of 1.37 ms < 100 ms;
- `audit:ci`: PASS under Node `26.8.1` / npm `12.0.2` with 0 vulnerabilities;
- exact-head GitHub Delivery run `35446405658`: PASS for Governance and aggregate
  Delivery. The Windows application job was correctly skipped because ECDD-263
  changes documentation only. Exact-head Semgrep and the required CodeRabbit
  status are PASS.

## Anti-drift review

The design/specification, implementation plans, authoring guide, current-state
inventory, performance assessment and review runbook were re-read before this
review. Answers from current source plus the fresh evidence above are:

1. **PASS** — maintained indicators use metadata-only `defineIndicator` plus
   top-level Pine-style inputs/globals/TA/plots/drawings/signals.
2. **PASS** — normal authoring exposes no runtime callback/context, persistence
   IDs, worker messages, revisions or replay plumbing.
3. **PASS** — maintained source audit found domain state/logic, not ERC lifecycle
   machinery; runtime source helpers remain internal SDK implementation details.
4. **PASS** — the public root still presents one corrected SDK-v2 model; package
   compilation rejects callback-shaped/escape authoring paths.
5. **PASS** — no legacy authoring compatibility facade has returned; maintained
   source and public-root negatives are clean.
6. **PASS** — compiler identity/history, SDK semantics, source acquisition,
   worker transport and renderer mapping remain in their approved layers.
7. **PASS** — fresh history/recurrence/persistent-state tests cover finalized
   commit, building rollback, rebuild reset, isolation and bounds.
8. **PASS** — finalized-only flagship tests and dependency-tracing integration
   preserve source confirmation, replay/provisional behavior and no-lookahead.
9. **PASS** — provider/MTF acquisition, source identity/revision and dependency
   provenance remain host/runtime-owned rather than authored.
10. **PASS** — current runtime/source tests retain post-timeframe HA semantics,
    recursive building rollback and synthetic provenance.
11. **PASS** — dependency validation/order/history behavior remains runtime-owned;
    the fresh 400,000-point gate remains bounded.
12. **PASS** — worker supervisor/runtime integration and worker smoke preserve
    stale rejection, quotas, deterministic failure settlement/recovery and
    cleanup; snapshot materialization remains bounded.
13. **PASS** — ATR Bands and ATR Rope/UT Bot remain domain-focused and the
    forbidden-plumbing source scan is clean.
14. **PASS** — fresh maintained/integration suites preserve accepted ATR Rope
    outputs/signals, provisional/finalized semantics and stable persistent POC
    drawing identity, including the 10,000-bar migration stress.

## Completion rule

ECDD-263 may merge task-to-epic only after rows 1–17 are PASS, all 14 anti-drift
answers are PASS with fresh evidence, no required gate has an unexplained
failure, and current documentation matches the observed implementation. Row 18
is completed externally through governed task and epic promotion evidence in
GitHub/Jira.
