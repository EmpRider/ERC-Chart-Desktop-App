# Indicator SDK v2 Final Compliance Checklist — ECDD-241

**Date:** 2026-09-19
**Task:** ECDD-241 — Finalize docs, performance gates, and design compliance audit
**Branch:** `task/ECDD-241-final-sdk-v2-compliance`

## Authority

This checklist is derived before the final implementation audit from:

- `docs/superpowers/specs/2026-09-09-indicator-sdk-v2-redesign-design.md`
- `docs/superpowers/specs/2026-09-15-indicator-sdk-v2-pine-semantics-correction-design.md`
- `docs/superpowers/plans/2026-09-15-indicator-sdk-v2-pine-semantics-correction-implementation.md`
- `docs/development/INDICATOR-SDK-V2-CURRENT-STATE.md`

No row is considered complete from historical intent alone. Final status requires fresh
exact-head code, test, performance, documentation, and delivery evidence.

## Design-to-code acceptance matrix

|   # | Normative requirement                                                                                                                                       | Fresh evidence                                                                                                                                                                                                  | Status           |
| --: | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
|   1 | One public metadata-only top-level SDK v2 authoring model.                                                                                                  | Public root exposes metadata-only `defineIndicator` and author APIs; integration rejects callback-shaped/CommonJS/dynamic/namespace legacy paths.                                                               | PASS             |
|   2 | Direct price/bar globals and ordinary helpers use compiler-owned hidden identity.                                                                           | Script/callsite/history transforms plus integration fixtures prove direct OHLCV/bar globals, relocated helpers, stable hidden identities and source-mapped diagnostics.                                         | PASS             |
|   3 | Inputs have static identity, support source inputs, and reject dynamic multiplicity.                                                                        | Integration covers stable/reordered identities, direct `input.source(close,...)`, helper inputs, loop repetition and recursive/mutually recursive rejection.                                                    | PASS             |
|   4 | History, scalar recurrence, persistent `var`, rollback, reset, and bounds match Pine-style semantics.                                                       | Derived/helper history, scalar recurrence, persistent-var hoisting/initialize-once/rollback/rebuild and 4,096 aggregate-item tests pass.                                                                        | PASS             |
|   5 | Approved `ta.*` overloads preserve replay, MTF provenance, and bounded complexity.                                                                          | Source-first/length-first execution parity, direct-series higher-timeframe provenance and 100,000-update TA complexity gates pass.                                                                              | PASS             |
|   6 | Persistent drawings use opaque handles with stable identity and unchanged 2,000 drawing/change safeguards.                                                  | Handle persistence/reorder/conditional-update tests pass; 100,000-bar/2,000-drawing gate and 10,000-bar flagship stress pass without raising limits.                                                            | PASS             |
|   7 | ATR Rope + UT Bot source contains domain logic only and matches accepted semantics.                                                                         | Maintained-source surface audit plus compiled output/signal, provisional/finalized, POC, DMI/source and incremental-equivalence fixtures pass.                                                                  | PASS             |
|   8 | No public legacy indicator authoring compatibility remains.                                                                                                 | Public-root/export scan and negative compiler/package tests show no public recurrence/source-plumbing facade or hidden callback escape path; maintained examples use only corrected v2 authoring.               | PASS             |
|   9 | Provider/MTF acquisition and source lifecycle remain host-owned and no-lookahead.                                                                           | Unit/integration cover provider source acquisition/sharing, native/derived planning, fallback, revision rebuilds and completed higher-timeframe alignment.                                                      | PASS             |
|  10 | Heikin Ashi transform order, recursive rollback, source identity, and provenance remain correct.                                                            | Unit tests cover timeframe-before-HA order, repeated building rollback, bounded-window recursive seed, source identity and synthetic provenance.                                                                | PASS             |
|  11 | Signals commit only finalized/source-confirmed events and preserve replay equivalence/no-lookahead.                                                         | Unit/integration cover finalized-only signals, traced dependencies, higher-timeframe readiness, duplicate suppression, corrected-history behavior and replay/provisional parity.                                | PASS             |
|  12 | Dependency DAG validates bindings/order/history and enforces aggregate bounds.                                                                              | Missing/self/duplicate/cycle/order/history tests pass; fresh dependency performance gate accepts exactly 400,000 aggregate points within budget.                                                                | PASS             |
|  13 | Worker/runtime/renderer boundaries preserve typed transport, stale rejection, quotas, recovery, and cleanup.                                                | Worker snapshot/materialization, revision/generation, timeout/crash/restart, resource-cap, renderer orchestration and disposal/late-lease tests pass.                                                           | PASS             |
|  14 | Performance/resource coverage includes 100,000-bar/update, 400,000 dependency points, four-chart/four-worker, MTF, drawing, and 10,000-bar flagship stress. | Fresh `test:performance` and dedicated/maintained-example stress pass all measured budgets; flagship structure is capped at 440 overlays under the unchanged 2,000 safeguard.                                   | PASS             |
|  15 | Maintained examples and current public documentation teach only the corrected SDK v2 surface.                                                               | Maintained packages compile through the production authoring pipeline; source/doc scans find no removed authoring/runtime helpers; authoring guide is v2-only.                                                  | PASS             |
|  16 | Current-state documentation supersedes the September 14 author-experience acceptance without rewriting historical chronology.                               | Current-state inventory preserves the September 14 history, identifies the September 15 correction, and now records fresh ECDD-241 acceptance evidence.                                                         | PASS             |
|  17 | Repository-wide exact-head correctness, audit, version, format, lint, type, build, integration, legacy-indicator, and performance gates pass.               | Local build/format/lint/type/unit/integration/legacy/performance/Electron/version/diff gates pass. Local audit is toolchain-blocked; pinned exact-head Delivery CI is required before this row can become PASS. | CI PENDING       |
|  18 | Task-to-epic and epic-to-main governance is satisfied.                                                                                                      | Requires ECDD-241 task PR exact-head review/checks and squash merge, then epic-to-main exact-head governance and merge-commit promotion with final Jira evidence.                                               | DELIVERY PENDING |

## Fresh local verification

- `npm.cmd run build`: PASS.
- `npm.cmd run format:check`: PASS.
- `npm.cmd run lint`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run test:unit`: 653 total, 651 PASS, 0 FAIL, 2 expected Windows
  symlink skips.
- `npm.cmd run test:integration`: 291/291 PASS.
- `npm.cmd run test:legacy-indicators`: 9/9 PASS.
- `npm.cmd run test:performance`: PASS across authored transform, 100,000-bar
  history/runtime, worker materialization, 400,000 dependency points, persistent
  state, TA complexity, 2,000 drawings, ATR Rope + UT Bot, provider MTF,
  renderer alignment and four-chart/four-worker orchestration.
- Dedicated 10,000-bar POC migration stress: PASS; structural maximum 440
  retained overlays.
- `npm.cmd run smoke:electron`: PASS.
- `npm.cmd run version:check`: PASS.
- `git diff --check`: PASS.
- `npm.cmd run audit:ci`: LOCAL ENVIRONMENT BLOCKED. The workstation uses Node
  25.9.0 / npm 11.19.0 with user-level `allow-scripts=9router`; the repository
  pins Node 26.8.1 / npm 12.0.2. Exact-head Delivery CI with the pinned toolchain
  must pass before row 17 is promoted to PASS.

## Anti-drift review

Answer every question again from the final exact head. A compliant answer must be
supported by code/test/documentation evidence rather than intent.

1. **PASS** — Maintained indicator source matches the approved correction design;
   production compiler/package fixtures exercise the same source.
2. **PASS** — Normal authoring exposes no runtime callback/context, worker message,
   persistence ID, replay flag or manual drawing reconciliation.
3. **PASS** — Provider/source/worker/renderer mechanics remain outside maintained
   indicator domain code.
4. **PASS** — Metadata declaration plus top-level globals/inputs/TA/plots/signals
   is the canonical model; no callback-shaped alternative is accepted.
5. **PASS** — Removed public recurrence/source-plumbing compatibility remains
   absent from the public root and maintained examples.
6. **PASS** — Compiler owns lowering/identity; SDK/runtime owns state/drawings;
   host owns sources/MTF/HA/dependencies; indicators retain domain mathematics.
7. **PASS** — Fresh history, persistent-state, ATR and integration regressions
   preserve committed/provisional and corrected-history behavior.
8. **PASS** — Signal dependency tracing, source confirmation and higher-timeframe
   alignment tests preserve no-lookahead semantics.
9. **PASS** — Provider-aware source planning, sharing, fallback, MTF alignment and
   live revision handling remain host-owned and pass fresh regressions.
10. **PASS** — Heikin Ashi is applied after target-timeframe construction and its
    recursive building/provenance tests pass.
11. **PASS** — Dependency validation, deterministic ordering, incremental
    history and the 400,000-point aggregate bound pass.
12. **PASS** — Typed transport, stale generation/revision rejection, budgets,
    restart fencing, multi-chart orchestration and cleanup tests pass.
13. **PASS** — Maintained author code is top-level trading/domain logic rather
    than explicit lifecycle/reconciliation plumbing.
14. **PASS** — ATR Rope + UT Bot retains domain complexity and accepted
    outputs/signals while persistent drawing handles remove positional churn.

## Final acceptance rule

ECDD-241 may move to epic-to-main promotion only when rows 1–17 are `PASS`, every
anti-drift answer is backed by fresh exact-head evidence, current documentation
matches the observed implementation, and no required gate has an unexplained
failure. Row 18 is the delivery proof itself: it becomes PASS only after the task
PR and final epic-to-main promotion are complete and is recorded in Jira/GitHub
because a commit cannot contain evidence of its own future merge.
