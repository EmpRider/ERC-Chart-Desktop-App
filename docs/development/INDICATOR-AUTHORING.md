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
`openTimeMs`, `index`, `isConfirmed`, `hl2`, `hlc3`, and `ohlc4`. Placement defaults
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
  plot.line(low, { title: "Low" });
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

| API                                                                     | Behavior                                                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `input.int`, `input.float`, `input.bool`, `input.string`, `input.color` | Generate settings controls; optional title, group, description, effect and numeric bounds |
| `ta.sma`, `ta.ema`, `ta.rsi`                                            | `ta.ema(14)` uses close; `ta.ema(value, 14)` uses a calculated scalar                     |
| `ta.atr(14)`, `ta.dmi(14)`                                              | Use the current candle and committed kernels                                              |
| `ta.highest(14)`, `ta.lowest(14)`                                       | Default to high/low; accept `(value, length)` too                                         |
| `ta.crossover(a, b)`, `ta.crossunder(a, b)`                             | Scalar crossing conditions                                                                |
| `ta.movingAverage(value, type, length)`                                 | Existing moving-average catalogue with a scalar source                                    |
| `plot.line`, `plot.hline`, `plot.histogram`                             | Plot one numeric value or `null`, with optional title/color/width/style                   |
| `plot.shape`                                                            | Plot an up/down marker at a numeric price, or `null` to hide it                           |
| `plot.box`, `plot.segment`, `plot.remove`                               | Create/update/delete drawings by stable ID; no author-owned output arrays                 |
| `series(initial, update)`                                               | A scalar recurrence with automatic provisional rollback                                   |
| `signal(condition, direction, options?)`                                | Emit a finalized long/short/neutral signal; optional ID/confidence                        |

Existing array-based `ta` calls still work for legacy indicators and reference
calculations. Scalar authoring calls require an active `defineIndicator` callback.

```ts
const stop = series(0, (previous) => Math.max(previous, close - taValue));
plot.line(stop, { title: "Stop", color: "#ff9800" });
signal(crossedAbove, "long", { id: "cross-up" });
```

Call stateful `ta` helpers outside the `series` update callback, then use their
values in the recurrence. Recurrences accept number, boolean or string state;
the update function must preserve its type and have no external side effects.

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
new plugin version can change generated input/plot keys; treat that as a settings
migration when publishing updates.

Callbacks must be synchronous and free of external side effects. Use `series`
instead of module-global mutable state. Drawings may be conditional: their
building-bar changes roll back on the next replacement; finalized drawings
persist until replaced, removed, or evicted by the documented retention cap.
Signals are emitted only on confirmed bars.

The SDK bounds instances to 100,000 points, 128 input/value-plot declarations,
256 TA/recurrence calls, 1,000 retained drawings, and 10,000 retained signals.
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

The legacy ATR Rope + UT Bot example now updates its building candle and output
point without copying history. **Its finalized-bar handler still rebuilds the
legacy POC/signal calculation.** That complex indicator has not been rewritten
onto the new scalar API; the new API supports incremental finalization. Neither
this change nor the microbenchmark establishes a four-chart FPS guarantee.

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

Run `node tools/indicator-tick-performance.mjs` after building. It checks for
history materialization and output cloning while reporting synthetic timings.
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
