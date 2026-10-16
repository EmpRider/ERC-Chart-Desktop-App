# Changelog

All notable changes to ERC Chart are documented here.

## [1.1.3] - 2026-10-16

### ATR Rope history performance

- Eliminates per-bar parameter normalization and input re-normalization during finalized history replay.
- Removes redundant deep clones in persistentVar for finalized replay phase.
- Rewrites projectedPocCandidate to single-pass monotonic cursor (O(n) → O(1) per row).
- Adds Windows EBUSY retry guard for storage test cleanup.

## [1.1.2] - 2026-09-21

### Indicator chart-source hotfix

- Fixes standard same-timeframe plugin indicators that could render only `n/a` by evaluating them directly from the exact chart candles instead of reacquiring redundant provider history.
- Keeps provider-backed source acquisition for multi-timeframe indicators, explicitly different-timeframe sources, and Heikin Ashi inputs.

## [1.1.1] - 2026-09-20

### SDK v2 corrected release identity

- Publishes the corrected Indicator SDK v2 delivery under the new immutable `v1.1.1` release identity after `v1.1.0` was already published from the earlier accepted main.
- Keeps the SDK/compiler/runtime behavior unchanged; this release advances package, installer, and release metadata only.

## [1.1.0] - 2026-09-14

### Indicator SDK v2

- Completed the v2-only indicator authoring/runtime contract with compiler-owned hidden identity for inputs, TA state, plots, drawings, and signals.
- Added deterministic history and conditional execution, provider-aware multi-timeframe and Heikin Ashi sources, source-confirmed signals, persistent drawing handles, and explicit cross-indicator dependency ordering.
- Hardened worker transport and recovery with typed snapshots, bounded deltas, generation/revision validation, resource limits, and final correctness and performance acceptance across maintained v2 indicators.
