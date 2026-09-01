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
open
high
low
close
volume
hl2
hlc3
ohlc4
```

Where a provider does not supply an optional field such as volume, the SDK must expose the absence deterministically rather than silently fabricate data.

### 2.2 Overloads and named-parameter style

Technical-analysis helpers should support concise overloads for common cases and an object form for explicit configuration.

Example RSI API:

```ts
ta.rsi(14);           // length 14, default value = close, current chart timeframe
ta.rsi(14, open);     // length 14, explicit source = open, current chart timeframe
ta.rsi(14, "1h");    // length 14, default source = close, explicit timeframe
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
  providerProfileId,
  instrumentId,
  timeframeId,
  source,
  functionId,
  normalizedParameters
}
```

Equivalent dependencies requested by one or more indicator instances should share upstream market-data subscriptions and cached series when safe. Indicator calculation state remains isolated per active indicator instance unless an explicitly shared pure calculation cache is later introduced.

### 3.4 Historical requirement discovery

Each built-in TA function must declare or derive its warm-up/history requirement. The runtime uses that requirement to request enough bars for a correct first result.

Nested calculations compose requirements. The plugin should not need to manually state `load 200 bars` merely because it calls a function whose lookback can be inferred.

Dynamic or unbounded lookbacks must be rejected, capped, or explicitly declared so the runtime can preserve the 100,000-candle and execution-budget limits.

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
- native technical-indicator drawing behavior;
- native indicator parameter/style settings UI when used;
- visual invalidation/redraw behavior.

ERC-chart owns:

- installable provider and indicator plugins;
- provider profiles and dynamic provider configuration;
- market-data acquisition and canonical series state;
- `ta.*` authoring API;
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

### 5.3 Settings synchronization

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
User edits settings in klinecharts UI
        ↓
klinecharts emits/returns updated indicator configuration
        ↓
ERC-chart renderer adapter normalizes the change
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

The klinecharts object must not become the sole persisted source of truth. ERC-chart persists a normalized, versioned representation so workspace restore is independent of ephemeral chart instances.

### 5.4 Configuration classification

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
- distinguish calculation invalidation from presentation-only changes.

### Data service

- expose provider-neutral series acquisition/subscription APIs suitable for chart and indicator consumers;
- share canonical series and subscriptions where safe;
- retain sole ownership of normalized market-data state;
- provide deterministic building/finalized bar events and aggregation.

### Renderer/klinecharts adapter

- map runtime indicator definitions/results into klinecharts technical-indicator APIs;
- translate klinecharts settings edits into normalized ERC-chart config changes;
- avoid making renderer state the persistence source of truth;
- apply style-only changes without unnecessary worker/provider churn.

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

## 13. Non-goals / deferred details

This document does not freeze:

- the complete initial list of built-in `ta.*` functions;
- exact generated TypeScript overload signatures for every TA function;
- whether selected pure TA kernels are implemented by ERC-chart, delegated to klinecharts, or shared internally, provided public semantics remain stable;
- UI visual design for the settings dialog;
- post-MVP signal delivery and consumer plugins.

Those may evolve without changing the principles above.

## 14. Decision summary

The SDK should feel like a small trading/technical-analysis language, not a thin wrapper around ERC-chart internals.

Indicator authors express **what data/calculation they need**. ERC-chart decides **how to obtain, cache, update, isolate, and render it**.

klinecharts remains the chart/presentation engine, including its settings workflow, while ERC-chart remains the owner of normalized plugin configuration, market data, runtime correctness, persistence, and SDK semantics.
