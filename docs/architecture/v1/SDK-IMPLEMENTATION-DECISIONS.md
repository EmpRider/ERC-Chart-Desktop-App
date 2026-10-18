# ERC-chart SDK Implementation Decisions

Version: 1.0 draft
Date: 2026-09-01
Status: Accepted implementation guidance
Owner: EmpRider

## Purpose

This document records the concrete SDK and indicator-runtime decisions agreed during the 2026-08-31 / 2026-09-01 design discussion. It is intended to be read before implementing the indicator SDK/runtime and before expanding the provider/runtime interfaces that serve indicator data.

This is not sample-only guidance. Unless superseded by a later ADR, the behavior described here is the implementation target.

## 1. Product-level decisions

1. Providers and indicators are separate installable plugin kinds.
2. Provider configuration and indicator configuration are dynamic and can be changed from the application UI.
3. klinecharts is the charting library and owns chart drawing and native technical-indicator presentation behavior where possible.
4. ERC-chart owns provider integration, market-data state, plugin lifecycle, SDK authoring APIs, indicator dependency/data acquisition, signal semantics, and the bridge between runtime results and klinecharts.
5. Indicator authors must receive a clean domain API. Internal runtime objects such as `ctx`, transport envelopes, MessagePorts, cache handles, provider profiles, and klinecharts instances are never exposed to plugin authors.
6. `ta.*` helper calls are declarative from the author's point of view. The runtime is responsible for discovering, loading, updating, caching, and subscribing to the required data silently.
7. Indicator parameter/style changes made through the klinecharts indicator settings UI are first-class configuration changes and must be synchronized back into ERC-chart runtime state.

## 2. Clean public indicator API

### 2.1 Do not expose runtime context

Internal implementation may use a context object, for example:

```ts
const rsi = ctx.ta.rsi(ctx.series.close, 14);
```

That shape must never be the public authoring API.

The public authoring form is:

```ts
const rsi = ta.rsi(14, close);
```

The SDK should make common series identifiers directly available in the indicator authoring scope, including at minimum:

```ts
open;
high;
low;
close;
volume;
hl2;
hlc3;
ohlc4;
```

Where a provider does not supply an optional field such as volume, the SDK must expose the absence deterministically rather than silently fabricate data.

### 2.2 Overloads and named-parameter style

Technical-analysis helpers should support concise overloads for common cases and an object form for explicit configuration.

Example RSI API:

```ts
ta.rsi(14); // length 14, default value = close, current chart timeframe
ta.rsi(14, open); // length 14, explicit source = open, current chart timeframe
ta.rsi(14, "1h"); // length 14, default source = close, explicit timeframe
ta.rsi(14, open, "1h");

ta.rsi({
  length: 14,
  value: open,
  tf: "1h",
});
```

The object form acts as named parameters and is the extensibility path when a TA function needs additional options.

Equivalent overload design should be used across the built-in `ta.*` function family where it remains unambiguous.

### 2.3 Defaults

Unless a function specifically documents another default:

- omitted value/source means `close`;
- omitted timeframe means the chart's active timeframe;
- omitted provider/symbol means the chart's current provider profile and instrument;
- values are read from the runtime-owned canonical series, not copied from renderer internals.

### 2.4 Stable semantics over implementation details

Indicator code must not depend on:

- how ERC-chart caches candles;
- whether data arrived from cache, history API, aggregation, or live feed;
- which process owns the provider connection;
- how klinecharts stores or calculates a native indicator;
- runtime generation/revision IDs;
- transport batching or worker messages.

Those are implementation details behind the SDK.

## 3. `ta.*` request model

### 3.1 Each call is a dependency declaration

A call such as:

```ts
const rsi1h = ta.rsi(14, "1h");
```

means the indicator instance depends on:

- the same instrument/provider profile as the host chart unless explicitly changed by a future supported API;
- a `1h` candle series;
- enough historical bars to calculate RSI(14) correctly;
- continued updates when the `1h` building/finalized bar changes.

The plugin author does not manually request history, subscribe to feeds, perform timeframe aggregation, maintain cache state, or issue retries.

### 3.2 Independent, incremental, silent handling

Every distinct `ta.*` dependency must be handled independently and incrementally by the runtime.

"Independently" means one dependency can load, fail, reconnect, or update without forcing unrelated dependencies to restart.

"Incrementally" means the runtime should not recalculate or retransmit a complete historical dataset when a bounded delta is sufficient. Initial history may be a snapshot; subsequent work should prefer building-bar replacement, finalized-bar append, tick delta, or the smallest safe recalculation window.

"Silently" means the plugin author does not write plumbing code for data acquisition or synchronization. Errors that affect correctness still surface through stable SDK/runtime diagnostics; they are simply not exposed as provider/network implementation chores.

### 3.3 Dependency identity and deduplication

The runtime should canonicalize equivalent requests into a dependency key conceptually containing:

```ts
{
  (providerProfileId,
    instrumentId,
    timeframeId,
    source,
    functionId,
    normalizedParameters);
}
```

Equivalent dependencies requested by one or more indicator instances should share upstream market-data subscriptions and cached series when safe. Indicator calculation state remains isolated per active indicator instance unless an explicitly shared pure calculation cache is later introduced.

### 3.4 Historical requirement discovery

Each built-in TA function must declare or derive its warm-up/history requirement. The runtime uses that requirement to request enough bars for a correct first result.

Nested calculations compose requirements. The plugin should not need to manually state `load 200 bars` merely because it calls a function whose lookback can be inferred.

Dynamic or unbounded lookbacks must be rejected, capped, or explicitly declared so the runtime can preserve the 100,000-candle and execution-budget limits.

### 3.5 Incremental complexity contract

After warm-up, ordinary building-bar replacement and finalized-bar append updates must not scan the complete source series. The initial built-in family has these required bounds:

| Helper                           | Required steady-state update bound | Required retained state                                       |
| -------------------------------- | ---------------------------------: | ------------------------------------------------------------- |
| `ta.sma`                         |                               O(1) | bounded ring buffer and rolling sum                           |
| `ta.ema`                         |                               O(1) | previous committed EMA and provisional current value          |
| `ta.rsi`                         |                               O(1) | Wilder average gain/loss state plus provisional current value |
| `ta.atr`                         |                               O(1) | previous close and Wilder true-range average state            |
| `ta.highest` / `ta.lowest`       |                     amortized O(1) | monotonic deque bounded by the lookback                       |
| `ta.crossover` / `ta.crossunder` |                               O(1) | previous and current pair of values                           |

`last(dependency, n)` is O(n) in the explicitly requested result count, never O(total candle history). Obtaining the latest value is O(1).

The accepted non-steady-state exceptions are:

- initial history/warm-up is O(N);
- a calculation-affecting parameter, source, instrument, provider profile, or timeframe change may rebuild from available history in O(N);
- a historical correction or gap repair is O(dirty range) from the earliest correctness-relevant index or a safe checkpoint;
- serialization or diagnostics may inspect a bounded snapshot when explicitly requested, but ordinary signal evaluation may not do so.

Mutable building-bar calculations must use provisional state derived from the last committed finalized-bar state. Replacing the same building bar must not repeatedly compound provisional values into committed rolling state. Finalization atomically promotes the provisional result/state once, and then starts the next provisional point.

## 4. Multi-timeframe behavior

### 4.1 Provider capability remains authoritative

A requested timeframe must be resolved against provider-declared capabilities.

Resolution order:

1. use a provider-native timeframe when available;
2. otherwise use ERC-chart aggregation only when the provider contract declares a safe derivation source and bar-alignment metadata;
3. otherwise reject the dependency with a stable unsupported-timeframe error.

The indicator SDK must never invent a global timeframe list.

### 4.2 No chart-switch side effects

Requesting another timeframe from indicator code must not change the visible chart timeframe.

For example:

```ts
const trend = ta.ema(50, "4h");
```

creates a background `4h` data dependency while the chart may remain on `5m`.

### 4.3 Incremental MTF updates

When lower-level live data changes, derived higher-timeframe series should update only the affected building bar. When the aggregation boundary closes, finalize the old bar and append/start the next building bar deterministically.

## 5. Relationship with klinecharts

### 5.1 Responsibility split

klinecharts owns:

- chart rendering;
- pane/layout mechanics;
- native technical-indicator calculation scheduling/result storage for indicators registered with it;
- native technical-indicator drawing behavior;
- native indicator parameter/style settings UI when used;
- visual invalidation/redraw behavior.

ERC-chart owns:

- installable provider and indicator plugins;
- provider profiles and dynamic provider configuration;
- market-data acquisition and canonical series state;
- `ta.*` authoring API;
- the Pine-like semantics, state machines, warm-up rules, and complexity guarantees of the public `ta.*` family;
- indicator lifecycle and dependency discovery;
- multi-timeframe resolution;
- incremental data scheduling;
- cross-indicator dependencies;
- signal candidates;
- persistence of ERC-chart-owned indicator configuration;
- validation, isolation, budgets, revision/generation correctness;
- translation between SDK/runtime outputs and klinecharts indicator/overlay APIs.

### 5.2 Do not duplicate klinecharts work

If klinecharts already provides an appropriate technical-indicator calculation/presentation path, ERC-chart should integrate it rather than rebuilding the visual machinery.

ERC-chart may still provide a stable `ta.*` authoring facade. The facade is not permission for plugin code to receive a raw klinecharts instance.

ERC-chart may reuse a vetted pure calculation primitive internally, including one supplied by klinecharts, only behind the ERC-chart TA contract. klinecharts does not provide the public composable Pine-like dependency engine, multi-timeframe resolution, signal-tail access, or steady-state complexity contract. Those remain ERC-chart responsibilities.

### 5.3 Pinned klinecharts result bridge

The renderer adapter, not indicator or signal plugin code, owns access to calculated klinecharts indicator results. For the pinned `klinecharts` 10.0.3 integration it must:

1. retain the value returned by `createIndicator` as the chart-local indicator identity;
2. resolve the corresponding indicator through `getIndicators({ id })` only after creation/recalculation has completed;
3. treat `indicator.result` as untrusted dependency output and normalize it into ERC-chart `IndicatorResultPoint` records;
4. correlate every point with the canonical candle timestamp and data revision;
5. publish the normalized result through a bounded result store rather than exposing the klinecharts object;
6. discard callbacks/results for a stale chart instance, data revision, or configuration generation.

The adapter must not infer the result layout from the klinecharts major version. A pinned compatibility fixture records the observed 10.0.3 layout. Runtime validation supports the observed indexed-array layout and may accept a timestamp-keyed record only through an explicit tested compatibility adapter. Any unknown layout fails closed with `KLINE_INDICATOR_RESULT_INCOMPATIBLE`; it must not silently return mismatched values.

Index correlation is permitted only when the result length/order is validated against the canonical candle list used for that calculation. Timestamp correlation is authoritative when timestamps are present. A missing warm-up value is represented as `null`, not by shifting later values to an earlier candle.

klinecharts does not expose a universal `getIndicatorDataValues()` API, so this bridge is the single internal compatibility boundary. Upgrading klinecharts requires rerunning its result-layout, recalculation-readiness, settings-override, and stale-callback contract fixtures before changing the pin.

### 5.4 Settings synchronization

klinecharts allows users to edit indicator parameters and styles through its indicator settings UI. Those changes must be treated as real ERC-chart indicator configuration changes.

Examples include:

- RSI length;
- moving-average periods;
- source/value selection where supported;
- line color;
- line width/style;
- plot visibility;
- pane/presentation options exposed by ERC-chart.

Required flow:

```text
User opens the ERC-chart/klinecharts settings surface
        ↓
ERC-chart settings controller owns Save/apply
        ↓
controller validates and normalizes the proposed configuration
        ↓
ERC-chart updates the indicator-instance configuration model
        ↓
calculation-affecting changes increment configuration generation
        ↓
runtime invalidates stale results and recalculates only what is required
        ↓
style-only changes update presentation without unnecessary data reload/recalculation
        ↓
workspace autosave persists the ERC-chart-owned configuration
```

The implementation may use klinecharts UI components or feature-click notifications to open the settings surface, and it applies presentation changes with APIs such as `overrideIndicator`. It must not depend on a generic "settings committed" event unless that event is verified in the pinned core API and covered by a compatibility test. ERC-chart's settings controller is the transaction owner.

The klinecharts object must not become the sole persisted source of truth. ERC-chart persists a normalized, versioned representation so workspace restore is independent of ephemeral chart instances.

### 5.5 Configuration classification

Configuration fields should be classified as either:

- **calculation-affecting** — length, source, timeframe, algorithm option, dependency binding, etc.; or
- **presentation-only** — color, width, line style, visibility, label formatting, etc.

Calculation-affecting changes must invalidate results produced under the previous configuration generation. Presentation-only changes should not trigger provider requests or TA recalculation unless klinecharts itself requires a harmless redraw.

## 6. Dynamic provider configuration

Provider configuration is not install-time-only metadata.

The UI may change provider profile values after installation. The runtime must distinguish:

- credentials/secrets;
- connection fields;
- endpoint/environment fields;
- provider-declared optional settings;
- capability-affecting settings.

A provider configuration change must produce a controlled state transition rather than mutating a live adapter unpredictably. Depending on the changed field, this may mean reconnecting/restarting the provider utility process, refreshing instruments/capabilities, invalidating affected market-data dependencies, and resubscribing active chart/indicator consumers.

Secrets remain in Windows Credential Manager and never enter workspace/plugin configuration documents.

## 7. Indicator plugin configuration

Indicator definitions declare configurable inputs with defaults, types, labels, validation constraints, and whether a field affects calculation or presentation.

The runtime owns an `IndicatorInstanceConfig` concept separate from immutable plugin definition metadata.

Conceptual shape:

```ts
interface IndicatorInstanceConfig {
  instanceId: string;
  indicatorId: string;
  inputs: Record<string, boolean | number | string>;
  style: Record<string, unknown>;
  bindings: Record<string, unknown>;
  visible: boolean;
  pane?: string;
}
```

The exact persisted TypeScript contract is implemented under the versioned indicator/workspace schemas; this example freezes intent, not field spelling.

Changes may originate from:

- ERC-chart indicator settings UI;
- klinecharts native indicator settings UI;
- workspace restore;
- plugin defaults during first creation.

All paths must converge on the same validated runtime configuration model.

## 8. Cross-indicator dependencies

Existing requirements for explicit cross-indicator bindings remain valid.

A `ta.*` helper is not an implicit reference to another visible indicator instance. Built-in technical-analysis calls calculate from canonical market series unless a future API explicitly accepts an indicator-output binding.

When an indicator consumes another indicator's published output, ERC-chart must preserve explicit instance/output identity, dependency-DAG validation, cycle rejection, revision propagation, and deterministic update order.

## 9. Worker/runtime model

The public API may look synchronous and expression-oriented, but runtime execution remains isolated.

Implementation can compile/transform author code, inject safe SDK bindings, or represent `ta.*` operations as an internal dependency graph. The implementation technique is intentionally private.

Required properties are:

- no raw `ctx` exposure;
- no renderer/klinecharts object exposure;
- no provider adapter exposure;
- no filesystem/process/Electron access;
- deterministic versioned inputs;
- bounded CPU/memory/output use;
- stale-generation rejection;
- local failure containment;
- incremental updates where safe.

## 10. Example authoring model

A future indicator should be able to resemble:

```ts
indicator({
  id: "example.momentum",
  name: "Momentum Example",
  inputs: {
    rsiLength: input.number(14, { min: 2, max: 200 }),
    trendLength: input.number(50, { min: 2, max: 500 }),
    trendTf: input.timeframe("1h"),
  },
  calculate({ rsiLength, trendLength, trendTf }) {
    const rsi = ta.rsi(rsiLength);
    const trend = ta.ema({
      length: trendLength,
      value: close,
      tf: trendTf,
    });

    plot.line("rsi", rsi);
    plot.line("trend", trend);
  },
});
```

This is illustrative syntax. The frozen behavior is that author code is concise, context-free, and declarative while ERC-chart handles dependencies and data plumbing.

## 11. Implementation requirements

### SDK

- expose clean series aliases and `ta.*` helpers;
- define overloads plus object/named-parameter forms;
- generate TypeScript types and documentation from one canonical function signature registry where practical;
- ensure runtime-only context types are not exported from the public package entry point;
- provide contract fixtures for default source/timeframe resolution and overload normalization.

### Indicator runtime

- normalize every TA call into an internal request/dependency representation;
- deduplicate compatible upstream market-data needs;
- calculate history requirements;
- request native/derived timeframe data from the data service;
- process snapshot + delta updates;
- track data revision and configuration generation separately;
- cancel/ignore obsolete work after provider, instrument, timeframe, or configuration changes;
- distinguish calculation invalidation from presentation-only changes;
- retain incremental calculation state for TA functions when safe so a building-bar update replaces only the current result rather than recalculating complete history;
- distinguish a mutable building-bar update from a finalized-bar commit/append transition;
- reject worker results that target a market-data revision or configuration generation older than the current instance state.

### Data service

- expose provider-neutral series acquisition/subscription APIs suitable for chart and indicator consumers;
- share canonical series and subscriptions where safe;
- retain sole ownership of normalized market-data state;
- provide deterministic building/finalized bar events and aggregation;
- apply live ticks/candle messages to the canonical building candle before publishing the same revisioned state to renderer and indicator consumers;
- increment the series revision on every correctness-relevant live mutation;
- never maintain a second independent candle-building truth inside the renderer or SDK runtime.

### Renderer/klinecharts adapter

- map runtime indicator definitions/results into klinecharts technical-indicator APIs;
- translate klinecharts settings edits into normalized ERC-chart config changes;
- avoid making renderer state the persistence source of truth;
- apply style-only changes without unnecessary worker/provider churn;
- render price-candle and indicator updates from compatible revisions of the canonical data-service state so the visible candle and calculated indicators cannot silently diverge.

### Signal result access

Signal processing consumes a bounded normalized result store, never a raw klinecharts result object and never a full candle scan for an ordinary evaluation.

Conceptual host-only contract:

```ts
interface IndicatorResultReader {
  latest(
    indicatorInstanceId: string,
    options?: { output?: string; finalizedOnly?: boolean },
  ): IndicatorResultPoint | null;

  last(
    indicatorInstanceId: string,
    count: number,
    options?: { output?: string; finalizedOnly?: boolean },
  ): readonly IndicatorResultPoint[];
}
```

`latest` is O(1). `last` is O(count) and reads a bounded tail/ring store directly. `count` must be a positive integer within a host limit declared by the signal contract. Results remain ordered oldest-to-newest; insufficient history returns the available prefix unless the caller requests a separately defined strict count. The default is `finalizedOnly: true` for externally actionable signals; provisional evaluation must be an explicit opt-in and the emitted candidate must retain provisional/finalized state.

The reader is a host/runtime service. Indicator authors continue to use direct series/TA handles, and neither indicator nor signal code receives a klinecharts instance, `indicator.result`, complete candle storage, or an internal context object.

## 12. Test and acceptance scenarios

The implementation is incomplete until tests cover at least these cases:

1. `ta.rsi(14)` resolves to current timeframe + `close`.
2. `ta.rsi(14, open)` resolves to current timeframe + `open`.
3. `ta.rsi(14, "1h")` resolves to `1h` + `close` without changing visible chart timeframe.
4. Object form normalizes to the same dependency as the equivalent positional overload.
5. Two equivalent `ta.*` dependencies share upstream data acquisition where safe.
6. Two different timeframe dependencies update independently.
7. Historical snapshot is followed by incremental building/finalized-bar updates without full-history retransmission on every tick.
8. Unsupported MTF request fails with a stable provider-neutral error.
9. Derived timeframe uses provider-declared alignment and produces deterministic boundaries.
10. Changing RSI length through klinecharts settings invalidates the old calculation generation and renders only new-generation output.
11. Changing only line color does not trigger a history reload or TA recalculation.
12. Workspace save/restore preserves normalized indicator inputs and presentation settings changed through klinecharts UI.
13. Provider profile configuration change reconnects/rebuilds only affected dependencies.
14. A stale result arriving after a config or data-generation change is discarded.
15. Plugin code cannot access `ctx`, klinecharts, Electron, Node, provider adapters, credentials, or storage internals.
16. A live tick that changes only the current candle produces one canonical building-candle revision used by both klinecharts and the indicator runtime.
17. Multiple ticks inside the same candle replace the current TA output point rather than append duplicate indicator points.
18. A timeframe boundary finalizes the previous candle, commits its TA state, appends the new candle, and advances each dependency exactly once.
19. A late result for revision `N` is discarded when revision `N+1` has already become current.
20. Native and derived MTF dependencies continue updating independently from the chart timeframe during a live feed.
21. Changing a calculation parameter while live data is arriving increments configuration generation, invalidates old calculation state, recalculates from already available history where possible, and then resumes incremental processing without an unnecessary provider reconnect.
22. A presentation-only setting change during a live feed does not alter the market-data revision, restart TA dependencies, or request history.
23. The renderer never constructs a different OHLC candle from the same live ticks than the data service publishes to indicator consumers.
24. The pinned klinecharts compatibility fixture normalizes the observed 10.0.3 result layout without timestamp/index drift and rejects an unknown layout.
25. A stale klinecharts calculation callback cannot overwrite a newer data revision or configuration generation.
26. Signal `latest` reads the current bounded result in O(1), and `last(N)` touches at most N stored points rather than scanning all candles.
27. Finalized-only signal reads exclude the mutable building point; provisional opt-in retains provisional state in the resulting candidate.
28. Repeated updates to one building candle recompute from committed rolling state and do not compound provisional SMA/EMA/RSI/ATR state.
29. Steady-state complexity fixtures verify O(1) SMA, EMA, RSI, ATR, and crossover updates plus amortized O(1) highest/lowest updates.

## 13. Non-goals / deferred details

This document does not freeze:

- the complete initial list of built-in `ta.*` functions;
- exact generated TypeScript overload signatures for every TA function;
- the internal source of a vetted pure numerical primitive, provided ERC-chart still owns the public TA semantics, retained state, complexity guarantee, MTF behavior, revisions, and tests;
- UI visual design for the settings dialog;
- post-MVP signal delivery and consumer plugins.

Those may evolve without changing the principles above.

## 14. Decision summary

The SDK should feel like a small trading/technical-analysis language, not a thin wrapper around ERC-chart internals.

Indicator authors express **what data/calculation they need**. ERC-chart decides **how to obtain, cache, update, isolate, and render it**.

klinecharts remains the chart/presentation engine, including its settings workflow, while ERC-chart remains the owner of normalized plugin configuration, market data, runtime correctness, persistence, and SDK semantics.

## 15. Real-time candle processing contract

This section freezes how live market data flows through the data service, SDK runtime, TA dependency engine, and klinecharts. The key rule is that the current candle is mutable until finalized and that ordinary live updates are processed incrementally rather than by repeatedly rebuilding history.

### 15.1 Canonical live-data flow

The required ownership flow is:

```text
Provider WebSocket / live feed
        │
        ▼
Provider plugin
        │
        │ normalized tick/candle event
        ▼
ERC-chart data service
        │
        ├─ validate and normalize
        ├─ identify the active building candle
        ├─ update OHLC/optional volume
        ├─ increment canonical series revision
        └─ detect candle finalization/boundary
        │
        ├──────────────► klinecharts price-series update
        │
        └──────────────► SDK / TA dependency engine
                                │
                                ├─ update direct series aliases
                                ├─ update only affected `ta.*` dependencies
                                ├─ update indicator instances incrementally
                                └─ publish revision-tagged indicator results
```

The data service is the sole source of truth for the normalized candle. klinecharts and the indicator runtime consume the same canonical revision; neither builds an independent competing OHLC state.

### 15.2 Building candle semantics

For a chart timeframe such as `1m`, the current minute's candle remains a building candle until the provider/bar-alignment boundary indicates finalization.

A new tick may change:

- `high`;
- `low`;
- `close`;
- optional `volume`, bid/ask-derived fields, or other provider-declared mutable fields.

`open` and the candle's aligned start timestamp remain stable for that bar after creation.

Example:

```ts
// before a new tick
{
  open: 101.80,
  high: 102.30,
  low: 101.60,
  close: 102.10,
}

// tick price = 102.45
{
  open: 101.80,
  high: 102.45,
  low: 101.60,
  close: 102.45,
}
```

The updated candle receives a new market-data revision and is distributed to all affected consumers.

### 15.3 Incremental TA behavior

Given author code such as:

```ts
const rsi = ta.rsi(14);
const ema = ta.ema(20, close);
```

initial history is calculated once when the dependency is created or invalidated. During live updates, a change to the building candle should update the current RSI/EMA output using retained incremental state or the smallest correct recalculation window.

The runtime must not conceptually do this for every tick:

```text
re-download history
→ rebuild every candle
→ recalculate the complete RSI history
→ recalculate the complete EMA history
```

The intended behavior is:

```text
update canonical building candle
→ increment series revision
→ update affected source value
→ update affected TA state/current output
→ publish latest revision-tagged result
```

A TA implementation may internally retain state such as previous averages, rolling sums, last processed index, or source revision. Those details are private runtime state and are never part of the public SDK API.

### 15.4 Replace current point; do not append duplicates

While the same source candle is building, repeated live updates replace the latest calculated indicator point for that candle index.

For example, during one `1m` candle:

```text
12:30:10  RSI = 61.2
12:30:25  RSI = 63.7
12:30:40  RSI = 59.8
12:30:59  RSI = 62.4
```

These values are revisions of the same current RSI point, not four new historical points.

When the bar finalizes, the final value for that candle becomes committed and the next source candle receives the next indicator index.

### 15.5 Finalization and next-candle transition

At a timeframe boundary, ERC-chart must perform a deterministic two-part semantic transition:

```text
finalize candle at index N
        ↓
commit TA state/output for index N
        ↓
append/start building candle at index N+1
        ↓
continue incremental TA updates for index N+1
```

The runtime may expose internal lifecycle events equivalent to building-bar replacement and finalized-bar append, but ordinary `ta.*` users do not manually handle those events.

Indicator authors who only use declarative series and TA helpers should not write subscription, mutation, finalization, or candle-boundary plumbing.

### 15.6 Revision and generation correctness

Market-data revision and indicator configuration generation are separate correctness dimensions.

Conceptually every asynchronous indicator result belongs to:

```ts
{
  dataRevision,
  configGeneration,
  result,
}
```

If revision `983` has already become current and work for revision `982` completes later, revision `982` must be discarded.

Likewise, if RSI length changes from 14 to 21 and configuration generation 8 becomes current, a result calculated under generation 7 must never render even if its source-data revision is newer than some previously rendered result.

The renderer only accepts results compatible with the current data revision/configuration generation rules for that indicator instance.

### 15.7 Multiple TA dependencies during a live feed

Given:

```ts
const rsi = ta.rsi(14);
const ema = ta.ema(20);
const slowRsi = ta.rsi(14, "1h");
```

the runtime maintains three normalized dependencies. They may share canonical source data where safe, but each dependency retains its own function parameters, timeframe identity, update state, and correctness status.

A live tick may therefore cause:

```text
new tick
   │
   ├─► chart-timeframe RSI dependency → update
   ├─► chart-timeframe EMA dependency → update
   └─► 1h dependency source           → maybe update its 1h building candle → update 1h RSI
```

One dependency failing, reconnecting, or waiting for history must not unnecessarily reset the others.

### 15.8 Real-time MTF resolution

For a dependency such as:

```ts
const rsi1h = ta.rsi(14, "1h");
```

ERC-chart resolves live data using provider capabilities.

If the provider supplies a native `1h` live stream, that normalized series is used. If the provider contract declares safe derivation, ERC-chart may aggregate an allowed lower timeframe into the aligned `1h` building candle. If neither path is valid, the dependency fails with the stable unsupported-timeframe error.

For derived MTF data, lower-timeframe live changes mutate only the currently affected higher-timeframe building candle. At the provider-declared alignment boundary, the higher-timeframe candle is finalized and a new one begins.

The chart can remain on a different timeframe throughout this process.

### 15.9 Live configuration changes

A calculation-affecting change while data is live, such as:

```text
RSI length: 14 → 21
```

must produce this controlled transition:

```text
normalize updated indicator configuration
        ↓
increment configuration generation
        ↓
invalidate RSI-14 calculation state/results
        ↓
reuse already available canonical history when sufficient
        ↓
calculate RSI-21 initial state/history
        ↓
publish only new-generation output
        ↓
resume incremental live processing with RSI-21
```

Changing an indicator parameter does not itself justify reconnecting the provider or downloading history again when the required canonical series is already available.

A presentation-only change such as line color, line width, line style, or visibility updates klinecharts/ERC-chart presentation state and persistence but does not invalidate market-data or TA calculation state.

### 15.10 Reconnect and gap behavior

A provider reconnect must preserve correctness rather than blindly continue from assumed continuity.

The data service owns reconnect/gap repair. After reconnect it determines whether the canonical series requires history backfill, de-duplication, building-candle replacement, or revision reset/advance. Indicator dependencies consume the resulting canonical revision sequence.

If gap repair modifies already consumed historical source bars, affected TA dependencies must recalculate from the earliest correctness-relevant changed index or from a safe checkpoint. They must not keep incremental state derived from history that is now known to be wrong.

### 15.11 Public SDK simplicity

Despite the internal lifecycle above, normal author code remains concise:

```ts
const rsi = ta.rsi(14);
const ema = ta.ema(20);

plot.line("rsi", rsi);
plot.line("ema", ema);
```

The author is not responsible for:

- WebSocket subscriptions;
- provider reconnect logic;
- candle mutation;
- finalization detection;
- MTF subscriptions/aggregation;
- history warm-up;
- rolling TA state;
- data revision checks;
- stale-result rejection;
- klinecharts synchronization.

Those are ERC-chart runtime responsibilities. This separation is a core SDK design requirement, not merely an implementation convenience.
