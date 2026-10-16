# Indicator SDK v2 Pine-Semantics Correction Design

**Date:** 2026-09-15
**Status:** Approved architecture; implementation in progress
**Supersedes:** Any SDK-v2 implementation/documentation behavior that conflicts with the author-experience rules in `2026-09-09-indicator-sdk-v2-redesign-design.md`

## 1. Purpose

Correct the SDK v2 authoring model so indicator source reads like Pine-style trading logic while remaining TypeScript/JavaScript. The authoring compiler and SDK must own ERC Chart runtime mechanics: recurrence, history slots, input identity, price-source resolution, provisional rollback, drawing identity/reconciliation, replay, worker state, and source metadata.

The current `atr-rope-utbot.ts` is evidence that the implementation stopped short of that goal. It still exposes `readInputs()`, `priceSources`, `priceValue()`, `series(...)`, explicit empty state objects, `previous => step...` recurrence plumbing, and positional drawing synchronization. Those constructs make the indicator author reason about ERC runtime architecture instead of the indicator itself.

This design restores the original SDK-v2 hard rule:

> If code exists primarily because of ERC Chart runtime architecture rather than because the indicator's mathematics require it, that code belongs in the compiler, SDK, or host—not in the indicator.

## 2. Approved direction

Use **compiled TypeScript/JavaScript with Pine-style semantics**. Do not build a separate Pine parser or TradingView compatibility language.

Indicator source remains normal `.ts`/`.js` that the ERC authoring compiler transforms before packaging. The compiler is allowed to reinterpret specific authoring constructs—price-series globals, history indexing, script declarations, persistent `var` state, inputs, TA calls, plots, drawings, and signals—into the existing safe runtime primitives.

The generated runtime may remain complex. The authored indicator must not be.

## 3. Target author experience

A representative indicator should read top-to-bottom without a runtime callback or state container:

```ts
import {
  defineIndicator,
  input,
  plot,
  signal,
  ta,
} from "@erc-chart/indicator-sdk";

export default defineIndicator({
  id: "erc.indicator.example",
  name: "Example",
  placement: "overlay",
});

const fastLength = input.int(9, "Fast length");
const slowLength = input.int(21, "Slow length");
const source = input.source(close, "Source");

const fast = ta.ema(fastLength, source);
const slow = ta.ema(slowLength, source);

const buy = ta.crossover(fast, slow);
const sell = ta.crossunder(fast, slow);

plot.line(fast);
plot.line(slow);
signal(buy, "long");
signal(sell, "short");
```

There is no author-facing calculation callback, context object, `series()`, `priceValue()`, source-option array, explicit runtime ID, replay flag, or worker lifecycle API.

`defineIndicator({...})` remains the metadata declaration. The authoring compiler injects the hidden per-bar evaluator required by the runtime.

## 4. Script model

### 4.1 Source-file classification

The compiler classifies source constructs into three groups:

1. **Static module declarations** — imports, types/interfaces, literal option arrays, pure utility functions, constants that do not depend on per-bar values.
2. **Indicator metadata** — the single exported `defineIndicator({...})` declaration.
3. **Script statements** — inputs, price-dependent calculations, TA calls, history access, mutable per-bar/persistent variables, plots, drawings, and signals.

Script statements are lowered into a generated hidden evaluator that runs for each bar. Authors do not write or receive that evaluator.

### 4.2 Price and bar globals

The compiler/SDK supplies current-bar globals directly:

```ts
open
high
low
close
volume
hl2
hlc3
ohlc4
```

Author-relevant bar metadata is available through a small Pine-style namespace:

```ts
bar.index
bar.time
bar.confirmed
```

These names compile to the runtime bar frame. Indicator code must not receive a large ERC context object.

### 4.3 Helper functions

Authors may organize calculations into normal functions. Price globals, inputs, TA calls, history access, and signals used inside helper functions are resolved by the compiler/runtime without requiring a context parameter.

Pure helpers stay ordinary JavaScript. Stateful authoring constructs inside helpers receive stable hidden identity based on declaration/call-site metadata.

## 5. Inputs

### 5.1 Inputs may be declared where the logic needs them

A dedicated `readInputs()` function is not required or recommended. Inputs may be declared at module scope or in statically analyzable helper code.

```ts
const ropePeriod = input.int(14, "ATR period", { min: 1, max: 500 });
const source = input.source(close, "Source");
```

The compiler extracts input definitions at build time and gives every declaration a hidden persistence identity. Runtime discovery order must not determine identity.

Dynamic input multiplicity is invalid: an input declaration may not be generated an arbitrary number of times by data-dependent loops/recursion. The build should report a source-mapped authoring error instead of exposing runtime bookkeeping rules.

### 5.2 Concise overloads

Common input forms use positional labels plus optional advanced options:

```ts
input.int(14, "Length")
input.float(1.5, "Multiplier")
input.bool(true, "Enabled")
input.color("#3daa45", "Color")
input.source(close, "Source")
input.timeframe(timeframe.chart, "Timeframe")
input.candleType(candle.standard, "Candle type")
```

Verbose option objects remain available for min/max/step/group/description/effect, but they are not mandatory ceremony.

## 6. Price sources

`priceSources` and `priceValue()` are not author APIs.

`input.source()` owns the supported source list and binds the selected source to its current numeric series automatically:

```ts
const ropeSource = input.source(close, "ATR Rope source");
const utSource = input.source(close, "UT Bot source");
```

The settings UI obtains source choices from the SDK input definition. Indicator source must never maintain the source-option list or switch over OHLC fields.

The runtime may keep internal source identifiers/tokens, but they are hidden behind the authoring compiler and `input.source()`.

## 7. History and recurrence

### 7.1 Series values are implicit

Any bar-derived script value is series-capable from the author's point of view. History uses Pine-style indexing:

```ts
const priorClose = close[1];
const priorRope = rope[1];
const twoBarsBack = fast[2];
```

The compiler lowers history access to hidden history slots keyed by stable declaration identity. The author never allocates or appends history arrays merely to read prior values.

`history(value, barsBack)` may remain as an optional advanced/explicit spelling, but ordinary authored code should not need it.

### 7.2 Remove author-facing `series()`

`series(initial, previous => next)` becomes an internal runtime primitive, not a public author API.

Code such as:

```ts
const ropeState = series(emptyRopeState, (previous) =>
  stepRope(previous, source, atr, laggedSource, params),
);
```

must disappear from maintained indicators.

Scalar recurrence is expressed through ordinary calculations and history references. The compiler provides the committed/provisional semantics behind those references.

### 7.3 Persistent mutable state

Complex indicators sometimes need persistent collections or objects, for example POC zones. Use JavaScript's valid `var` keyword as the explicit Pine-style persistent-state marker:

```ts
var zones: PocZone[] = [];
```

For authored indicator scripts, a stateful `var` declaration means “initialize once for this indicator instance and preserve across bars.” The compiler lowers it to a hidden state slot with:

- stable declaration identity;
- committed/finalized state;
- building-bar copy-on-write/provisional rollback;
- bounded collection validation;
- rebuild/corrected-history reset semantics;
- no author-visible runtime generation/revision fields.

Ordinary `const`/`let` values are evaluated for the current bar. Their historical values remain available through compiler-managed series history where referenced.

Persistent state inside a helper is keyed by the helper state declaration plus the invocation call site so independent uses do not collide.

### 7.4 Warm-up behavior

Unavailable history evaluates to the SDK's numeric unavailable state (`NaN` internally unless the runtime later adopts a dedicated sentinel). TA/plot/signal helpers handle it safely. Authors should not add repetitive warm-up guards unless the indicator mathematics specifically require them.

## 8. Technical-analysis API

TA remains under `ta.*`. The SDK owns kernels, windows, caching, history, and timeframe resolution.

Preferred overloads include:

```ts
ta.ema(20)                 // close, active timeframe
ta.ema(20, open)
ta.ema(open, 20)
ta.ema(20, "1h")
ta.ema(open, 20, "1h")

ta.rsi(14)
ta.rsi(14, open)

ta.highest(20)             // high by default
ta.lowest(20)              // low by default
ta.atr(14)
ta.dmi(14)
```

Where JavaScript runtime argument types are ambiguous, the authoring compiler canonicalizes the overload before execution. Authors do not select kernels or provide state IDs.

## 9. Drawings

### 9.1 Identity belongs to handles, not flattened array positions

The ATR Rope failure exposed a design defect: replaying a changing flattened drawing list through callsite occurrence makes array position behave like drawing identity.

Dynamic drawings must instead use persistent opaque handles. Creation assigns hidden runtime identity once; subsequent updates operate on that handle:

```ts
var zoneBox = undefined;

if (createZone && zoneBox === undefined) {
  zoneBox = plot.box({ left: bar.time, right: bar.time, top, bottom, color });
}

zoneBox?.set({ right: bar.time, top, bottom, color });

if (removeZone) {
  zoneBox?.delete();
  zoneBox = undefined;
}
```

No author-visible drawing ID is introduced.

### 9.2 Handles in persistent state

SDK drawing handles are approved opaque persistent values. The state engine preserves handle ownership/reference identity rather than deep-cloning them as user objects. They remain worker-local and never cross the worker transport boundary.

A zone may therefore retain its own box/segment handles. Pruning/reordering zones does not rebind unrelated drawings.

### 9.3 Drawing limits remain enforced

The 2,000-drawing/change safety bounds remain platform safeguards. The fix is to stop unnecessary replay/churn, not raise the bound.

The runtime must only emit geometry changes for handles whose state actually changed.

## 10. ATR Rope + UT Bot rewrite contract

`packages/indicator-examples/src/atr-rope-utbot.ts` becomes the acceptance fixture for this authoring model.

The rewritten source must not contain framework plumbing such as:

- `readInputs()` solely to bundle input calls;
- `priceSources`;
- `priceValue()`;
- public `series()` calls;
- `emptyRopeState`, `emptyRopeDirectionState`, `emptyUtState`, or similar objects whose purpose is runtime recurrence;
- `previous => step...` state threading;
- flattened `collectZoneDrawings()` / positional `syncZoneDrawings()` reconciliation;
- replay/finalization/runtime worker bookkeeping.

It may still contain genuine domain complexity: ATR Rope sensitivity modes, UT Bot rules, DMI/POC scoring, POC migration, zone retention policy, suppression rules, follow/MG signal rules, and visual styling.

A representative target section is:

```ts
const ropePeriod = input.int(14, "ATR period", { group: "ATR Rope" });
const ropeMultiplier = input.float(1.5, "Multiplier", { group: "ATR Rope" });
const ropeSource = input.source(close, "Source", { group: "ATR Rope" });

const ropeAtr = ta.atr(ropePeriod);
let rope = ropeSource;
const previousRope = rope[1];

rope = Number.isFinite(previousRope) ? previousRope : ropeSource;
// ATR Rope mathematics update `rope` here.

const directionBase = ta.sma(rope, directionLookback);
// Direction mathematics here.

plot.line(rope, { color: ropeColor, width: ropeWidth });
```

The exact final ATR code will be driven by regression parity tests; this example defines the authoring shape, not the final algorithm implementation.

## 11. Compiler/runtime boundaries

### Compiler owns

- script-vs-static classification;
- hidden per-bar evaluator generation;
- price/bar global lowering;
- input metadata extraction and hidden identity;
- history indexing and derived-series history slots;
- persistent `var` lowering;
- stateful helper call-site identity;
- TA/plot/drawing/signal hidden identities;
- overload canonicalization;
- source-mapped author diagnostics.

### SDK/runtime owns

- current source resolution;
- input value normalization/persistence;
- TA kernels and efficient rolling algorithms;
- committed/provisional state lifecycle;
- corrected-history rebuild behavior;
- worker transport/lifecycle;
- signal finalization/deduplication;
- drawing handle registry and geometry reconciliation;
- bounded state/drawing/resource limits.

### Indicator owns

- trading mathematics;
- input choices/defaults that affect that mathematics;
- domain state such as what a POC zone means;
- conditions for creating/updating/removing domain objects;
- presentation choices;
- buy/sell conditions.

## 12. Public API cleanup

After the new compiler/runtime path is proven, remove these from the public SDK root:

```ts
series
priceSources
priceValue
```

Internal equivalents may remain in private modules.

Do not add compatibility aliases or a dual old/new authoring mode. Maintained indicators are rewritten to the corrected SDK-v2 model, consistent with the project's no-legacy-compatibility decision.

`history()` may remain as an advanced explicit alternative because it expresses indicator semantics rather than runtime lifecycle plumbing.

## 13. Error model

Author errors should fail at build time whenever static analysis can prove them. Diagnostics must point to authored source, not generated runtime code.

Examples:

- dynamic/ambiguous input declaration multiplicity;
- unsupported history index;
- illegal persistent value type;
- cross-instance drawing handle use;
- ambiguous TA overload the compiler cannot resolve;
- unsupported use of per-bar globals during true module-static initialization.

Runtime errors remain for genuinely data-dependent failures and safety limits.

## 14. Acceptance tests

The correction is not complete until all of these pass.

### Authoring surface

- A package fixture compiles the top-level script style shown in section 3.
- Inputs declared at module scope work without `readInputs()`.
- A statically reachable helper may declare an input without runtime order identity.
- `input.source(close, ...)` exposes SDK-owned source options and returns the selected current series.
- Public SDK types no longer expose `series`, `priceSources`, or `priceValue` after cutover.

### History/state

- `close[1]` and derived-value history such as `fast[1]` produce correct results.
- Scalar recurrence works without author-facing `series()`.
- Persistent `var` objects/arrays survive finalized bars, roll back building updates, and reset correctly on rebuild.
- The same stateful helper used at independent call sites receives independent hidden state.

### Drawings

- Dynamic zone insertion/removal/reordering preserves unaffected handle identity.
- Updating one zone does not rewrite every historical zone.
- Handle deletion/recreation obeys retention bounds.
- A 10,000-bar ATR Rope replay with production-like POC migration stays below per-bar drawing-change limits.

### ATR Rope + UT Bot

- Finalized rope/direction/UT outputs match trusted pre-correction semantics where those semantics are valid.
- Buy/sell/follow/MG signals preserve accepted behavior.
- POC visual semantics remain correct for current, historical, frozen, Line, Band, and Line + Band modes.
- No `INDICATOR_WORKER_EXECUTION_FAILED`, queue-full cascade, or restart-limit cascade occurs in the reproduction that currently fails.
- The renderer continues receiving numeric rows after live updates and timeframe/config changes.

### Performance and safety

- Initial history remains algorithmically bounded and meets existing performance gates.
- Live steady-state execution does not regress accepted budgets.
- Existing worker/source/state/drawing resource caps remain enforced.

## 15. Documentation correction

After implementation, update:

- `docs/development/INDICATOR-AUTHORING.md` to make top-level Pine-style authoring the canonical guide;
- `docs/development/INDICATOR-SDK-V2-CURRENT-STATE.md` to remove claims that the author-experience slice is complete until these gates pass;
- SDK examples/tests so no maintained example teaches `series()`, `priceValue()`, or manual source option plumbing.

The 2026-09-09 redesign remains the architectural origin. This document is a correction that makes its author-experience requirements executable and explicitly addresses the divergence found in ATR Rope + UT Bot.

## 16. Non-goals

This correction does not introduce:

- a Pine Script parser;
- TradingView source compatibility;
- provider APIs in indicator source;
- author-visible worker/runtime context;
- unsafe lookahead;
- legacy SDK compatibility shims;
- a higher drawing safety limit as a substitute for correct identity/lifecycle.

## 17. Completion definition

The work is complete only when a developer can read `atr-rope-utbot.ts` and see indicator logic rather than ERC runtime architecture, and the production failure is removed by the same architectural correction—not by a special-case patch.
