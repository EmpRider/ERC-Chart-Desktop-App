# Scalar indicator authoring

Use TypeScript or JavaScript with the ERC Indicator SDK. This is a Pine-inspired
per-bar API, not a Pine Script parser or a TradingView compatibility layer.
The existing `IndicatorPluginModule` API remains supported.

```ts
import { defineIndicator, input, plot, ta } from "@erc-chart/indicator-sdk";

export default defineIndicator(
  { id: "erc.indicator.my-trend.main", name: "My Trend" },
  ({ close }) => {
    const length = input.int(14, { title: "Length", min: 1, max: 500 });
    const average = ta.ema(close, length);
    plot.line(average, {
      title: "EMA",
      color: close >= average ? "#089981" : "#f23645",
      width: 2,
    });
  },
);
```

Authors do not write `hostCompatibility`, `indicatorContractVersion`, `outputs`,
`plots`, history arrays, worker messages, or lifecycle handlers. `defineIndicator`
generates the existing plugin definition and implements the worker lifecycle.
The build tool generates the package manifest and integrity hashes.

The callback receives the current candle's OHLCV, instrument/timeframe identity,
`openTimeMs`, `index`, `isConfirmed`, `isHistory`, `isHistoryFinalizedTail`, `hl2`,
`hlc3`, and `ohlc4`. `isHistory` is true while retained candles are replayed;
`isHistoryFinalizedTail` marks the last finalized candle before the retained
building candle. Placement defaults
to `overlay`; specify `placement: "pane"` for an oscillator.

## Understanding `({ close, low }) => { ... }`

`close` and `low` are numeric prices from the current candle being calculated,
not arrays of historical prices:

- `close` is the latest price while the candle is forming, and its final closing
  price after the candle closes.
- `low` is the lowest price reached during that candle so far.

The SDK supplies a calculation object to your callback. JavaScript's **object
destructuring** syntax lets you select the fields you need directly:

```ts
({ close, low }) => {
  plot.line(close, { title: "Close" });
  plot.line(low, { title: "Low" });
};
```

This is shorthand for the following callback, with the same behavior:

```ts
(candle) => {
  const close = candle.close;
  const low = candle.low;
  plot.line(close, { title: "Close" });
};
```

Pass either form as the second argument to `defineIndicator`. You can also select
`open`, `high`, `volume`, or any of the other callback fields listed above.

During history loading, the SDK calls your calculation for each candle in order.
Live updates call it again with the current candle's updated prices, and
finalization commits that candle's state. The same candle may therefore be
calculated many times while forming. The SDK also makes an initial synthetic
call to discover declarations; see **Execution and correctness** below.

## Available calls

| API                                                                     | Behavior                                                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `input.int`, `input.float`, `input.bool`, `input.string`, `input.color` | Generate settings controls; optional stable key, title, group, description, effect and bounds; string option tuples infer their union type |
| `ta.sma`, `ta.ema`, `ta.rsi`                                            | `ta.ema(14)` uses close; `ta.ema(value, 14)` uses a calculated scalar                                                                      |
| `ta.atr(14)`, `ta.dmi(14)`                                              | Use the current candle and committed kernels                                                                                               |
| `ta.highest(14)`, `ta.lowest(14)`                                       | Default to high/low; accept `(value, length)` too                                                                                          |
| `ta.crossover(a, b)`, `ta.crossunder(a, b)`                             | Scalar crossing conditions                                                                                                                 |
| `ta.movingAverage(value, type, length)`                                 | Existing moving-average catalogue with a scalar source                                                                                     |
| `plot.line`, `plot.hline`, `plot.histogram`                             | Plot one numeric value or `null`, with optional title/color/width/style                                                                    |
| `plot.shape`                                                            | Plot an up/down marker at a numeric price, or `null` to hide it                                                                            |
| `plot.box`, `plot.segment`                                              | Create or revisit an SDK-identified drawing and return a handle with `set()` / `delete()`                                                   |
| `series(initial, update)`                                               | A recurrence with automatic provisional rollback; supports primitive or structured state                                                   |
| `appendSeries(history, value, keep)`, `laggedValue(...)`                | Maintain small bounded custom histories without repeating slice/lag boilerplate                                                            |
| `signal(condition, direction, options?)`                                | Emit a finalized long/short/neutral signal; options may include confidence, while persistence identity remains SDK-owned                    |

Existing array-based `ta` calls still work for legacy indicators and reference
calculations. Scalar authoring calls require an active `defineIndicator` callback.

```ts
const stop = series(0, (previous) => Math.max(previous, close - taValue));
plot.line(stop, { title: "Stop", color: "#ff9800" });
signal(crossedAbove, "long", { confidence: 0.9 });
```

Call stateful `ta` helpers outside the `series` update callback, then use their
values in the recurrence. Recurrences can hold primitive or structured state.
The update function must preserve the value kind and have no external side
effects. Treat previous structured state as immutable and return new objects or
arrays for changes. Across a structured series value, retained collection
containers (arrays, maps, sets and typed arrays) may hold at most 4,096 items in
total. Raw `ArrayBuffer` and `DataView` values count their `byteLength` toward
the same aggregate limit; exceeding 4,096 throws `RangeError`. Custom class
instances are unsupported, including when nested in plain objects or collections.
Keep custom histories bounded with helpers such as `appendSeries`.

Drawing identity is generated by the compiler/runtime. Authors provide geometry,
receive a handle, and use that handle for explicit lifecycle changes:

```ts
const zone = plot.box({
  left: startTimeMs,
  right: openTimeMs,
  top: high,
  bottom: low,
  color: "#2962ff33",
});

zone.set({ right: openTimeMs });
if (zoneExpired) zone.delete();
```

`plot.segment(...)` follows the same model. Re-evaluating the same source call
revisits the same hidden drawing occurrence, so authors do not write object IDs or
scope keys. Finalized drawings persist while their call is omitted, and a later
execution can update the same hidden drawing. Building-bar changes are provisional:
a replacement update starts from the last finalized drawing state. Deletion is
explicit through the handle, and the SDK evicts the oldest retained drawings when
the documented 2,000-drawing cap is reached.

## Execution and correctness

The SDK evaluates the callback once with a synthetic candle and default inputs
to discover input and plot declarations. This is metadata discovery, not a real
market bar. Then it evaluates once per historical bar, committing every bar
except the current building bar. Repeated updates to that building bar start
from the last finalized state. Finalization commits once; the next bar continues
incrementally. Duplicate identical finalization is a no-op.

Keep inputs, stateful TA calls, recurrences, and value plots unconditional and in
the same order. Hide a plot with `plot.line(show ? value : null)` instead of
conditionally calling `plot.line`. Colors and widths may change per bar. Titles,
plot types, line styles and marker directions are declarations and stay fixed.
Input values and TA lengths may change through a configuration rebuild, not
as a function of individual candle prices. Changing the declaration order in a
new plugin version can change generated input/plot keys; use explicit stable
`key` values when settings/output compatibility matters.

Persisted plugin settings are normalized against the current input declarations
before calculation. Missing inputs receive their current defaults, stale unknown
keys are ignored, invalid booleans/strings fall back to defaults, unsupported
string options fall back to the declared default, and numeric values are bounded
and rounded to the declared step. Indicator authors should not write a separate
`toParams`, validation, or config-migration function for these cases. Keep the
same explicit input `key` when a setting continues to represent the same concept.

Callbacks must be synchronous and free of external side effects. Use `series`
instead of module-global mutable state. Drawing calls may be conditional: omitted
finalized drawings keep their last committed geometry, building-bar changes roll
back on replacement, and a later execution of the same hidden call-site identity
revisits the same drawing. Use the returned handle to update or delete a drawing;
do not maintain persistence IDs or reconciliation scope keys. Signals are emitted
only on confirmed bars, and their persistence identity is compiler/runtime-owned.

The SDK bounds instances to 100,000 points, 128 input/value-plot declarations,
256 TA/recurrence calls, 4,096 retained structured-series collection items,
2,000 retained drawings, and 10,000 retained signals.
Drawing/signal retention evicts the oldest entries at their caps. There is no
network access, storage, implicit multi-timeframe acquisition, arbitrary Pine
syntax, table/text-label drawing API, or filled-band plot in this authoring API.
Those capabilities must be implemented explicitly before being advertised.

## Incremental work and rebuilds

Ordinary building updates touch the current candle/point and fixed kernel state;
they do not traverse retained chart history. SMA/EMA/ATR/RSI/crossings use constant
work, and extrema use bounded monotonic queues with amortized constant updates.
Cost also depends on the indicator's number of calls, drawing changes, configured
lookbacks for other MA variants, and any custom loops the author writes. The SDK
cannot make arbitrary author code constant-time.

Initial loading, timeframe/instrument/profile changes, calculation input changes,
historical corrections, missed multi-bar catch-up, and retention resets may
rebuild history. A normal two-revision rollover or a React batch of building
updates does not itself require a chart reset. The renderer serializes worker
calculations and retains one latest pending chart state. Unchanged overlays and
signals are not retransmitted on every tick by SDK-authored indicators.

ATR Rope + UT Bot now uses the authored API. Its rope, UT Bot, follow-signal and
rolling POC migration state are committed with `series`, while plots, drawings
and signals use the same `plot`/`signal` surface as smaller indicators. Its input
types are inferred directly from declarations, bounded source history uses SDK
helpers, and POC zones use `plot.box` / `plot.segment` handles with SDK-owned
identity instead of author IDs or reconciliation scopes. Building replacements
roll back to committed drawing state and finalized bars advance incrementally.
This does not establish a four-chart FPS guarantee.

## Build and import

Build all registered indicator and provider packages in one command:

```powershell
npm run build:plugins
```

This compiles the workspace once, then packages ATR Rope + UT Bot, ATR Bands,
and Binomo under `out/indicator-plugins` and `out/provider-plugins`. The existing
single-package npm commands remain available. Register future distributable
packages in `tools/build-all-plugins.mjs` to include them in this command; it does
not automatically discover arbitrary source files. The candle/tick provider SDK
fixtures are compiled by the workspace build but are not packaged.

Build the workspace first, then package a source file:

```powershell
npm run build
node tools/build-indicator-package.mjs packages/indicator-examples/src/atr-bands.ts erc.indicator.atr-bands 0.1.0
```

This writes `out/indicator-plugins/erc.indicator.atr-bands/plugin.json` and its
bundled runtime. Import that package through Plugin Manager. The definition ID
must start with the package ID followed by a dot. Use a new package version when
changing installed runtime code; rebuilding source does not replace an already
installed plugin. Building imports the authored module to discover its metadata,
so this development command is for your own trusted source.

The full example is `packages/indicator-examples/src/atr-bands.ts`. To build the
updated legacy indicator separately, run `node tools/build-atr-rope-utbot-indicator.mjs`;
its package version is now `0.1.3`.

## Verification and reference use

After building, `npm run test:performance` enforces the SDK's 60-second maximum
history budget for structured series, 2,000 stable drawings over 100,000 bars,
and the authored ATR fixture. It also checks ATR building/finalized updates
against the 100 ms worker budget. See the performance assessment for workloads,
measurements and limits; this is not a measured whole-application FPS gate.

Run `node tools/indicator-tick-performance.mjs` after building. It checks for
history materialization and output cloning while reporting synthetic timings.
Run `node tools/indicator-series-performance.mjs` to replay 100,000 bars with a
structured series holding the maximum 4,096 retained collection items. On this
workspace's September 9 run, that bounded worst-case replay took approximately
21.4 seconds. The measurement is domain-only and is not an application latency or
FPS target.
On this workspace's September 8 run, 100 derived 2m ticks with 100,000 source
bars took approximately 1.59 ms, versus the earlier 1,004 ms observation.
1,000 legacy ATR Rope building updates took approximately 2.16 ms with either
1,000 or 100,000 historical candles. These are domain-only single-run observations;
they exclude rendering, SQLite, transport and full-application interaction.

The SDK tests compare building replacements/rollovers against fresh calculations,
exercise provisional state/drawings, input changes, instance isolation, invalid
declarations, and 100,000-point updates. The Electron indicator-worker smoke also
loads the authored example and verifies snapshot, single-point building update,
two-point rollover, configuration rebuild and unchanged-visual omission.

Signal was read only as authoring-behavior evidence: its authoring ergonomics
fixture, UT Bot declaration surface and technical report illustrated compact
plot/shape/signal calls and persistent state. No Signal source, runtime,
module structure, browser hooks or dependencies were copied or imported.
