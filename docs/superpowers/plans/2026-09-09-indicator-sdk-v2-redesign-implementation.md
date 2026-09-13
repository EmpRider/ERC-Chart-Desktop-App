# Indicator SDK v2 Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current execution-order-oriented indicator authoring model with a Pine-like/pseudocode-first SDK where authors write indicator logic only, while ERC Chart owns IDs, history, state, source/timeframe resolution, candle transformations, optimization, plotting lifecycle, signal safety, and error handling.

**Architecture:** Add an authoring compiler that lowers beginner syntax to stable hidden call-site identities, then execute it on top of a provider-aware Indicator Source Engine and a committed/provisional Stateful Execution Engine. Preserve the validated worker/snapshot and KLineCharts rendering boundaries where they remain useful, but redesign public/internal SDK APIs freely because legacy indicator source compatibility is explicitly not required.

**Tech Stack:** Existing ERC Chart monorepo; strict TypeScript; Node/Electron worker runtime; existing provider/data-service packages; KLineCharts renderer integration; Node test runner; existing package/build tooling. Prefer existing compiler/build dependencies where possible and justify any new AST dependency before adding it.

**Spec:** `docs/superpowers/specs/2026-09-09-indicator-sdk-v2-redesign-design.md`

## Global Constraints

- **No legacy indicator source compatibility requirement.** SDK v1 authoring calls, explicit drawing IDs, execution-order behavior, and v1-only helpers may be removed rather than preserved.
- Complete SDK v2 and its host/runtime foundations first; then rewrite all maintained indicators against v2 from scratch.
- The author-facing API must optimize for pseudocode/Pine-like readability by non-programmers.
- Indicator authors must not manage runtime/context objects, IDs, persistence keys, lifecycle flags, source revisions, lookahead safety, or performance tuning.
- `close[1]` is the preferred history syntax; `history(close, 1)` and `close.at(1)` must remain equivalent alternatives.
- All TA functions live under `ta.*`; do not introduce a public `ma.*` namespace.
- Plot/drawing/signal IDs are SDK-owned and never required from authors.
- Timeframe choices are provider/workspace capability-driven, not a universal hard-coded list.
- MTF and synthetic candle signals must be non-lookahead by default and tied to the confirmation state of the actual source candle.
- Timeframe construction occurs before candle transformation; e.g. build 1h standard candles before 1h Heikin Ashi.
- Use O(1) or amortized O(1) incremental processing where mathematically appropriate; initial/rebuild work may be O(N).
- Keep KLineCharts, provider adapters, and worker transport hidden from indicator authors.
- Do not silently turn genuine programming bugs into plausible trading values; isolate the faulty indicator and provide developer diagnostics.
- No implementation task is complete until its focused tests pass; phase gates additionally require typecheck/lint and relevant integration suites.

---

## Progress Board

Use this board as the high-level status record. Change `[ ]` to `[x]` only after the task's verification gate is complete.

- [ ] Phase 1 — Freeze SDK v2 semantic contracts and authoring examples
- [ ] Phase 2 — Build authoring compiler and hidden call-site identity
- [ ] Phase 3 — Build v2 series/history model (`close[1]`)
- [ ] Phase 4 — Rebuild `ta.*` on v2 identities and overloads
- [ ] Phase 5 — Rebuild inputs, generic constants, and host-normalized settings
- [ ] Phase 6 — Rebuild scalar plots and conditional-call semantics
- [x] Phase 7 — Build persistent drawing-handle engine with hidden IDs
- [ ] Phase 8 — Build provider-driven effective timeframe resolver
- [ ] Phase 9 — Build Indicator Source Engine and MTF source sharing
- [ ] Phase 10 — Build candle transformation layer and Heikin Ashi
- [ ] Phase 11 — Rebuild signal engine with lookahead/confirmation guarantees
- [ ] Phase 12 — Evolve worker/contracts for source provenance and v2 deltas
- [ ] Phase 13 — Extend renderer for marker text, text sizes, locations, and v2 drawings
- [x] Phase 14 — Rewrite maintained indicators against SDK v2
- [x] Phase 15 — Remove v1-only authoring/runtime surface
- [ ] Phase 16 — Full correctness/performance/documentation acceptance

**Optimization sequencing note (2026-09-13):** ECDD-222 maps to detailed Task 7 and is complete. ECDD-223 maps to detailed Task 8 and is complete via PR #129 / squash merge `de7262ea3723530d546df017c2ac2eed14f9250f`. ECDD-224 completed the maintained ATR Rope/UT Bot rewrite via PR #131 / squash merge `e8c94027e40e0a24be1070a588ca93b097220687`, preserving the four compiled-package trading-semantic regression configurations while moving runtime plumbing to SDK v2. ECDD-225 completed the v1-only public authoring/runtime export cleanup via PR #133 / squash merge `8b9fd709070bb884295813a07a6fdfa11c4efaf0`, leaving a v2-only author root while keeping required host/runtime mechanisms internal. ECDD-226 completed the final v2-only authoring guide via PR #135 / squash merge `a4ece67f7b9aa077108fd27e777b6c1b92374ae3`, with provider-aware MTF/per-TA execution explicitly retained under ECDD-142 ownership. ECDD-227 completed the final composed v2 contract fixture via PR #137 / squash merge `8bdbb38b98b1f74220966a26c170f88476e54cce`, covering hidden identity, conditional execution, history syntax parity, provisional rollback, finalized advancement, drawing reconciliation, and stable finalized signal identity through the packaged authoring path. ECDD-228 completed the ATR Rope/UT Bot migration-regression expansion via PR #139 / squash merge `cdd7db5568fb89f9415b7db526340d265aada5d0`, proving approved semantics through historical replay, provisional replacement, finalized advancement, and unrelated authoring source reorder. ECDD-229 (authored-indicator performance acceptance) is the next SDK-v2 optimization task. Phase 16 remains open until ECDD-229 acceptance work is complete. The broader phase board groups source/runtime/renderer work at architecture level and does not override the ECDD-216 Jira task order.

---

## Planned File Structure

This is the intended responsibility map. Existing files may be split when they currently mix concerns.

### `packages/indicator-sdk`

- `src/index.ts` — public v2 exports only.
- `src/constants.ts` — generic authoring constants: `price`, `color`, `line`, `shape`, `location`, `textSize`, `timeframe`, `candle`.
- `src/input.ts` — beginner input facade and metadata declarations.
- `src/series.ts` — public series/history facade and canonical series references.
- `src/ta.ts` — public TA overloads and canonical dependency requests.
- `src/plot.ts` — scalar plots, shape API, drawing-handle facade.
- `src/signal.ts` — beginner signal facade.
- `src/indicator.ts` — `defineIndicator`/indicator-level source settings only.
- `src/internal/callsite.ts` — hidden compiler/runtime call-site token types.
- `src/internal/execution-context.ts` — runtime-only authoring frame/state lookup; never public.
- `src/internal/drawings.ts` — persistent drawing object state.
- `src/internal/series-history.ts` — committed/provisional history store.
- `src/internal/ta-kernels.ts` — stateful TA kernels.
- `src/internal/signals.ts` — provisional/finalized signal lifecycle.

### Authoring compiler/build tooling

- `tools/indicator-authoring-transform.mjs` — AST transform entry point.
- `tools/build-indicator-package.mjs` — integrate transform into indicator package build.
- `tools/indicator-authoring/identity.mjs` — deterministic hidden identity generation.
- `tools/indicator-authoring/history-transform.mjs` — lower `close[n]`/series indexing.
- `tools/indicator-authoring/callsite-transform.mjs` — inject hidden call-site IDs and canonical overload forms.

### Source/data/runtime

- `packages/data-service/src/timeframes.ts` — authoritative native/derived timeframe planning primitives.
- `packages/data-service/src/provider-bridge.ts` — continue provider-neutral source ownership/sharing.
- `packages/indicator-runtime/src/source-capabilities.ts` — effective provider/workspace timeframe view for indicators.
- `packages/indicator-runtime/src/source-engine.ts` — acquire/share indicator sources and synchronize revisions.
- `packages/indicator-runtime/src/candle-transform.ts` — standard/synthetic candle transform registry.
- `packages/indicator-runtime/src/heikin-ashi.ts` — committed/provisional HA transform.
- `packages/indicator-runtime/src/worker-entry.ts` — execute v2 instances and source deltas.
- `packages/indicator-runtime/src/result-validation.ts` — validate v2 runtime output/provenance.

### Contracts/renderer

- `packages/contracts/src/indicator-management.ts` — provider-independent installed definitions and runtime transport fields.
- `packages/renderer/src/indicator-worker-runtime.ts` — transport/rebuild orchestration.
- `packages/renderer/src/plugin-indicators.ts` — KLineCharts mapping only.

### Tests/docs/examples

- `packages/indicator-sdk/test/indicator-sdk.test.mjs`
- `packages/indicator-sdk/test/indicator-sdk.types.ts`
- `packages/indicator-runtime/test/indicator-runtime.test.mjs` or focused existing runtime test files
- `packages/data-service/test/timeframes.test.mjs` and existing provider/data tests
- renderer indicator tests under the existing renderer test directory
- `packages/indicator-examples/src/atr-rope-utbot.ts`
- other maintained indicator examples/built-ins discovered during Phase 14
- `docs/development/INDICATOR-AUTHORING.md`

---

### Task 1: Lock the SDK v2 public semantic contract

**Files:**

- Modify: `packages/indicator-sdk/src/index.ts`
- Create or modify: `packages/indicator-sdk/test/indicator-sdk.types.ts`
- Modify: `docs/development/INDICATOR-AUTHORING.md`

**Interfaces:**

- Produces the public names and call shapes that every later task implements.
- No legacy API preservation requirement.

- [ ] **Step 1: Write type fixtures for the target authoring surface**

Add compile-time examples covering at least:

```ts
const length = input.int(14, "Length");
const source = input.source(price.close, "Source");
const tf = input.timeframe(timeframe.chart, "Timeframe");
const candleMode = input.candleType(candle.standard, "Candles");

indicator.timeframe(tf);
indicator.candleType(candleMode);

const fast = ta.ema(9);
const slow = ta.ema(close, 21);
const trend = ta.ema(200, "1h");

plot.line(fast);
plot.shape(ta.crossover(fast, slow), {
  shape: shape.labelUp,
  location: location.belowBar,
  text: "BUY",
  textSize: textSize.small,
});

signal(ta.crossover(fast, slow), signal.long);
```

- [ ] **Step 2: Run typecheck and confirm the fixtures fail on the current SDK**

Run: `npm run typecheck`

Expected: FAIL because v2 names/call shapes are not all implemented.

- [ ] **Step 3: Replace public declarations with the v2 contract skeleton**

Define the intended public interfaces/types without implementing runtime semantics yet. Do not add deprecated v1 aliases simply to make old examples compile.

- [ ] **Step 4: Update authoring docs with the v2-only policy banner**

The top of the authoring guide must state that SDK v2 is a clean redesign and existing indicators will be rewritten after the SDK is complete.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

Expected: the new contract fixtures compile; expected downstream implementation errors are confined to files being deliberately migrated in later tasks rather than ambiguous public types.

- [ ] **Step 6: Commit**

```bash
git add packages/indicator-sdk/src/index.ts packages/indicator-sdk/test/indicator-sdk.types.ts docs/development/INDICATOR-AUTHORING.md
git commit -m "feat(indicators): define SDK v2 authoring contract"
```

---

### Task 2: Implement hidden call-site identities in the authoring compiler

**Files:**

- Create: `tools/indicator-authoring-transform.mjs`
- Create: `tools/indicator-authoring/identity.mjs`
- Create: `tools/indicator-authoring/callsite-transform.mjs`
- Modify: `tools/build-indicator-package.mjs`
- Create: `tools/indicator-authoring-transform.test.mjs` or follow the existing tools test layout

**Interfaces:**

- Produces: deterministic hidden token passed to runtime calls, conceptually `__erc.callsite("...")`.
- Consumes: author source files during package build.

- [ ] **Step 1: Add a failing transform test for conditional calls**

Input fixture:

```ts
if (buy) {
  plot.shape(true, "BUY");
}
```

Expected transformed fixture must include a stable hidden call-site token even though the call is conditional.

- [ ] **Step 2: Run the transform test and verify failure**

Run the exact Node test file directly with `node --test`.

Expected: FAIL because no transform exists.

- [ ] **Step 3: Implement deterministic identity generation**

Identity must include enough semantic/source information to distinguish separate declarations without exposing IDs to authors. Add tests for two calls on adjacent lines, code insertion before a call, and duplicate-looking calls in different scopes.

- [ ] **Step 4: Inject call-site tokens for `input.*`, `ta.*`, `plot.*`, drawing creation, and `signal()`**

The transform must preserve source maps or source-location metadata used for diagnostics.

- [ ] **Step 5: Integrate the transform into `build-indicator-package.mjs`**

The installed plugin remains precompiled ESM; installation must not execute build scripts.

- [ ] **Step 6: Verify conditional and reordered calls no longer depend on runtime index order in transform fixtures**

Run the focused transform suite.

- [ ] **Step 7: Commit**

```bash
git add tools/indicator-authoring-transform.mjs tools/indicator-authoring tools/build-indicator-package.mjs
git commit -m "feat(indicators): add v2 authoring transform"
```

---

### Task 3: Implement Pine-style series history

**Files:**

- Create: `tools/indicator-authoring/history-transform.mjs`
- Rewrite: `packages/indicator-sdk/src/series.ts`
- Create: `packages/indicator-sdk/src/internal/series-history.ts`
- Modify: `packages/indicator-sdk/test/indicator-sdk.test.mjs`
- Modify: `packages/indicator-sdk/test/indicator-sdk.types.ts`

**Interfaces:**

- Produces: equivalent semantics for `close[1]`, `history(close, 1)`, and `close.at(1)`.
- Runtime canonical operation: a hidden source-series reference plus integer offset.

- [ ] **Step 1: Add failing tests proving the three history syntaxes are equivalent**

Fixture expectation:

```ts
assert.equal(close1, history1);
assert.equal(history1, at1);
```

Cover current bar (`0`), previous bars, unavailable warm-up history, and building-bar replacement.

- [ ] **Step 2: Add failing compiler tests for `close[1]` lowering**

Ensure ordinary numeric `close` usage remains normal arithmetic in generated code.

- [ ] **Step 3: Implement the history transform and runtime history store**

The store must keep finalized values committed and derive building-bar reads without double-committing provisional values.

- [ ] **Step 4: Implement `history(series, offset)` and `.at(offset)` aliases over the same internal operation**

Reject negative/non-integer offsets at build/type level where possible and runtime otherwise.

- [ ] **Step 5: Run focused SDK/compiler tests**

Expected: all history equivalence and rollback tests PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/indicator-authoring/history-transform.mjs packages/indicator-sdk/src/series.ts packages/indicator-sdk/src/internal/series-history.ts packages/indicator-sdk/test
git commit -m "feat(indicators): add Pine-style series history"
```

---

### Task 4: Rebuild `ta.*` for hidden identity, overloads, and incremental kernels

**Files:**

- Rewrite: `packages/indicator-sdk/src/ta.ts`
- Create: `packages/indicator-sdk/src/internal/ta-kernels.ts`
- Modify: `packages/indicator-sdk/src/internal/execution-context.ts`
- Modify: `packages/indicator-sdk/test/indicator-sdk.test.mjs`
- Modify: `packages/indicator-sdk/test/indicator-sdk.types.ts`

**Interfaces:**

- Public examples:

```ts
ta.ema(20);
ta.ema(close, 20);
ta.ema(20, close);
ta.ema(20, "1h");
ta.rsi(14);
ta.atr(14);
ta.adx(14);
ta.dmi(14);
ta.highest(20);
ta.lowest(20);
ta.crossover(fast, slow);
```

- Internal identity is call-site based, not kernel-array order.

- [ ] **Step 1: Add failing overload/type tests**

Cover valid overloads and intentionally invalid source/period combinations.

- [ ] **Step 2: Add failing runtime tests where TA calls occur conditionally and in different branches**

The test must prove state attaches to hidden call-site identity rather than `kernelIndex`.

- [ ] **Step 3: Move existing useful rolling algorithms into v2 kernel objects keyed by hidden identity**

Preserve O(1)/amortized O(1) behavior where currently available.

- [ ] **Step 4: Canonicalize ambiguous overloads in the compiler**

For example, when two author arguments are both numeric scalars, generated runtime calls must already know which is length and which is source.

- [ ] **Step 5: Add replay-vs-incremental equivalence tests for EMA/RSI/ATR/crossover**

- [ ] **Step 6: Run focused SDK tests and `npm run typecheck`**

- [ ] **Step 7: Commit**

```bash
git add packages/indicator-sdk/src/ta.ts packages/indicator-sdk/src/internal packages/indicator-sdk/test tools/indicator-authoring
git commit -m "feat(indicators): rebuild technical analysis runtime"
```

---

### Task 5: Rebuild inputs and generic constants

**Files:**

- Rewrite: `packages/indicator-sdk/src/input.ts`
- Create: `packages/indicator-sdk/src/constants.ts`
- Modify: `packages/contracts/src/indicator-management.ts`
- Modify: renderer settings-field mapping in `packages/renderer/src/plugin-indicators.ts`
- Modify: SDK/renderer tests

**Interfaces:**

```ts
input.int(14, "Length");
input.float(1.5, "Multiplier");
input.bool(true, "Enabled");
input.enum("Original", ["Original", "Zero Lag"], "Mode");
input.source(price.close, "Source");
input.timeframe(timeframe.chart, "Timeframe");
input.candleType(candle.standard, "Candles");
input.color(color.green, "Color");
```

- [ ] **Step 1: Add failing tests for compiler-generated stable input identities**

Test that authors provide no `key` and persisted values still bind to the same declaration across a normal rebuild.

- [ ] **Step 2: Add failing normalization tests**

Cover missing values, stale keys, invalid enum values, out-of-range numbers, step rounding, and unknown provider timeframe preference.

- [ ] **Step 3: Implement generic namespaces**

At minimum: `price`, `color`, `line`, `shape`, `location`, `textSize`, `timeframe`, `candle`.

- [ ] **Step 4: Implement concise input overloads and special host-driven input kinds**

`timeframe` metadata must not serialize a static list of universal options.

- [ ] **Step 5: Make host normalization authoritative**

Remove author-facing migration burden for ordinary saved-setting changes.

- [ ] **Step 6: Run focused SDK/renderer settings tests and typecheck**

- [ ] **Step 7: Commit**

```bash
git add packages/indicator-sdk/src/input.ts packages/indicator-sdk/src/constants.ts packages/contracts/src/indicator-management.ts packages/renderer/src/plugin-indicators.ts packages/indicator-sdk/test
git commit -m "feat(indicators): add v2 inputs and constants"
```

---

### Task 6: Rebuild scalar plots and conditional plot semantics

**Files:**

- Rewrite: `packages/indicator-sdk/src/plot.ts`
- Modify: `packages/indicator-sdk/src/internal/execution-context.ts`
- Modify: `packages/contracts/src/indicator-management.ts`
- Modify: `packages/indicator-sdk/test/indicator-sdk.test.mjs`

**Interfaces:**

```ts
plot.line(value);
plot.line(value, color.green);
plot.hline(50);
plot.histogram(volume);

if (showTrend) {
  plot.line(trend);
}
```

- [ ] **Step 1: Add failing test proving conditional scalar plot calls are legal**

The same call-site may be absent on one bar and present on another without a declaration-order error.

- [ ] **Step 2: Replace plot-index identity with hidden call-site identity**

- [ ] **Step 3: Define omission semantics**

For scalar plots, a call-site not emitted for a bar produces no value for that bar rather than deleting the plot definition itself.

- [ ] **Step 4: Preserve bounded output validation inside SDK/runtime**

Authors do not manually clamp widths or convert NaN warm-up values to null.

- [ ] **Step 5: Run focused plot tests**

- [ ] **Step 6: Commit**

```bash
git add packages/indicator-sdk/src/plot.ts packages/indicator-sdk/src/internal packages/contracts/src/indicator-management.ts packages/indicator-sdk/test
git commit -m "feat(indicators): make plots callsite driven"
```

---

### Task 7: Build persistent drawing handles with hidden IDs

**Status:** Complete via ECDD-222; squash-merged into `epic/ECDD-135-sdk-v2-optimization` as `f70821b93c033a48d73affe1a535084edda7caab` on 2026-09-13.

**Files:**

- Rewrite drawing portions of `packages/indicator-sdk/src/plot.ts`
- Create: `packages/indicator-sdk/src/internal/drawings.ts`
- Modify: `packages/indicator-sdk/src/indicator.ts`
- Modify: `packages/contracts/src/indicator-management.ts`
- Modify: SDK/runtime tests

**Interfaces:**

```ts
const box = plot.box({ left, right, top, bottom, color });
box.set({ right: time, top: high });
box.delete();

const line = plot.segment({ left, right, startValue, endValue, color });
line.delete();
```

The public handle owns no author-visible persistence ID. Renderer-facing IDs, committed/provisional lifecycle, retention, rollback, and reconciliation remain SDK/runtime concerns.

- [x] **Step 1: Add failing tests showing no `id` is accepted/required in author code**

- [x] **Step 2: Add failing persistence tests**

A handle created on a finalized bar remains alive until updated/deleted.

- [x] **Step 3: Add failing provisional rollback tests**

Building-bar mutations revert to committed drawing state on replacement updates.

- [x] **Step 4: Implement hidden drawing identity and handle registry**

Author handle identity is separated from plain runtime overlay IDs transported to the renderer.

- [x] **Step 5: Implement bounded retention/eviction inside the drawing engine**

The author does not write retention code.

- [x] **Step 6: Remove normal author dependence on `plot.drawings()`, `plot.sync()`, overlay arrays, and `plot.remove(id)`**

No SDK v1 compatibility layer is required.

- [x] **Step 7: Run drawing rollback/replay, identity, ownership, failure-path, and performance tests**

- [x] **Step 8: Commit and merge**

ECDD-222 exact-head delivery/security evidence passed before squash merge. Maintained-indicator retained-handle cleanup remains intentionally owned by ECDD-224/ECDD-228.

---

### Task 8: Add shapes with text and text-size semantics

**Status:** Complete via ECDD-223 (PR #129, squash merge `de7262ea3723530d546df017c2ac2eed14f9250f`).

**Files:**

- Modify: `packages/indicator-sdk/src/plot.ts`
- Modify: `packages/indicator-sdk/src/constants.ts`
- Modify: `packages/contracts/src/indicator-management.ts`
- Modify: `packages/renderer/src/plugin-indicators.ts`
- Modify: SDK/renderer tests

**Interfaces:**

```ts
plot.shape(buy, {
  shape: shape.labelUp,
  location: location.belowBar,
  color: color.green,
  text: "BUY",
  textColor: color.white,
  textSize: textSize.small,
});

plot.shape(buy, "BUY");
plot.shape(buy, shape.labelUp, "BUY");
```

- [x] **Step 1: Add failing contract tests for shape/text fields**

Cover bounded text, supported text sizes, locations, marker types, malformed payload rejection, and empty-text behavior.

- [x] **Step 2: Add failing renderer tests for BUY/SELL text and size mapping**

Cover historical, live, and provisional updates while preserving existing non-text shape behavior.

- [x] **Step 3: Extend the runtime contract**

Carry semantic size enum values through the contract; map to actual renderer size only in renderer code.

- [x] **Step 4: Update KLineCharts figure mapping**

The renderer chooses glyph/label positioning and DPI/pixel size.

- [x] **Step 5: Run SDK contract/renderer tests plus the normal task delivery gates**

- [x] **Step 6: Commit**

```bash
git add packages/indicator-sdk/src packages/contracts/src/indicator-management.ts packages/renderer/src/plugin-indicators.ts packages/indicator-sdk/test packages/renderer/test
git commit -m "feat(indicators): add marker text and sizing"
```

ECDD-223 completed with RED-first coverage, exact-head Delivery #956 PASS, Semgrep PASS with 0 annotations, CodeRabbit required status PASS, no unresolved review threads, and squash merge `de7262ea3723530d546df017c2ac2eed14f9250f`. Maintained-indicator migration remains intentionally owned by ECDD-224/ECDD-228.

---

### Task 9: Build the effective provider timeframe resolver

**Files:**

- Modify: `packages/data-service/src/timeframes.ts`
- Modify if needed: `packages/provider-sdk/src/index.ts`
- Create: `packages/indicator-runtime/src/source-capabilities.ts`
- Modify existing timeframe/provider tests

**Interfaces:**

```ts
interface EffectiveIndicatorTimeframe {
  readonly id: string;
  readonly seconds: number;
  readonly native: boolean;
  readonly historical: boolean;
  readonly live: boolean;
  readonly sourceTimeframeId: string;
}
```

The exact transport type may differ, but one resolver must drive all indicator/UI timeframe choices.

- [ ] **Step 1: Add failing tests using a Binomo-like capability set with native `1m` and `5m`**

Assert only native or safely derived aligned timeframes are returned; do not assume a universal list.

- [ ] **Step 2: Add failing tests for a different provider capability set**

Prove the resolver output changes with provider capabilities.

- [ ] **Step 3: Implement effective capability resolution over existing timeframe planning/alignment rules**

- [ ] **Step 4: Include historical/live availability in the effective result**

- [ ] **Step 5: Add tests for unavailable requested timeframe fallback metadata**

Keep requested preference distinct from active resolved timeframe.

- [ ] **Step 6: Run data-service/provider/runtime focused tests**

- [ ] **Step 7: Commit**

```bash
git add packages/data-service/src/timeframes.ts packages/provider-sdk/src/index.ts packages/indicator-runtime/src/source-capabilities.ts packages/data-service/test packages/indicator-runtime/test
git commit -m "feat(indicators): resolve provider-driven timeframes"
```

---

### Task 10: Build the Indicator Source Engine

**Files:**

- Create: `packages/indicator-runtime/src/source-engine.ts`
- Modify: `packages/indicator-runtime/src/index.ts`
- Modify: `packages/indicator-runtime/src/worker-entry.ts`
- Modify: `packages/renderer/src/indicator-worker-runtime.ts`
- Reuse: `packages/data-service/src/provider-bridge.ts`
- Modify runtime/integration tests

**Interfaces:**

Conceptual source key:

```ts
interface IndicatorSourceKey {
  readonly providerProfileId: string;
  readonly instrumentId: string;
  readonly timeframeId: string;
  readonly candleType: "standard" | "heikin-ashi";
}
```

- [ ] **Step 1: Add failing test: chart `15m`, indicator requests provider-supported `1m`**

Assert the engine acquires a separate 1m source; it must never fabricate 1m candles from 15m chart candles.

- [ ] **Step 2: Add failing test: chart `1m`, indicator requests derived `3m`**

Assert the data service/source engine uses the valid lower source and aggregation plan.

- [ ] **Step 3: Add failing source-sharing test**

Two indicators requesting the same provider/instrument/timeframe/candle type should share upstream source work while retaining separate calculation state.

- [ ] **Step 4: Implement source acquisition, reference counting, revision tracking, and deterministic release**

- [ ] **Step 5: Add multi-source dependency support per indicator**

The same indicator must be able to use active timeframe plus `ta.ema(..., "1h")`.

- [ ] **Step 6: Add provider-switch invalidation tests**

A source must re-resolve capabilities and rebuild without stale provider data.

- [ ] **Step 7: Run focused runtime/data integration tests**

- [ ] **Step 8: Commit**

```bash
git add packages/indicator-runtime/src packages/renderer/src/indicator-worker-runtime.ts packages/indicator-runtime/test
git commit -m "feat(indicators): add provider-aware source engine"
```

---

### Task 11: Add indicator-level and TA-level timeframe controls

**Files:**

- Modify: `packages/indicator-sdk/src/indicator.ts`
- Modify: `packages/indicator-sdk/src/input.ts`
- Modify: `packages/indicator-sdk/src/ta.ts`
- Modify: `packages/indicator-runtime/src/source-engine.ts`
- Modify: renderer settings/runtime integration

**Interfaces:**

```ts
const tf = input.timeframe(timeframe.chart, "Timeframe");
indicator.timeframe(tf);

const local = ta.ema(9);
const htf = ta.ema(200, "1h");
```

- [ ] **Step 1: Add failing tests for indicator-wide timeframe selection**

- [ ] **Step 2: Add failing tests for per-TA timeframe override**

- [ ] **Step 3: Populate timeframe input options dynamically from effective provider capabilities**

Do not store a universal option array in installed plugin metadata.

- [ ] **Step 4: Implement source resolution and alignment for MTF outputs**

- [ ] **Step 5: Add saved-unavailable-timeframe fallback test**

Active source falls back safely while requested preference remains available for UX/possible restoration.

- [ ] **Step 6: Run SDK/runtime/renderer focused tests**

- [ ] **Step 7: Commit**

```bash
git add packages/indicator-sdk/src packages/indicator-runtime/src packages/renderer/src packages/contracts/src/indicator-management.ts
git commit -m "feat(indicators): add dynamic multi-timeframe authoring"
```

---

### Task 12: Build candle transformation registry and Heikin Ashi

**Files:**

- Create: `packages/indicator-runtime/src/candle-transform.ts`
- Create: `packages/indicator-runtime/src/heikin-ashi.ts`
- Modify: `packages/indicator-runtime/src/source-engine.ts`
- Modify: `packages/indicator-sdk/src/constants.ts`
- Modify: `packages/indicator-sdk/src/input.ts`
- Add runtime tests

**Interfaces:**

```ts
const mode = input.candleType(candle.standard, "Candle Type");
indicator.candleType(mode);
```

- [ ] **Step 1: Add failing historical HA fixture test**

Use explicit expected values for the standard formula:

```text
HA close = (open + high + low + close) / 4
HA open  = (previous HA open + previous HA close) / 2
HA high  = max(high, HA open, HA close)
HA low   = min(low, HA open, HA close)
```

Define and test the initial HA open seed explicitly.

- [ ] **Step 2: Add failing building-update rollback test**

Repeated updates to the same raw candle must always derive from the previous finalized HA candle, not the prior provisional HA output.

- [ ] **Step 3: Add processing-order test**

`1h + Heikin Ashi` must equal `aggregate standard to 1h -> transform to HA`, not `transform lower TF -> aggregate HA`.

- [ ] **Step 4: Implement transform registry and HA transformer**

- [ ] **Step 5: Attach synthetic provenance to source metadata**

- [ ] **Step 6: Run runtime/source tests**

- [ ] **Step 7: Commit**

```bash
git add packages/indicator-runtime/src packages/indicator-runtime/test packages/indicator-sdk/src
git commit -m "feat(indicators): add Heikin Ashi source transforms"
```

---

### Task 13: Rebuild signal semantics around source confirmation and no-lookahead

**Files:**

- Rewrite: `packages/indicator-sdk/src/signal.ts`
- Create: `packages/indicator-sdk/src/internal/signals.ts`
- Modify: `packages/indicator-runtime/src/source-engine.ts`
- Modify: `packages/indicator-runtime/src/worker-entry.ts`
- Modify: `packages/contracts/src/indicator-management.ts`
- Add SDK/runtime signal tests

**Interfaces:**

```ts
signal(buy, signal.long);
signal(sell, signal.short);
```

Internal event identity/provenance is host-owned.

- [ ] **Step 1: Add failing warm-up test**

A crossover whose TA inputs are unavailable must not emit a signal.

- [ ] **Step 2: Add failing repeated-building-update test**

Provisional condition changes must not create duplicate finalized events.

- [ ] **Step 3: Add failing higher-timeframe confirmation test**

With chart `5m` and signal source `1h`, closing a 5m candle must not finalize the 1h signal.

- [ ] **Step 4: Add failing replay-vs-live equivalence test**

Finalized signal sequence must match between full history replay and incremental bar updates.

- [ ] **Step 5: Implement hidden signal identity, committed/provisional signal state, source confirmation, and deduplication**

- [ ] **Step 6: Attach source revision and synthetic provenance to runtime events**

- [ ] **Step 7: Add corrected-history invalidation test**

Rebuild must remove/replace downstream signals affected by corrected source candles.

- [ ] **Step 8: Run focused signal/runtime tests**

- [ ] **Step 9: Commit**

```bash
git add packages/indicator-sdk/src/signal.ts packages/indicator-sdk/src/internal/signals.ts packages/indicator-runtime/src packages/contracts/src/indicator-management.ts packages/indicator-sdk/test packages/indicator-runtime/test
git commit -m "feat(indicators): enforce safe signal semantics"
```

---

### Task 14: Evolve worker/runtime contracts for v2 provenance and deltas

**Files:**

- Modify: `packages/contracts/src/indicator-management.ts`
- Modify: `packages/indicator-runtime/src/worker-entry.ts`
- Modify: `packages/indicator-runtime/src/result-validation.ts`
- Modify: `packages/renderer/src/indicator-worker-runtime.ts`
- Modify runtime contract tests

**Interfaces:**

- Public author handles/series never cross this boundary.
- Worker transport remains plain validated data.

- [ ] **Step 1: Add failing contract-validation fixtures for v2 shape, source provenance, and signals**

- [ ] **Step 2: Define runtime source provenance fields**

At minimum retain enough information to distinguish provider/instrument/timeframe/candle type/source revision for signal correctness and diagnostics.

- [ ] **Step 3: Preserve stale generation/revision rejection**

Add tests proving a response from a previous source/config generation cannot replace current results.

- [ ] **Step 4: Preserve bounded output/worker budgets**

Drawing handles do not bypass overlay/output caps.

- [ ] **Step 5: Run runtime/contract tests**

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/indicator-management.ts packages/indicator-runtime/src packages/renderer/src/indicator-worker-runtime.ts packages/indicator-runtime/test
git commit -m "feat(indicators): evolve v2 worker contracts"
```

---

### Task 15: Complete renderer integration for v2 plots, drawings, and MTF alignment

**Files:**

- Modify: `packages/renderer/src/plugin-indicators.ts`
- Modify renderer tests

**Interfaces:**

- Consumes normalized runtime points/overlays/signals only.
- No public SDK objects or KLineCharts handles cross into indicator code.

- [ ] **Step 1: Add failing marker location/text-size tests**

- [ ] **Step 2: Add failing persistent box/segment update/delete tests**

- [ ] **Step 3: Add failing MTF timestamp-alignment test**

A 1h indicator on a 5m chart must map values/markers deterministically without implying that the 1h source finalized at every 5m timestamp.

- [ ] **Step 4: Implement KLineCharts mapping and redraw invalidation**

- [ ] **Step 5: Run renderer focused tests**

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/plugin-indicators.ts packages/renderer/test
git commit -m "feat(indicators): render SDK v2 outputs"
```

---

### Task 16: Rewrite ATR Rope + UT Bot as the flagship SDK v2 proof

**Files:**

- Rewrite: `packages/indicator-examples/src/atr-rope-utbot.ts`
- Modify/add its focused tests/fixtures

**Interfaces:**

- Must use SDK v2 only.
- Trading/domain logic stays local; framework plumbing disappears.

- [ ] **Step 1: Freeze semantic fixtures before deleting v1 implementation**

Capture finalized outputs/signals for representative history covering Rope modes, UT Bot behavior, POC migration, suppression, and drawing states. These fixtures protect trading semantics, not v1 source structure.

- [ ] **Step 2: Rewrite inputs using concise v2 helpers**

No manual keys or generic migration code.

- [ ] **Step 3: Replace manual history arrays used only for lagging with v2 series history**

Use `close[n]`, other series indexing, or SDK-managed state where appropriate.

- [ ] **Step 4: Replace author-managed drawing IDs/arrays/scopes with persistent drawing handles**

- [ ] **Step 5: Add indicator timeframe and candle-type settings**

Options must come from host capabilities.

- [ ] **Step 6: Ensure all signals use the v2 signal engine**

No author code should inspect `isHistoryFinalizedTail` or manually deduplicate finalized events.

- [ ] **Step 7: Run semantic fixture comparison**

Document any intentional semantic differences caused by fixing proven lookahead/state bugs; do not preserve incorrect v1 behavior merely for parity.

- [ ] **Step 8: Read the file as an author-experience review**

Fail this task if significant code remains whose sole purpose is host/runtime plumbing.

- [ ] **Step 9: Commit**

```bash
git add packages/indicator-examples/src/atr-rope-utbot.ts packages/indicator-examples/test
git commit -m "refactor(indicators): port ATR Rope UT Bot to SDK v2"
```

---

### Task 17: Rewrite all remaining maintained indicators

**Files:**

- Modify all maintained indicator example/built-in source files discovered under `packages/indicator-examples` and application-owned indicator directories.
- Add/update semantic fixtures for each.

**Interfaces:**

- SDK v2 only.

- [ ] **Step 1: Inventory every maintained indicator**

Record each file and fixture in the implementation PR/checklist before editing.

- [ ] **Step 2: For each indicator, create/freeze semantic output fixtures**

- [ ] **Step 3: Rewrite each indicator from the mathematics/rules, not by mechanically wrapping v1 APIs**

- [ ] **Step 4: Remove runtime plumbing from each indicator**

No explicit IDs, author history buffers solely for lagging, lifecycle flags, source aggregation, or SDK validation code.

- [ ] **Step 5: Run all indicator semantic suites**

- [ ] **Step 6: Commit in reviewable indicator-sized commits**

Example:

```bash
git commit -m "refactor(indicators): port RSI example to SDK v2"
```

---

### Task 18: Remove SDK v1-only authoring/runtime code

**Files:**

- Delete/modify obsolete exports in `packages/indicator-sdk/src/*`
- Delete obsolete compatibility paths in runtime/contracts/renderer
- Update tests/docs

**Interfaces:**

- SDK v2 is the only supported indicator authoring model.

**Completion:** ECDD-225 completed via PR #133 / squash merge `8b9fd709070bb884295813a07a6fdfa11c4efaf0`; the public package root is v2-only, required host/runtime mechanisms remain internal, maintained indicators/fixtures use the final optimization surface, and no legacy compatibility path was added.

- [x] **Step 1: Search for v1-only APIs**

At minimum inspect references to explicit drawing `id`, `plot.sync`, `plot.drawings`, execution-order error strings, `kernelIndex`, `plotIndex`, `inputIndex`, manual generic parameter migration helpers, and author-visible lifecycle flags.

- [x] **Step 2: Delete obsolete public APIs and corresponding tests**

Do not leave deprecated aliases solely for old indicator source.

- [x] **Step 3: Keep only internal mechanisms still required by host/runtime implementation**

Rename/move them to `internal` modules if they should never be imported by authors.

- [x] **Step 4: Run repository search again and document intentional remaining matches**

- [x] **Step 5: Run typecheck/unit tests**

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(indicators): remove SDK v1 authoring surface"
```

---

### Task 19: Performance, lookahead, replay, and resource acceptance suite

**Files:**

- Add/modify focused performance/correctness tests in SDK/runtime/data-service suites
- Modify delivery/performance test registration only if existing project conventions require it

**Interfaces:**

- Measures platform guarantees, not author implementation choices.

- [ ] **Step 1: Add incremental-complexity instrumentation tests**

Prove EMA/ATR/RSI/crossover do not rescan complete history per building update. Highest/lowest should demonstrate bounded/amortized behavior rather than full-history scans.

- [ ] **Step 2: Add 100k-history bounded test**

Verify product limits and worker output limits remain enforced.

- [ ] **Step 3: Add MTF no-lookahead test matrix**

Cover at least:

```text
chart 5m -> indicator 1h
chart 15m -> indicator 1m (provider-supported separate source)
chart 1m -> TA override 5m
standard -> Heikin Ashi
provider switch making saved TF unavailable
```

- [ ] **Step 4: Add replay/live parity tests for signals and plots**

- [ ] **Step 5: Add source-sharing/resource cleanup tests**

Repeated indicator add/remove must not leak provider subscriptions/source references.

- [ ] **Step 6: Run focused performance/correctness suite and record measured evidence in the plan status section**

- [ ] **Step 7: Commit**

```bash
git add packages/*/test tools
git commit -m "test(indicators): add SDK v2 acceptance coverage"
```

---

### Task 20: Final author documentation and examples

**Files:**

- Rewrite: `docs/development/INDICATOR-AUTHORING.md`
- Update relevant SDK architecture docs that describe the old surface
- Add concise example indicators under the existing examples package

**Interfaces:**

- Documentation teaches v2 only.

- [x] **Step 1: Write a 5-minute beginner tutorial**

Start with:

```ts
const length = input.int(20, "Length");
const average = ta.ema(length);
plot.line(average);
```

Then add crossover signals and marker text. Document timeframe and Heikin Ashi as part of the target SDK v2 architecture, while making clear that provider-aware operational timeframe/per-TA execution and source acquisition are delivered by ECDD-142 rather than ECDD-216.

- [x] **Step 2: Document equivalent overloads without forcing one coding style**

Show `close[1]`, `history(close, 1)`, and `close.at(1)` as equivalent.

- [x] **Step 3: Document platform guarantees**

Explain in plain language that ERC Chart handles lookahead safety, building-bar rollback, history, IDs, provider timeframe availability, and optimization.

- [x] **Step 4: Document provider-dependent timeframe behavior**

Never imply that every provider supports every timeframe.

- [x] **Step 5: Add advanced maintainer section separate from beginner authoring**

Compiler identities, worker revisions, and source-engine internals belong here, not in the beginner flow.

- [x] **Step 6: Run markdown/format checks**

- [x] **Step 7: Commit**

```bash
git add docs packages/indicator-examples
git commit -m "docs(indicators): publish SDK v2 authoring guide"
```

---

## Final Verification Gate

Do not mark Phase 16 complete until fresh evidence exists for every item below.

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm run test:unit`
- [ ] `npm run test:integration`
- [ ] Focused indicator SDK compiler/history/TA tests
- [ ] Focused indicator runtime MTF/source/candle-transform/signal tests
- [ ] Focused renderer marker/drawing/MTF tests
- [ ] ATR Rope + UT Bot semantic fixture suite
- [ ] All remaining maintained indicator semantic suites
- [ ] 100k-history/resource-bound tests
- [ ] Source-sharing cleanup/leak tests
- [ ] Lookahead matrix passes for standard and Heikin Ashi sources
- [ ] Replay and incremental finalized signals match
- [ ] No maintained indicator source imports/uses SDK v1-only authoring APIs
- [ ] No normal indicator author code creates plot/drawing/signal IDs
- [ ] Beginner authoring guide matches actual compiled API examples

Record exact commands, pass counts, skips, and any environment-dependent limitations under the status log below. Never replace fresh evidence with an older result when claiming completion.

---

## Implementation Status Log

Append dated entries here as phases complete. Keep old entries; do not rewrite historical evidence.

### 2026-09-09 — Plan created

- SDK v2 redesign is authorized without legacy indicator source compatibility constraints.
- Design direction: Authoring Compiler + Indicator Source Engine + Stateful Execution Engine.
- Current indicators are intentionally scheduled for full rewrite only after v2 foundations reach their acceptance gates.
- No implementation completion is claimed by this entry.

### 2026-09-13 — ECDD-222 drawing/signal identity completed

- ECDD-222 was squash-merged into `epic/ECDD-135-sdk-v2-optimization` as `f70821b93c033a48d73affe1a535084edda7caab`.
- Persistent box/segment handles now use SDK-owned hidden identity with committed/provisional rollback, bounded retention, ownership checks, and no normal author-created IDs/scopes.
- Signal persistence identity is SDK/compiler-owned; failure paths do not consume fallback identity.
- Compiler call-site metadata is normalized into immutable validated snapshots before downstream identity use.
- Final maintained-indicator retained-handle cleanup remains intentionally deferred to ECDD-224/ECDD-228; no legacy compatibility layer was introduced.
- The design specification and current-state inventory remain directionally correct. The detailed plan ordering was corrected so persistent drawing handles are Task 7 and `plot.shape` text/text-size work is Task 8.
- ECDD-223 is the next SDK-v2 optimization task.

---

## Direction Check for Every Review

Before approving any SDK v2 implementation PR/task, answer these questions:

1. Does this API expose an ERC runtime detail that the indicator author does not need?
2. Could ERC Chart automatically choose the safe/correct behavior instead of asking the author to configure it?
3. Does this force the author to understand execution order, state rollback, provider capabilities, worker lifecycle, IDs, or renderer details?
4. Can the same indicator logic be expressed more like pseudocode without losing correctness?
5. Are signal semantics non-lookahead and tied to the actual source candle's confirmation state?
6. Are timeframe options derived from the active provider/workspace capability set rather than a hard-coded universal list?
7. If the implementation preserves an old API, is that because the host still needs it—or only because legacy indicator source exists? If only legacy source needs it, remove it and rewrite the indicator instead.

If an answer reveals framework plumbing in indicator code, the work is not on the intended path yet.
