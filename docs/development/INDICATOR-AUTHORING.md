# Indicator SDK v2 authoring guide

ERC Chart supports one indicator authoring model: **Indicator SDK v2**.

SDK v2 is a Pine-inspired, per-bar TypeScript/JavaScript API. It is not a Pine
Script parser, a TradingView compatibility layer, or a compatibility wrapper for
the previous ERC indicator API. Existing indicators should be rewritten around
the v2 semantics in this guide rather than preserving old call shapes.

The author should focus on inputs, calculations, conditions, plots/drawings, and
signals. ERC Chart owns persistence identity, replay/finalization bookkeeping,
provisional rollback, drawing reconciliation, signal deduplication, worker
transport, and settings normalization.

## Quick start

```ts
import {
  defineIndicator,
  input,
  location,
  plot,
  shape,
  signal,
  ta,
  textSize,
} from "@erc-chart/indicator-sdk";

export default defineIndicator(
  {
    id: "erc.indicator.ema-cross.main",
    name: "EMA Cross",
    placement: "overlay",
  },
  ({ close }) => {
    const fastLength = input.int(9, {
      title: "Fast length",
      min: 1,
      max: 500,
    });
    const slowLength = input.int(21, {
      title: "Slow length",
      min: 1,
      max: 500,
    });

    const fast = ta.ema(close, fastLength);
    const slow = ta.ema(close, slowLength);
    const buy = ta.crossover(fast, slow);
    const sell = ta.crossunder(fast, slow);

    plot.line(fast, { title: "Fast EMA", color: "#089981", width: 2 });
    plot.line(slow, { title: "Slow EMA", color: "#f23645", width: 2 });

    plot.shape(buy, {
      shape: shape.labelUp,
      location: location.belowBar,
      text: "BUY",
      textSize: textSize.small,
      color: "#089981",
      textColor: "#ffffff",
    });
    plot.shape(sell, {
      shape: shape.labelDown,
      location: location.aboveBar,
      text: "SELL",
      textSize: textSize.small,
      color: "#f23645",
      textColor: "#ffffff",
    });

    signal(buy, "long");
    signal(sell, "short");
  },
);
```

Authors do not declare worker messages, runtime instances, output keys,
persistence IDs, replay hooks, or lifecycle handlers. `defineIndicator()` and the
authoring compiler generate the metadata and hidden identity required by the
runtime. The package builder generates the distributable manifest and integrity
hashes.

## The per-bar callback

The second argument to `defineIndicator()` runs once for each bar evaluation. The
public callback exposes market values and author-relevant context, including:

- `instrumentId`, `timeframeId`, and `openTimeMs`;
- `open`, `high`, `low`, `close`, and `volume`;
- `hl2`, `hlc3`, and `ohlc4`;
- `index`;
- `isConfirmed`.

The OHLCV/source values behave like ordinary numbers for current-bar arithmetic.
History syntax is added by the authoring compiler, described in the next section.
Runtime replay flags such as `isHistory` and `isHistoryFinalizedTail` are not part
of the public v2 callback. Indicator mathematics should not depend on host replay
bookkeeping.

Object destructuring keeps calculations concise:

```ts
export default defineIndicator(
  { id: "erc.indicator.range.main", name: "Range" },
  ({ high, low }) => {
    plot.line(high - low, { title: "Range" });
  },
);
```

Use `placement: "pane"` for an oscillator. Placement defaults to `"overlay"`.

## History and state

### Source history

Use v2 history syntax instead of maintaining an array just to read earlier source
values:

```ts
const previousClose = close[1];
const twoBarsBack = close.at(2);
const previousLow = history(low, 1);
```

For authored packages, the compiler lowers `close[n]` and `close.at(n)` to the
same canonical history operation as `history(close, n)`. `0` means the current
value; unavailable history returns `NaN`.

The history syntax is a compile-time authoring feature. Package indicator source
through the ERC authoring/build pipeline; do not treat direct uncompiled
`defineIndicator()` execution as the canonical author runtime.

### Indicator state with `series()`

Use `series()` when the mathematics require state from the previous committed
bar:

```ts
const atr = ta.atr(14);
const trailingStop = series(close - atr, (previous) =>
  Math.max(previous, close - atr),
);

plot.line(trailingStop, { title: "Trailing stop" });
```

Every building-bar re-evaluation starts from the previous committed state.
Finalized evaluation advances the committed value. This gives recurrences the
same provisional rollback semantics as the rest of the SDK without author replay
flags.

`series()` may hold primitive values or genuine domain state such as small plain
objects, arrays, maps, sets, typed arrays, and buffers. Structured state is
bounded to 4,096 retained collection items in aggregate. Custom class instances
are unsupported. Keep large historical data in the platform history/source
model rather than recreating chart history inside `series()`.

Legacy bounded-history helpers such as `appendSeries()` and `laggedValue()` are
not part of the public v2 authoring surface.

## Inputs

Available input helpers are:

```ts
input.int(defaultValue, options?);
input.float(defaultValue, options?);
input.bool(defaultValue, options?);
input.string(defaultValue, options?);
input.color(defaultValue, options?);
```

Example:

```ts
const length = input.int(14, {
  title: "Length",
  group: "Calculation",
  description: "Lookback period",
  min: 1,
  max: 500,
  step: 1,
});

const showSignals = input.bool(true, {
  title: "Show signals",
  group: "Display",
  effect: "presentation",
});

const mode = input.string("fast", {
  title: "Mode",
  options: ["fast", "slow"] as const,
});
```

Do not supply persistence keys. Stable input identity is generated by the
compiler/SDK. The host normalizes persisted settings against the current input
declarations, including defaults, numeric bounds/steps, booleans, strings, and
option lists.

Use `effect: "presentation"` for settings that only change presentation. Other
inputs default to calculation semantics.

### Selecting a current-bar price source

The current v2 surface exposes `priceSources` and `priceValue()` for source
selection:

```ts
import {
  defineIndicator,
  input,
  plot,
  priceSources,
  priceValue,
} from "@erc-chart/indicator-sdk";

export default defineIndicator(
  { id: "erc.indicator.source.main", name: "Source" },
  (bar) => {
    const source = input.string("close", {
      title: "Source",
      options: priceSources,
    });

    plot.line(priceValue(bar, source), { title: "Selected source" });
  },
);
```

## Technical analysis

SDK v2 exposes scalar, per-bar TA calls:

| API                                                | Use                         |
| -------------------------------------------------- | --------------------------- |
| `ta.sma(length)` / `ta.sma(value, length)`         | Simple moving average       |
| `ta.ema(length)` / `ta.ema(value, length)`         | Exponential moving average  |
| `ta.rsi(length)` / `ta.rsi(value, length)`         | RSI                         |
| `ta.atr(length)`                                   | ATR from the current candle |
| `ta.dmi(length)`                                   | DMI/ADX point               |
| `ta.highest(length)` / `ta.highest(value, length)` | Rolling high                |
| `ta.lowest(length)` / `ta.lowest(value, length)`   | Rolling low                 |
| `ta.crossover(left, right)`                        | Upward crossing condition   |
| `ta.crossunder(left, right)`                       | Downward crossing condition |
| `ta.movingAverage(value, type, length)`            | Moving-average catalogue    |

When a one-argument source form exists, it uses the documented default price
source (`close` for SMA/EMA/RSI and the natural high/low source for extrema).
Low-level kernel constructors and array-oriented compatibility functions are not
public author APIs.

Stateful TA identity is compiler-owned. Authors do not allocate kernel IDs or
manage committed/provisional kernel state.

## Plots and markers

Numeric plots accept a number or `null`:

```ts
plot.line(value, {
  title: "Value",
  color: "#2962ff",
  width: 2,
  style: "solid",
});

plot.hline(50, { title: "Midpoint", color: "#787b86" });
plot.histogram(delta, { title: "Delta", color: "#7e57c2" });
```

Use `null` when a value should be hidden for a bar. Plot identity and output keys
are hidden implementation details; authors do not provide keys.

### Shape markers

`plot.shape()` accepts a boolean condition or numeric value. Boolean conditions
combine naturally with semantic locations:

```ts
plot.shape(buy, {
  shape: shape.labelUp,
  location: location.belowBar,
  text: "BUY",
  textColor: "#ffffff",
  textSize: textSize.small,
  color: "#089981",
});
```

Available shape constants are `circle`, `triangleUp`, `triangleDown`, `labelUp`,
and `labelDown`. Locations are `aboveBar`, `belowBar`, and `absolute`. Text sizes
are `tiny`, `small`, `normal`, `large`, and `xlarge`.

For `location.absolute`, provide a numeric value because the SDK must not invent
a price coordinate. For `aboveBar`/`belowBar`, a boolean condition lets the host
place the marker relative to the candle.

The concise overloads are also valid:

```ts
plot.shape(buy, "BUY");
plot.shape(buy, shape.labelUp, "BUY");
```

Use the options object when location, colors, or semantic text size matter.

## Persistent drawings

`plot.box()` and `plot.segment()` return persistent SDK-owned handles. Authors
provide geometry; the compiler/runtime provides identity.

```ts
const zone = plot.box({
  left: startTimeMs,
  right: openTimeMs,
  top: upper,
  bottom: lower,
  color: "rgba(41, 98, 255, 0.15)",
  borderColor: "#2962ff",
});

zone.set({ right: openTimeMs, top: nextUpper, bottom: nextLower });
if (expired) zone.delete();
```

A segment uses `startValue`/`endValue` instead of box `top`/`bottom`:

```ts
const level = plot.segment({
  left: startTimeMs,
  right: openTimeMs,
  startValue: price,
  endValue: price,
  color: "#ffb300",
  width: 2,
  style: "solid",
});

level.set({ right: openTimeMs });
```

Re-executing the same compiled source call revisits the same hidden drawing
occurrence. Building updates are provisional and start from the last finalized
drawing state. Omitted finalized calls do not implicitly delete committed
drawings; call `handle.delete()` when the indicator mathematics say the drawing
has expired.

Do not create drawing IDs, reconciliation scope keys, or arrays of platform IDs.
Keep only genuine domain state needed to decide what should be drawn.

## Signals

Signals are conditions, not manually managed events:

```ts
const buy = ta.crossover(fast, slow);
const sell = ta.crossunder(fast, slow);

signal(buy, "long", { confidence: 0.9 });
signal(sell, "short");
```

Directions are `"long"`, `"short"`, and `"neutral"`. Optional confidence must be
between `0` and `1`.

The signal engine emits committed events only for finalized bars. Provisional
building-bar conditions do not become committed events, and identity/deduplication
is SDK/compiler-owned. Do not add signal IDs or manual finalized-tail checks.

## Conditional execution

Compiled SDK v2 calls have stable hidden call-site identity, so normal conditions
do not need execution-order bookkeeping in author code.

```ts
if (showSignals) {
  plot.shape(buy, {
    shape: shape.labelUp,
    location: location.belowBar,
    text: "BUY",
  });
}

if (buy) signal(true, "long");
```

The same principle applies to stateful TA/series/plot/drawing/signal call sites:
identity comes from the compiled source location rather than from an author-owned
counter or string ID. A single call site must still represent one semantic
declaration; do not deliberately execute the same source call multiple times in
one bar through a loop when the API expects one occurrence.

For simple visibility, passing `null` to a numeric plot is often clearer than
wrapping the call in a branch:

```ts
plot.line(showAverage ? average : null, { title: "Average" });
```

## Execution and lifecycle

The runtime discovers declarations, replays retained history, applies building
updates provisionally, commits finalized bars, and handles rebuilds/corrections.
Those phases are platform concerns.

Author code should follow these rules:

- keep calculations synchronous and free of external side effects;
- use `series()` for mathematical recurrence instead of module-global mutation;
- use source history for prior source values instead of author history buffers;
- use compiler-owned inputs/TA/plots/drawings/signals without persistence IDs;
- use drawing handles for explicit drawing updates/deletion;
- use `signal()` for finalized event emission instead of lifecycle flags;
- use `isConfirmed` only when the indicator's actual calculation intentionally
  distinguishes the current finalized candle from a building candle.

The runtime bounds instances to 100,000 result points, 128 input/value-plot
declarations, 256 TA/recurrence calls, 4,096 structured-series collection items,
2,000 retained drawings, and 10,000 retained signals. Signal calls themselves are
also limited per bar. Treat those as platform safety limits, not storage targets.

## Multi-timeframe and provider-aware sources

The overall SDK v2 architecture includes provider-aware source resolution,
whole-indicator timeframe controls, and per-TA timeframe overrides. Those
capabilities are intentionally **not claimed as complete by the ECDD-216
optimization workstream**.

Operational provider-aware MTF acquisition and per-TA timeframe overrides are
owned by **ECDD-142**. The current public optimization surface does not advertise
an `input.timeframe()` or per-TA timeframe argument as available author APIs.
Do not implement custom provider aggregation or lookahead-prone resampling inside
an indicator to imitate those future host capabilities.

When ECDD-142 lands, this guide must be updated from its shipped public contract
and provider capability behavior. Until then, an indicator calculation runs on
the source/timeframe supplied by the host context.

## Rewriting an older indicator to v2

Rewrite the indicator from its trading/math semantics rather than preserving old
framework plumbing.

| Older concern                                       | SDK v2 rewrite                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| Explicit input/plot/signal persistence key          | Remove it; identity is compiler/SDK-owned                         |
| Kernel/plot/input index or call-order counter       | Remove it; call-site identity is hidden                           |
| `appendSeries()` / `laggedValue()` source history   | Use `close[n]`, `source.at(n)`, or `history(source, n)`           |
| Genuine recurrence/domain state                     | Keep the mathematics in `series()`                                |
| Array-oriented TA compatibility call                | Rewrite as scalar per-bar `ta.*`                                  |
| Conditional call workaround to preserve order       | Write the natural condition on the compiled v2 call site          |
| Drawing ID/scope/reconciliation array               | Use `plot.box()` / `plot.segment()` handles and `delete()`        |
| Manual signal ID/dedup/finalized-tail logic         | Use `signal(condition, direction, options?)`                      |
| Author-side persisted-settings migration/validation | Declare `input.*`; host normalization owns stale/invalid settings |
| `isHistory` / `isHistoryFinalizedTail` branches     | Remove replay plumbing; use v2 history/state/signal lifecycle     |
| Custom provider/timeframe aggregation               | Do not emulate it; provider-aware MTF is owned by ECDD-142        |

A rewrite is successful when the remaining state and branches exist because the
indicator mathematics require them, not because ERC Chart's runtime requires
them.

The maintained ATR Rope + UT Bot implementation is the flagship example. It uses
hidden input/plot identity, canonical history reads, `series()` for genuine Rope,
UT Bot, POC/profile/follow/MG domain state, semantic BUY/SELL shapes, finalized
signals, and SDK-owned drawing handles while preserving its trading semantics.
See `packages/indicator-examples/src/atr-rope-utbot.ts` for the full source.

## Build and import

Build all registered distributable plugins:

```powershell
npm run build:plugins
```

Build the workspace and package one indicator source explicitly:

```powershell
npm run build
node tools/build-indicator-package.mjs packages/indicator-examples/src/atr-bands.ts erc.indicator.atr-bands 0.1.0
```

The package builder runs the authoring transform that injects stable hidden
call-site metadata and history lowering. It writes the plugin under
`out/indicator-plugins/<package-id>/` for import through Plugin Manager.

The definition ID must start with the package ID followed by a dot. Use a new
package version when changing installed runtime code; rebuilding source does not
replace an already installed plugin.

Registered plugins are listed explicitly by the repository build tooling; the
bulk build does not discover arbitrary source files automatically.

## Verification

For repository development, use the normal delivery gates. Focused commands
include:

```powershell
npm run build
npm run test:unit
npm run test:integration
npm run test:performance
npm run build:plugins
```

The maintained-indicator suites run compiled packages so the tests exercise the
same hidden identity/history transform used by installed plugins. Performance
coverage exercises large history, structured state, drawings, authored
indicators, and worker budgets. See
`docs/development/INDICATOR-PERFORMANCE-ASSESSMENT.md` for measured workloads and
limits; component benchmarks are not a whole-application FPS guarantee.

## Public authoring boundary

Normal indicator source should import from `@erc-chart/indicator-sdk` only.
Runtime snapshots, worker lifecycle ports, host parameter normalizers, low-level
TA kernels, array-history compatibility helpers, persistence IDs, and lifecycle
replay flags are not authoring APIs.

If a piece of code exists primarily to satisfy ERC Chart runtime architecture
rather than the indicator mathematics, it belongs in the SDK/host instead of the
indicator source.
