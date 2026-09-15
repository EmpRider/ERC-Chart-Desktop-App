# Indicator SDK v2 Pine-Semantics Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the callback-shaped SDK-v2 author experience with the approved top-level Pine-style TypeScript/JavaScript model while preserving the existing worker, source, MTF, provisional/finalized, dependency, signal, and resource-limit foundations.

**Architecture:** Keep the current scalar runtime and worker lifecycle as the execution engine. Add a compiler-only top-level script lowering pass before the existing call-site and history transforms so authored top-level statements become the hidden per-bar evaluator that the current runtime already knows how to execute. Follow with compiler-managed persistent state and persistent drawing-handle semantics, migrate ATR Rope + UT Bot, remove the superseded public compatibility surface, then close with documentation/performance/compliance evidence.

**Tech Stack:** Node.js `26.8.1`; npm `12.0.2`; TypeScript `7.0.2`; TypeScript compiler AST transforms; esbuild; Node built-in test runner; existing `@erc-chart/indicator-sdk` and indicator runtime/worker packages. No new dependency is required.

**Spec:** `docs/superpowers/specs/2026-09-15-indicator-sdk-v2-pine-semantics-correction-design.md`

## Global Constraints

- Preserve worker isolation, typed snapshots/deltas, restart recovery, quotas, committed/provisional semantics, provider-aware MTF, per-TA timeframe, shared source engine, Heikin-Ashi, dependencies, source-confirmed/no-lookahead signals, renderer separation, and current resource caps.
- Do not raise the 2,000-drawing-change safety limit to hide drawing churn.
- Do not introduce a Pine Script parser or TradingView source compatibility.
- Do not expose worker/runtime context, provider APIs, persistence keys, or lifecycle state to indicator authors.
- Do not add a dual long-term legacy/new authoring mode. Temporary internal compatibility may exist only until the maintained indicators are migrated and ECDD-240 removes it.
- All production behavior changes follow RED -> GREEN -> REFACTOR. The failing test must be observed before implementation.
- Every Jira task is implemented on its own `task/ECDD-*` branch created from `epic/ECDD-135-sdk-v2-pine-correction`; task PRs target that epic branch and squash-merge.
- Before completing each Jira task, re-read the relevant design sections, record the 14 anti-drift answers in Jira, and run fresh verification on the exact task head.

---

## Delivery Order

1. **ECDD-236** — top-level Pine-style authoring, direct price/bar globals, input/source semantics, derived history.
2. **ECDD-237** — compiler-managed persistent `var` and scalar recurrence semantics.
3. **ECDD-238** — persistent opaque drawing handles and bounded drawing mutation reconciliation.
4. **ECDD-239** — rewrite ATR Rope + UT Bot onto the corrected authoring model and prove regression parity.
5. **ECDD-240** — delete superseded public authoring APIs/compatibility paths after maintained sources no longer use them.
6. **ECDD-241** — correct docs/current-state claims, run full performance/acceptance gates, and produce the final design-to-code compliance matrix.

Each later task starts from the updated epic branch only after its predecessor has completed task-to-epic review and merge. This prevents later tasks from depending on unreviewed task-branch history.

---

### Task 1: ECDD-236 — Lower top-level script authoring into the existing per-bar runtime

**Files:**
- Create: `tools/indicator-authoring/script-transform.mjs`
- Create: `tools/indicator-top-level-authoring-transform.test.mjs`
- Modify: `tools/indicator-authoring-transform.mjs`
- Test: `tools/indicator-top-level-authoring-transform.test.mjs`
- Test: `tools/indicator-authoring-transform.test.mjs`

**Interfaces:**
- Consumes: authored modules importing named SDK roots from `@erc-chart/indicator-sdk` and containing exactly one exported metadata declaration `defineIndicator({...})`.
- Produces: source containing the same metadata call with a compiler-generated second argument `(__ercBar) => { ...script... }`, suitable for the existing call-site and history transforms.
- Produces: script-local bindings `open`, `high`, `low`, `close`, `volume`, `hl2`, `hlc3`, `ohlc4`, and `bar` (`index`, `time`, `confirmed`) from the hidden runtime bar.

- [ ] **Step 1: Write failing transform tests for the canonical authored shape**

Use a fixture equivalent to:

```ts
import { defineIndicator, input, plot, ta } from "@erc-chart/indicator-sdk";

export default defineIndicator({ id: "fixture", name: "Fixture" });

const length = input.int(14, "Length");
const source = input.source(close, "Source");
const average = ta.ema(source, length);
plot.line(average, { title: "Average" });
```

Assert the top-level lowering result contains one `defineIndicator` runtime calculation callback, generated price/bar bindings, and the four script statements inside that callback rather than at module execution time.

- [ ] **Step 2: Run the focused test and observe RED**

Run:

```powershell
node --test tools/indicator-top-level-authoring-transform.test.mjs
```

Expected: FAIL because `script-transform.mjs` and top-level lowering do not exist.

- [ ] **Step 3: Implement the smallest script classifier/lowering pass**

`transformIndicatorScript()` will:

```js
export function transformIndicatorScript(sourceText, { fileName = "indicator.ts" } = {}) {
  // Parse TypeScript/JavaScript.
  // Resolve the named SDK defineIndicator import (including aliases).
  // Find one exported metadata-only defineIndicator({...}) declaration.
  // Keep imports, type-only statements, and provably module-static declarations outside.
  // Move per-bar statements and helpers that depend on SDK authoring roots or price/bar globals into a hidden callback.
  // Rewrite input.source(close/high/...) defaults to the runtime's private canonical source token.
  // Return { code, changed } with source locations preserved by the TypeScript printer.
}
```

The first implementation is deliberately conservative: when a declaration cannot be proven module-static, place it in the generated evaluator. Pure literal constants and pure helpers remain module static.

- [ ] **Step 4: Compose script lowering before call-site/history lowering**

Change the pipeline to:

```js
const scriptResult = transformIndicatorScript(sourceText, { fileName });
const callsiteResult = transformIndicatorCallsites(scriptResult.code, {
  fileName,
  sourceFileId,
});
const historyResult = transformIndicatorHistory(callsiteResult.code, fileName);
```

`changed` becomes the OR of all three transforms.

- [ ] **Step 5: Verify GREEN and existing transform regressions**

Run:

```powershell
node --test tools/indicator-top-level-authoring-transform.test.mjs tools/indicator-authoring-transform.test.mjs
```

Expected: PASS.

---

### Task 2: ECDD-236 — Make input declarations/source selection match the authored API

**Files:**
- Modify: `packages/indicator-sdk/src/input.ts`
- Modify: `packages/indicator-sdk/src/index.ts`
- Modify: `packages/indicator-sdk/test/authoring.test.mjs`
- Modify: `packages/indicator-sdk/test/indicator-sdk.types.ts`
- Test: `tools/indicator-top-level-authoring-transform.test.mjs`

**Interfaces:**
- Consumes author syntax: `input.int(14, "Length")`, `input.float(1.5, "Multiplier")`, `input.bool(true, "Enabled")`, `input.color("#fff", "Color")`, `input.source(close, "Source")`.
- Runtime continues storing source input metadata as private `PriceSource` strings and returns the selected *current numeric value* to authored code.

- [ ] **Step 1: Add failing tests for positional labels and direct source defaults**

Add assertions proving runtime input metadata gets `label: "Length"` from the positional string and that compiler output canonicalizes `input.source(close, "Source")` to the private runtime source token without exposing `priceSources`/`priceValue()` to authored code.

- [ ] **Step 2: Observe RED**

Run:

```powershell
npm run build
node --test packages/indicator-sdk/test/authoring.test.mjs tools/indicator-top-level-authoring-transform.test.mjs
```

Expected: FAIL on positional label handling and/or direct source default typing/lowering.

- [ ] **Step 3: Normalize `string | options` consistently in the runtime input API**

Use one helper:

```ts
function inputOptions(value: string | InputOptions | undefined): InputOptions {
  return typeof value === "string" ? { title: value } : (value ?? {});
}
```

Apply it to numeric, boolean, string, color, source, timeframe, and candle-type authoring methods where the design permits a positional label.

- [ ] **Step 4: Expose the desired source argument at the type boundary without changing private storage**

Public authoring types accept a compiler-known series default; generated runtime code still calls the private string-backed source implementation after transform canonicalization.

- [ ] **Step 5: Verify GREEN**

Run the focused SDK/transform tests and `npm run typecheck`.

---

### Task 3: ECDD-236 — Support direct price/bar globals and derived-value history

**Files:**
- Modify: `tools/indicator-authoring/history-transform.mjs`
- Modify: `tools/indicator-authoring/callsite-transform.mjs` only where direct generated bindings change provenance recognition
- Create/Modify: `tools/indicator-top-level-authoring-transform.test.mjs`
- Modify: `tools/indicator-authoring-history-transform.test.mjs`
- Modify: `tools/indicator-authoring-history-transform-review.test.mjs`
- Modify: `packages/indicator-sdk/test/indicator-sdk.types.ts`

**Interfaces:**
- Direct current values: `open`, `high`, `low`, `close`, `volume`, `hl2`, `hlc3`, `ohlc4`.
- Bar metadata: `bar.index`, `bar.time`, `bar.confirmed`.
- History: `close[1]` and derived `fast[1]` lower to the existing `history(currentValue, barsBack)` runtime primitive.

- [ ] **Step 1: Add failing history tests for a derived TA value**

Fixture:

```ts
const fast = ta.ema(close, 9);
const previousFast = fast[1];
plot.line(previousFast, { title: "Previous fast" });
```

Assert `fast[1]` is lowered to `history(fast, 1)` while an ordinary array access remains untouched.

- [ ] **Step 2: Observe RED**

Run `node --test tools/indicator-authoring-history-transform.test.mjs` and confirm the derived access is not currently lowered.

- [ ] **Step 3: Add conservative derived-series inference**

Within the generated calculation callback, infer a local as series-valued when its initializer is:

```text
- a built-in series binding;
- a `ta.*` call returning a scalar;
- `input.source(...)`;
- `history(...)`;
- an arithmetic/conditional expression whose value depends on an already inferred series local.
```

Propagate until stable, then permit bracket/`.at()` lowering only for those inferred series bindings. Do not rewrite values inferred as arrays/objects.

- [ ] **Step 4: Verify direct bar globals through the package build path**

Add a package fixture that uses `bar.index`, `bar.time`, and `bar.confirmed`, builds with `buildIndicatorPackage`, and executes enough history/live updates to prove generated bindings read the current runtime bar.

- [ ] **Step 5: Verify GREEN and history performance**

Run the focused history/package tests plus `node tools/indicator-history-performance.mjs`.

---

### Task 4: ECDD-236 — Prove static input identity and reject dynamic multiplicity

**Files:**
- Modify: `tools/indicator-authoring/script-transform.mjs`
- Modify: `tools/indicator-authoring/callsite-transform.mjs` if the static analysis belongs with call classification
- Test: `tools/indicator-top-level-authoring-transform.test.mjs`
- Test: `tools/indicator-input-label-identity-package.test.mjs`

**Interfaces:**
- A statically reachable helper may contain `input.*` and receives compiler call-site identity.
- Input declarations inside loops or otherwise provably multi-executed dynamic constructs fail at package build with authored file/line/column.

- [ ] **Step 1: Add a passing helper fixture and failing loop fixture**

```ts
function readLength() {
  return input.int(14, "Length");
}
const length = readLength();
```

and:

```ts
for (const length of [9, 14]) {
  input.int(length, "Length");
}
```

- [ ] **Step 2: Observe RED for the dynamic declaration diagnostic**

The current system fails only later through runtime occurrence identity; the package compiler must reject the statically provable loop itself.

- [ ] **Step 3: Implement the build-time multiplicity guard**

Reject input call sites under `for`, `for..of`, `for..in`, `while`, or `do` constructs and other immediately provable repeated execution. Keep a helper callable once from the hidden script evaluator valid.

- [ ] **Step 4: Verify source-mapped diagnostics and stable helper identity**

Run focused transform/package tests twice with unrelated declaration reordering and assert the generated input identity remains stable.

---

### Task 5: ECDD-236 — Package-level acceptance and task verification

**Files:**
- Create: `tools/indicator-top-level-authoring-package.test.mjs`
- Modify: `tools/indicator-v2-contract-fixtures.test.mjs` as needed for the corrected canonical fixture
- Modify: `tools/indicator-authoring-performance.mjs` to benchmark the corrected canonical source shape without changing the existing performance threshold unless measured evidence requires it

**Interfaces:**
- Input: a standalone top-level authored indicator package.
- Output: installed indicator metadata and runtime numeric rows through the unchanged worker/runtime contract.

- [ ] **Step 1: Add the full canonical package fixture and observe RED before the implementation that makes it pass**

The fixture must use metadata-only `defineIndicator`, top-level inputs, `input.source(close)`, direct OHLC, direct bar metadata, TA, plot, `close[1]`, and derived history.

- [ ] **Step 2: Run the full focused ECDD-236 suite**

```powershell
npm run build
node --test tools/indicator-top-level-authoring-transform.test.mjs tools/indicator-top-level-authoring-package.test.mjs tools/indicator-authoring-history-transform.test.mjs tools/indicator-input-label-identity-package.test.mjs packages/indicator-sdk/test/authoring.test.mjs
```

- [ ] **Step 3: Run protected regression gates**

```powershell
npm run typecheck
npm run test:unit
npm run test:legacy-indicators
npm run test:integration
node tools/indicator-authoring-performance.mjs
node tools/indicator-history-performance.mjs
```

- [ ] **Step 4: Re-read the correction design and answer all 14 anti-drift questions in Jira**

Record exact commands, results, branch SHA, changed files, performance evidence, legacy code intentionally left for ECDD-237/ECDD-240, and why worker/source/MTF/no-lookahead foundations were not changed.

- [ ] **Step 5: Commit/push/open the ECDD-236 draft PR to the correction epic branch**

Use task-branch commits prefixed `ECDD-236:`. Mark ready only after local deterministic checks and the PR body contract are complete.

---

### Task 6: ECDD-237 — Compiler-managed persistent `var` and recurrence

**Files:**
- Create: `tools/indicator-authoring/state-transform.mjs`
- Modify: `tools/indicator-authoring-transform.mjs`
- Modify: `packages/indicator-sdk/src/series.ts` to expose only private state primitives needed by lowered code
- Modify: `packages/indicator-sdk/src/authoring-context.ts` if stable persistent slots need a dedicated private kernel kind
- Create: focused state-transform/package tests

**Interfaces:**
- Author syntax: scalar history recurrence plus compiler-recognized persistent `var` object/array declarations.
- Private runtime primitive: committed value + provisional clone/rollback keyed by compiler identity.

- [ ] Write RED fixtures for finalized commit, repeated building rollback, corrected-history reset, persistent arrays/objects, helper-call-site independence, and bounded collection failure.
- [ ] Lower persistent declarations to hidden state slots using existing compiler identity metadata; no author key/ID is accepted.
- [ ] Preserve drawing handles as opaque references when they appear inside persistent state; ordinary user objects remain copy-on-write cloned.
- [ ] Verify state operations remain O(1) or amortized O(1) and run the existing series/TA/runtime identity performance gates.
- [ ] Re-read the state sections of the design, record all 14 anti-drift answers in Jira, then review/merge task-to-epic before ECDD-238 starts.

---

### Task 7: ECDD-238 — Persistent drawing handles

**Files:**
- Modify: `packages/indicator-sdk/src/plot.ts`
- Modify: `packages/indicator-sdk/src/internal/drawings.ts`
- Modify: runtime overlay reconciliation only where required by handle identity
- Modify/Create: `packages/indicator-sdk/test/drawing-handles.test.mjs` and stress fixtures

**Interfaces:**
- `const box = plot.box({...})`; `box.set({...})`; `box.delete()`.
- Handle carries no author-visible persistence ID and never crosses the worker transport boundary.

- [ ] Write RED tests proving unaffected handle identity survives zone insert/remove/reorder and one-zone updates do not rewrite unrelated historical geometry.
- [ ] Bind each handle to one hidden compiler/runtime identity and enforce same-instance ownership.
- [ ] Ensure provisional rollback restores committed handle geometry/reference ownership without deep-cloning handles as user objects.
- [ ] Add the 10,000-bar ATR POC migration stress fixture and prove the existing 2,000-change limit is not exceeded.
- [ ] Run drawing/runtime/performance gates, anti-drift design re-check, Jira evidence, review, and task-to-epic merge.

---

### Task 8: ECDD-239 — Rewrite ATR Rope + UT Bot as the flagship corrected indicator

**Files:**
- Rewrite: `packages/indicator-examples/src/atr-rope-utbot.ts`
- Modify: `packages/indicator-examples/test/*.test.mjs`
- Modify/Create: package/runtime regression fixtures for accepted signal and POC semantics

**Interfaces:**
- Authored source uses metadata-only `defineIndicator`, direct top-level `input.*`, `input.source(close)`, direct price/bar globals, history/persistent `var`, `ta.*`, persistent drawing handles, plots, and signals.
- No `readInputs`, `priceSources`, `priceValue`, public `series`, empty recurrence state objects, `previous => step...`, flattened drawing sync, or worker lifecycle bookkeeping remains.

- [ ] Freeze trusted pre-rewrite output/signal/POC fixtures first and observe them detect a deliberately altered value before rewriting.
- [ ] Rewrite one semantic area at a time (inputs/source, rope/direction, UT state, POC domain state, drawings, signals), keeping the regression fixture green after each area.
- [ ] Perform the required full-file helper/state/array/branch audit and move any runtime-only responsibility into compiler/SDK/runtime rather than recreating helpers in the indicator.
- [ ] Run replay/provisional/timeframe/config/POC stress and existing performance gates.
- [ ] Re-read the full correction design, answer all 14 anti-drift questions with explicit ATR Rope evidence, then review/merge task-to-epic.

---

### Task 9: ECDD-240 — Delete legacy public authoring APIs and compatibility paths

**Files:**
- Modify: `packages/indicator-sdk/src/index.ts`
- Modify: `packages/indicator-sdk/src/series.ts`
- Modify: `tools/indicator-authoring/callsite-transform.mjs`
- Modify: old compatibility-focused tests/examples whose only purpose is the removed source model
- Modify: public-surface type contract tests

**Interfaces:**
- Public root no longer exports `series`, `priceSources`, or `priceValue`.
- Metadata-only `defineIndicator` is the one public declaration shape.
- Private equivalents may remain only behind compiler/runtime internals.

- [ ] Write/flip the public contract tests so they fail while removed names are still exported.
- [ ] Search maintained source for forbidden helpers and remove each confirmed compatibility dependency.
- [ ] Delete compatibility-only transforms/branches after proving corrected packages no longer use them.
- [ ] Run build/type/public-contract/full regression gates and confirm no dual public authoring path remains.
- [ ] Re-read cleanup/non-goals sections, record all 14 anti-drift answers, review, and merge task-to-epic.

---

### Task 10: ECDD-241 — Documentation, performance, and final design compliance

**Files:**
- Modify: `docs/development/INDICATOR-AUTHORING.md`
- Modify: `docs/development/INDICATOR-SDK-V2-CURRENT-STATE.md`
- Modify: SDK-related `README.md` sections if present
- Modify/Create: acceptance/performance fixtures required by the correction design

**Interfaces:**
- Documentation teaches only the corrected top-level Pine-style SDK-v2 model.
- Compliance evidence maps each normative design requirement to code and a fresh test/performance result.

- [ ] Write a design-derived compliance checklist before reading the final implementation diff.
- [ ] Update docs/examples only after verifying the actual public exports and compiler behavior.
- [ ] Run the complete unit, legacy-indicator, integration, performance, worker, drawing, MTF, dependency, multi-chart, formatting, lint, typecheck, build, audit, and version gates required by governance.
- [ ] Run the production-like ATR Rope/UT Bot POC stress and record drawing mutation/runtime evidence.
- [ ] Produce the final design-to-code matrix with only PASS rows or explicit product-owner exceptions.
- [ ] Re-run the 14 anti-drift questions from scratch and record exact-head evidence in Jira.
- [ ] Complete epic-to-main review requirements: deterministic/Windows gates, required statuses, maintainer exact-head review, mandatory comprehensive CodeRabbit, applicable Qodo, Code Review AI, resolved conversations, and merge-commit promotion.

---

## Plan Self-Review

- **Spec coverage:** Sections 3-6 map to ECDD-236; state semantics to ECDD-237; drawings to ECDD-238; ATR acceptance to ECDD-239; public cleanup to ECDD-240; tests/docs/completion to ECDD-241. Protected runtime foundations are explicit global constraints rather than duplicated work.
- **Placeholder scan:** No `TBD`, `TODO`, “implement later”, or unspecified “write tests” steps remain. Every behavior-changing section names a concrete fixture/command and expected RED/GREEN intent.
- **Type/interface consistency:** The compiler-lowered hidden callback remains the existing internal runtime seam; authored source never sees it. Source inputs remain string-backed metadata internally but numeric in authored execution. History continues using the existing committed/provisional `history()` runtime primitive.
- **Scope discipline:** ECDD-236 does not prematurely implement persistent `var`, final drawing-handle migration, ATR rewrite, or final public API deletion; those remain separately reviewable Jira tasks.

## Execution Choice

This session uses **inline execution** because the active goal requires continuing the work autonomously and repository governance already supplies task-level review checkpoints. Implementation still stops at each Jira merge boundary if an external maintainer/reviewer gate is required before the next task branch may legally start.
