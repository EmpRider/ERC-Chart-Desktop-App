# Indicator SDK v2 Redesign — Design Specification

**Status:** Approved direction, implementation not started by this document.

**Date:** 2026-09-09

**Purpose:** Define the target architecture and authoring model for a ground-up redesign of the ERC Chart indicator SDK so indicator code reads like pseudocode/PineScript while the SDK and host own execution, safety, optimization, state, data-source resolution, plotting, and signal correctness.

---

## 1. Executive decision

The indicator SDK may be redesigned from zero.

**There is no requirement to preserve compatibility with existing indicator source code, existing SDK call shapes, internal indicator runtime APIs, or legacy indicator package behavior during this redesign.**

The project will complete the new SDK/runtime architecture first, then rewrite every current indicator against the new SDK. Compatibility shims, deprecated aliases, migration bridges, or dual v1/v2 authoring paths should not be added unless they are required by the host application itself during the cutover.

This decision is deliberate. Preserving the current authoring model would force runtime details such as call order, explicit IDs, provisional state, drawing reconciliation, source aggregation, and error handling back into indicator code. That would conflict with the primary product goal.

### Primary product goal

An indicator author should be able to write code that is almost pseudocode and understandable by a person with very little programming experience.

The author should think only about:

1. inputs;
2. calculations;
3. conditions;
4. plots/drawings;
5. signals.

Everything else belongs to ERC Chart.

---

## 2. Authoring philosophy

### 2.1 Hard rule

> If code exists primarily because of ERC Chart runtime architecture rather than because the indicator's mathematics require it, that code belongs in the SDK or host, not in the indicator.

Indicator authors should not need to understand or manually manage:

- plot IDs;
- drawing IDs;
- input keys;
- TA kernel IDs;
- call-order stability;
- worker generations;
- source revisions;
- history replay;
- provisional/building-bar rollback;
- finalization bookkeeping;
- drawing reconciliation;
- overlay retention;
- signal deduplication;
- signal event IDs;
- lookahead prevention;
- warm-up readiness;
- timeframe aggregation;
- provider capability validation;
- Heikin Ashi state;
- cache invalidation;
- performance optimizations;
- O(1) rolling-window implementation;
- stale configuration migration;
- validation of persisted settings;
- renderer-specific coordinates or KLineCharts APIs;
- worker transport contracts;
- recovery from corrected historical candles.

### 2.2 Target mental model

A beginner should be able to read an indicator from top to bottom:

```ts
const length = input.int(14, "Length");
const source = input.source(price.close, "Source");

const fast = ta.ema(9, source);
const slow = ta.ema(21, source);

const buy = ta.crossover(fast, slow);
const sell = ta.crossunder(fast, slow);

plot.line(fast, color.green);
plot.line(slow, color.red);

plot.shape(buy, {
  shape: shape.labelUp,
  location: location.belowBar,
  text: "BUY",
  textSize: textSize.small,
  color: color.green,
  textColor: color.white,
});

plot.shape(sell, {
  shape: shape.labelDown,
  location: location.aboveBar,
  text: "SELL",
  textSize: textSize.small,
  color: color.red,
  textColor: color.white,
});

signal(buy, signal.long);
signal(sell, signal.short);
```

That is the target, not an illustrative convenience wrapper over a complicated author-facing runtime.

---

## 3. Why the current SDK must change

The current SDK is fundamentally execution-order based. Inputs, TA kernels, plots, and signals consume incremental indices during each calculation pass. The runtime then verifies that declarations execute in the same order on every bar.

That model creates restrictions such as:

- TA and plot calls must remain in stable order;
- conditional plot calls are unsafe or rejected;
- explicit drawing IDs are required;
- authors must understand finalized/building behavior for complex state;
- source history is often represented as manually maintained arrays;
- runtime implementation details leak into example indicators.

Those restrictions are acceptable for a low-level library, but they are incompatible with the target beginner/pseudocode authoring experience.

The redesign therefore moves from **execution-order identity** to **compiler-generated call-site identity plus host-managed object/state identity**.

---

## 4. Target architecture

```text
Indicator Source Code
      │
      ▼
Authoring Compiler / Transform
  - stable hidden call-site IDs
  - close[1] history transform
  - overload canonicalization when required
  - input identity generation
  - diagnostic source mapping
      │
      ▼
Public Indicator SDK v2
  - input.*
  - price/OHLC series
  - ta.*
  - plot.*
  - signal()
  - indicator.* source controls
      │
      ▼
Indicator Source Engine
  - provider capability resolution
  - native/derived timeframe selection
  - shared source cache
  - candle transformation
  - confirmation state
  - correction/rebuild invalidation
      │
      ▼
Stateful Execution Engine
  - committed/provisional state
  - history access
  - rolling TA kernels
  - drawing object lifecycle
  - signal lifecycle
  - incremental execution
      │
      ▼
Indicator Worker / Contracts
  - bounded validated snapshots/deltas
  - revisions/generations
  - isolation and budgets
      │
      ▼
Renderer / KLineCharts Adapter
  - plots
  - markers/text
  - boxes/segments
  - no SDK/runtime objects exposed
```

### 4.1 Architectural boundary

The authoring compiler and SDK provide syntax and semantics.

The source engine provides correct market/synthetic data.

The execution engine provides state, lifecycle, rollback, and performance.

The worker provides isolation and transport safety.

The renderer provides visualization only.

These responsibilities must remain separate even when the public API makes them appear seamless.

---

## 5. Authoring compiler

### 5.1 Why a compiler/transform is required

Normal JavaScript numbers cannot safely provide Pine-style history indexing while also behaving exactly like primitive numbers.

For example, a boxed or proxied `close` value that supports:

```ts
close[1]
```

would create surprising behavior with operations such as:

```ts
close + 10
Number.isFinite(close)
Math.abs(close)
typeof close
```

The preferred design is therefore a build-time authoring transform.

The developer writes:

```ts
const rising = close > close[1];
```

The compiler lowers the historical access to the runtime's canonical series-history operation while preserving normal scalar behavior for the current value.

### 5.2 Compiler responsibilities

The compiler may inject or normalize:

- hidden call-site IDs for inputs, TA operations, plots, drawings, and signals;
- stable input persistence identities;
- `close[n]`, `open[n]`, `high[n]`, `low[n]`, and other series access;
- canonical overload representation where runtime ambiguity exists;
- source metadata for runtime diagnostics;
- conditional call identities so calls do not depend on execution order.

The compiler must not change trading logic.

### 5.3 Stable identity requirements

Hidden identities must survive normal edits that do not semantically replace the declaration where practical.

For named inputs, the declared variable name may contribute to persistence identity:

```ts
const period = input.int(14, "Period");
```

For anonymous plot/drawing calls, the compiler should use deterministic source/call-site identity rather than a developer-visible string.

Changing source location alone must not silently bind an old persisted input to an unrelated new declaration. The exact identity algorithm must be covered by compiler tests and documented for SDK maintainers, even though it remains invisible to indicator authors.

---

## 6. Series and historical values

### 6.1 Preferred syntax

Historical values should support Pine-like indexing:

```ts
close[0]
close[1]
close[2]
open[1]
high[3]
low[2]
volume[5]
```

### 6.2 Alternative access paths

Multiple ways to express the same operation are intentionally allowed where they improve discoverability:

```ts
close[1]
history(close, 1)
close.at(1)
```

All forms must resolve to the same source/history engine and produce identical results.

### 6.3 Availability semantics

When history is unavailable because the requested offset predates loaded/warm-up history, the SDK returns an unavailable numeric state that TA/plot/signal helpers understand safely.

Authors should not need repetitive defensive code around warm-up values.

Plots treat unavailable/non-finite values as hidden for that bar.

Signals treat unavailable dependencies as false/not-ready unless an advanced future API explicitly requests another policy.

---

## 7. Technical-analysis API

### 7.1 Namespace

All technical-analysis functions belong under `ta`.

Examples:

```ts
ta.sma(20)
ta.ema(20)
ta.wma(20)
ta.rma(20)
ta.atr(14)
ta.rsi(14)
ta.adx(14)
ta.dmi(14)
ta.highest(20)
ta.lowest(20)
ta.crossover(fast, slow)
ta.crossunder(fast, slow)
```

There should not be a separate `ma.*` public namespace for moving averages.

### 7.2 Overloads

The SDK should intentionally provide multiple beginner-friendly forms over one canonical internal implementation.

Examples:

```ts
ta.ema(20)                 // close, active indicator timeframe
ta.ema(close, 20)
ta.ema(20, close)

ta.rsi(14)
ta.rsi(open, 14)
ta.rsi(14, open)

ta.highest(20)             // high by default
ta.highest(close, 20)

ta.ema(20, "1h")
ta.ema(close, 20, "1h")
```

Where two numeric runtime arguments would otherwise be ambiguous, the compiler should canonicalize the author's intended overload before runtime execution.

### 7.3 Performance contract

The SDK should choose efficient stateful algorithms automatically.

Expected steady-state behavior:

- SMA/EMA/RMA/RSI/ATR/crossover: O(1) per live update where mathematically possible;
- highest/lowest: amortized O(1) with monotonic/bounded data structures where appropriate;
- initial history: O(N) or the algorithmically appropriate cost;
- corrected history or changed configuration: rebuild only the correctness-relevant range where practical.

The author never selects the optimization strategy.

---

## 8. Inputs

### 8.1 Beginner-facing API

Examples:

```ts
const length = input.int(14, "Length");
const multiplier = input.float(1.5, "Multiplier");
const enabled = input.bool(true, "Enabled");
const source = input.source(price.close, "Source");
const mode = input.enum("Original", ["Original", "Zero Lag"], "Mode");
const tf = input.timeframe(timeframe.chart, "Timeframe");
const candleMode = input.candleType(candle.standard, "Candle Type");
const lineColor = input.color(color.green, "Color");
```

Advanced options may still exist, but ordinary indicators should not need verbose configuration objects for common cases.

### 8.2 Hidden persistence keys

Authors should not write storage keys such as:

```ts
key: "ropePeriod"
```

The compiler/runtime owns stable input identity.

### 8.3 Host-normalized configuration

The host handles:

- missing values;
- stale removed values;
- wrong primitive types;
- unsupported enum values;
- numeric clamping;
- numeric step rounding;
- provider-dependent timeframe availability;
- safe fallback behavior;
- persisted configuration migration when the declaration identity remains compatible.

Invalid persisted settings should not require author-written migration code for ordinary cases.

---

## 9. Common constants and enums

Generic concepts belong in SDK namespaces.

Examples:

```ts
price.close
price.open
price.high
price.low
price.hl2
price.hlc3
price.ohlc4

line.solid
line.dashed
line.dotted

direction.up
direction.down
direction.flat

shape.circle
shape.triangleUp
shape.triangleDown
shape.labelUp
shape.labelDown

location.aboveBar
location.belowBar
location.absolute

textSize.tiny
textSize.small
textSize.normal
textSize.large
textSize.xlarge

color.red
color.green
color.yellow
color.white
color.black
color.alpha(base, opacity)
color.rgb(r, g, b)
```

Indicator-domain options do **not** belong in the global SDK.

Examples that stay inside ATR Rope/UT Bot:

- Rope modes;
- UT Bot modes;
- MG/Win follow modes;
- POC band-merge policy;
- POC suppression modes;
- indicator-specific draw modes.

The SDK provides the generic enum/input mechanism, not strategy-specific vocabulary.

---

## 10. Plot API

### 10.1 Scalar plots

The normal API should remain direct:

```ts
plot.line(ema)
plot.line(ema, color.green)
plot.histogram(volume)
plot.hline(50)
```

Plot identities are generated internally.

Conditional plotting must be legal:

```ts
if (showTrend) {
  plot.line(trend);
}
```

The author must not know about declaration-order restrictions.

### 10.2 Shapes and text

`plot.shape()` must support marker type, location, text, text color, and text size.

```ts
plot.shape(buy, {
  shape: shape.labelUp,
  location: location.belowBar,
  color: color.green,
  text: "BUY",
  textColor: color.white,
  textSize: textSize.small,
});
```

Simple overloads may be provided:

```ts
plot.shape(buy, "BUY");
plot.shape(buy, shape.labelUp, "BUY");
```

Renderer-specific font units, DPI scaling, vertical padding, and text metrics remain host concerns.

---

## 11. Persistent drawings

### 11.1 No author-created IDs

The author must never write:

```ts
id: `poc-${zone.id}`
```

for SDK plot/drawing identity.

The host owns identity.

### 11.2 Handle-based lifecycle

Preferred model:

```ts
const zone = plot.box({
  left: start,
  right: time,
  top,
  bottom,
  color: color.alpha(color.yellow, 0.25),
});

zone.right = time;
zone.top = newTop;
zone.delete();
```

Equivalent method-based setters may be used internally or exposed if they provide safer semantics, but the public model should remain object-like and beginner-friendly.

`plot.segment()` follows the same rule.

### 11.3 SDK responsibilities

The drawing engine owns:

- hidden IDs;
- object persistence;
- property updates;
- deletion;
- committed/provisional copies;
- building-bar rollback;
- history replay coalescing;
- renderer synchronization;
- retention limits;
- stale object cleanup;
- output-size limits.

There should be no normal author-facing `plot.drawings()`, `plot.sync()`, overlay arrays, or reconciliation scopes.

---

## 12. Indicator data source model

### 12.1 Source identity

An indicator data source is conceptually:

```ts
interface IndicatorSourceKey {
  providerProfileId: string;
  instrumentId: string;
  timeframeId: string;
  candleType: CandleType;
}
```

The public authoring API does not expose this transport shape directly.

### 12.2 Whole-indicator timeframe

```ts
const tf = input.timeframe(timeframe.chart, "Timeframe");
indicator.timeframe(tf);
```

If the chart is 5m and `tf` is 1h, the entire indicator calculates on the 1h source while remaining visually attached to the current chart.

The author does not aggregate or align candles.

### 12.3 Per-TA timeframe

```ts
const fast = ta.ema(9);
const trend = ta.ema(200, "1h");
```

This creates two source dependencies internally.

The runtime must support multiple synchronized sources per indicator.

---

## 13. Provider-driven timeframe capabilities

### 13.1 No universal hard-coded selectable timeframe list

The SDK may expose constants for convenience, but the actual selectable timeframes come from the active workspace provider and the data service's safe derivation rules.

For example, a provider may natively support only 1m and 5m. ERC Chart may safely derive 2m, 3m, 4m, 10m, and other aligned multiples from a lower native source when the capability metadata allows it.

Another provider may expose a different set.

Therefore:

```ts
input.timeframe(timeframe.chart, "Timeframe")
```

must ask the host for the **effective timeframe capability set** rather than embedding static options in the indicator package.

### 13.2 Effective timeframe resolver

The resolver combines:

- active workspace provider profile;
- instrument;
- provider native timeframes;
- provider-declared derived timeframes;
- safe host derivation rules;
- bar alignment/session information;
- historical availability;
- live availability.

This resolver is the single source of truth for:

- chart timeframe selector;
- indicator timeframe selector;
- `input.timeframe()`;
- MTF `ta.*` calls;
- source creation;
- persisted timeframe validation.

### 13.3 Saved unavailable timeframe

Persistence should store the requested preference separately from the resolved active source.

If a saved 3m preference becomes unavailable after provider switching:

1. preserve the preference when practical;
2. resolve the active indicator to `timeframe.chart` or another explicitly documented safe fallback;
3. show a non-blocking user notice;
4. automatically restore the requested timeframe if it later becomes valid again and product UX approves automatic restoration.

The indicator author writes no fallback code.

---

## 14. Candle types and transformations

### 14.1 Public API

```ts
const candleMode = input.candleType(candle.standard, "Candle Type");
indicator.candleType(candleMode);
```

Initial required values:

```ts
candle.standard
candle.heikinAshi
```

Additional synthetic candle types are added only after their semantics are explicitly designed and tested.

### 14.2 Processing order

Correct order:

```text
provider/raw source
    ↓
target timeframe construction
    ↓
standard OHLC candles
    ↓
candle transformation
    ↓
indicator OHLC series
    ↓
TA / signals / plots
```

For example, 1h Heikin Ashi means:

1. construct correct 1h standard candles;
2. transform those 1h candles into Heikin Ashi;
3. calculate indicator logic.

Do not transform a lower timeframe to Heikin Ashi first and then aggregate unless a future candle type explicitly defines that behavior.

### 14.3 Heikin Ashi state

The transformer maintains committed/provisional recursive state.

Building updates always derive from the last finalized Heikin Ashi state and the current raw building candle. Repeated building updates must not compound provisional values.

### 14.4 Synthetic provenance

Signals and diagnostics should internally retain source provenance identifying synthetic candle calculations. A Heikin Ashi close must not be confused with the market's traded close in downstream systems.

---

## 15. Signal engine

### 15.1 Beginner API

```ts
signal(buyCondition, signal.long);
signal(sellCondition, signal.short);
```

The author should not generate event IDs or implement deduplication.

### 15.2 Platform guarantees

The SDK/runtime guarantees:

- no future-candle access;
- no lookahead bias by default;
- finalized/provisional separation;
- correct building-bar rollback;
- no duplicate events from repeated recalculation;
- warm-up suppression when dependencies are unavailable;
- stable cross semantics;
- historical replay/live parity;
- correct timeframe confirmation;
- source revision tracking;
- synthetic-source provenance;
- correction invalidation;
- bounded retention;
- hidden event identity.

### 15.3 Higher-timeframe confirmation

If the chart is 5m and the indicator source is 1h, finalizing a 5m bar does **not** finalize the 1h signal source.

Signal finalization is always tied to the source candle that produced the signal.

### 15.4 MTF lookahead rule

A higher-timeframe value may be provisional while its source candle is open. Finalized/actionable signal reads must never treat that provisional value as finalized.

Normal beginner APIs do not expose `lookahead: true`.

---

## 16. Stateful execution engine

The execution engine owns two layers of state:

```text
committed state
provisional current-bar state
```

Every building update starts from committed state.

Finalization promotes valid provisional state to committed state.

This applies to:

- historical series;
- TA kernels;
- Heikin Ashi transforms;
- persistent drawings;
- signals;
- indicator variables/state helpers;
- cross/time-series operations.

Complex indicators should not need copy-on-write helper functions solely to survive building-bar rollback.

A future/public state helper may support natural mutable code while the runtime snapshots or journals changes internally.

---

## 17. Error and safety policy

The author should not write routine error handling.

### 17.1 Host-recoverable conditions

The host should normalize/recover from:

- stale settings;
- missing settings;
- invalid persisted enums;
- invalid numeric bounds;
- unavailable provider timeframe preference;
- warm-up values;
- drawing retention pressure;
- incremental source reconnect/rebuild;
- corrected history requiring recalculation.

### 17.2 Genuine programming failures

The host must not silently convert genuine indicator logic bugs into incorrect calculations.

Examples:

- invalid source type;
- illegal recursive dependency;
- unsupported circular indicator dependency;
- runaway object creation beyond platform safety limits;
- non-terminating/excessive worker execution;
- invalid compiler transform assumptions.

These should disable/isolate the affected indicator instance and present a useful Developer Mode diagnostic with source location when possible.

The indicator author still does not write `try/catch` around ordinary SDK calls.

---

## 18. Runtime/worker contract

The existing worker/snapshot model remains useful and should be evolved rather than discarded without evidence.

The runtime boundary should continue to provide:

- plugin isolation;
- validated payloads;
- bounded points/overlays/signals;
- source/data revision checks;
- calculation generation checks;
- worker startup/update budgets;
- stale result rejection;
- deterministic disposal/rebuild.

The new authoring objects such as drawing handles remain inside the SDK/runtime. They do not cross the worker boundary. The worker emits plain validated runtime geometry/events.

---

## 19. Renderer contract

The renderer should remain unaware of beginner authoring abstractions.

It receives normalized runtime outputs and maps them to KLineCharts.

Required rendering additions include:

- shape type;
- marker location;
- marker text;
- text color;
- text size;
- box/segment updates from persistent drawing objects;
- correct mapping of MTF outputs to visible chart timestamps.

The renderer owns:

- actual pixel/DPI sizing;
- KLineCharts figure/overlay registration;
- visual alignment;
- chart refresh scheduling.

Indicator code never receives KLineCharts objects.

---

## 20. Source sharing and caching

Equivalent source requests should share upstream work.

Example:

```text
EURUSD native 1m
    ↓
shared derived 5m
    ├── Indicator A
    ├── Indicator B
    └── shared 5m Heikin Ashi
            └── Indicator C
```

A shared source may feed many indicators while each indicator retains independent TA/state/drawing/signal state.

Cache/source keys must include enough identity to prevent accidental cross-provider or cross-candle-type reuse.

---

## 21. Existing indicator migration policy

Legacy source compatibility is explicitly out of scope.

After SDK v2 reaches its acceptance gates:

1. remove/rewrite current indicator examples and built-ins against SDK v2;
2. treat each rewrite as a semantic port of the indicator mathematics, not a source migration exercise;
3. compare finalized outputs/signals against trusted fixtures or the current implementation where appropriate;
4. delete obsolete v1-only helpers/contracts after the last host dependency is gone;
5. update indicator-author documentation to SDK v2 only.

The ATR Rope + UT Bot indicator should become a flagship proof that complex logic can remain readable while source/runtime plumbing disappears.

---

## 22. Example target: ATR Rope + UT Bot style

The final file does not need to be as short as a trivial EMA indicator because its trading logic is genuinely complex. The goal is that its complexity comes from ATR Rope, UT Bot, POC migration, suppression, and signal rules—not framework plumbing.

A representative section should look like:

```ts
const tf = input.timeframe(timeframe.chart, "Timeframe");
const candleMode = input.candleType(candle.standard, "Candle Type");
const ropePeriod = input.int(14, "ATR Period");
const ropeMultiplier = input.float(1.5, "ATR Multiplier");

indicator.timeframe(tf);
indicator.candleType(candleMode);

const atr = ta.atr(ropePeriod);
const source = close;

const rope = calculateRope(source, atr, ropeMultiplier);

plot.line(rope.value, {
  color: rope.direction > 0 ? color.green : rope.direction < 0 ? color.red : color.gray,
});

if (buyCondition) {
  plot.shape(true, {
    shape: shape.labelUp,
    location: location.belowBar,
    text: "BUY",
    textSize: textSize.small,
    color: color.green,
  });
}

signal(buyCondition, signal.long);
```

POC boxes should be managed through drawing handles, not arrays of runtime overlays or explicit IDs.

---

## 23. Non-goals

This redesign does not by itself require:

- a new chart engine;
- exposing provider APIs directly to indicator authors;
- exposing workers to indicator authors;
- adding a remote indicator marketplace;
- supporting arbitrary code execution during plugin install;
- preserving v1 indicator source compatibility;
- adding unsafe lookahead modes;
- adding every synthetic candle type immediately;
- guaranteeing O(1) complexity for mathematically non-O(1) algorithms;
- hiding genuine indicator programming bugs by returning plausible fake values.

---

## 24. Acceptance criteria

SDK v2 is not considered complete until all of the following are true.

### Author experience

- A simple moving-average crossover indicator can be written without runtime/context objects, explicit IDs, persistence keys, history arrays, lifecycle flags, or error handling.
- `close[1]` works and matches `history(close, 1)` and `close.at(1)`.
- TA functions are under `ta.*` and support the documented overloads.
- Conditional plots/drawings/signals work without execution-order errors.
- `plot.shape()` supports text and text-size constants.
- drawing IDs are invisible to authors.

### Data-source correctness

- indicator timeframe can differ from chart timeframe;
- per-TA timeframe overrides work;
- only provider-native or safely derivable timeframes are offered;
- provider changes invalidate/re-resolve sources correctly;
- lower-timeframe requests fetch a separate source when available rather than deriving impossible detail from a higher chart timeframe;
- Heikin Ashi is transformed after target timeframe construction;
- source sharing avoids duplicate subscriptions/aggregation.

### Signal correctness

- no finalized signal uses future or unconfirmed higher-timeframe data;
- building updates roll back cleanly;
- replay and incremental finalized signals match;
- warm-up does not create spurious signals;
- repeated building updates do not duplicate finalized signals;
- corrected history invalidates affected downstream signals.

### Performance and resilience

- core TA and source transforms use incremental algorithms where possible;
- worker limits remain enforced;
- stale revisions/generations are rejected;
- large history remains bounded by product limits;
- renderer receives deltas/snapshots without authoring objects leaking across the boundary.

### Migration

- all maintained indicators are rewritten against SDK v2;
- v1-only authoring helpers are removed after host cutover;
- SDK v2 author documentation and examples become the only supported authoring reference.

---

## 25. Progress principles

During implementation, use this document to challenge every new API with four questions:

1. **Does the indicator author need to know this?** If not, move it down a layer.
2. **Is this trading logic or framework plumbing?** Framework plumbing belongs in ERC Chart.
3. **Can the SDK make the safe/correct behavior automatic?** Prefer automatic safe behavior over configuration.
4. **Would a non-programmer understand the resulting indicator code?** If not, reconsider the public API even if the implementation is technically elegant.

The implementation plan in `docs/superpowers/plans/2026-09-09-indicator-sdk-v2-redesign-implementation.md` turns this design into tracked tasks and verification gates.
