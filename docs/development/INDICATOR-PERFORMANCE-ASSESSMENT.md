# Indicator runtime regression assessment

The working-tree changes were assessed against Git HEAD `2e4a0f4`, the supplied
data-integrity/runtime plan, the pasted original request, and the screenshot.
The historical documents were treated as context, rather than new instructions.
Existing uncommitted work was preserved.

## Why the application became slow

1. **Valid revision batches caused unnecessary resets.** A candle rollover can
   finalize one candle and start another, advancing the series revision twice.
   React can also combine several updates. The renderer treated these revision
   jumps as missing data and reset chart history and indicator calculations.
   This was reproduced through the production shell in a regression test.
2. **Derived timeframes scanned retained history on ordinary ticks.**
   `provider-bridge.ts` traversed the source map to project a touched bucket and
   materialized finalized candle history just to read its last entry. Work grew
   with the number of loaded bars, even though only one bucket changed.
3. **Incremental indicator updates still copied history.** The legacy ATR Rope
   implementation copied/sorted candle arrays and copied its output points.
   Renderer update preparation also traversed or copied retained data.
4. **Worker requests and visual payloads added avoidable work.** Pending chart
   updates needed serialization and coalescing, and unchanged overlays/signals
   were being sent repeatedly. Together with the rebuilds above, this could
   leave indicators catching up while the chart continued receiving prices.

The screenshot shows the reported visual discrepancy, but does not establish
which runtime operation caused it. The causes above are supported by code
inspection, regression tests, and isolated timing measurements. There was no
before/after interactive FPS recording of the user's live session.

## Changes implemented

- Added batch-start revision metadata and preserved genuine rebuild requirements
  through React batching. Normal rollover and building batches stay incremental;
  historical corrections and actual gaps still trigger recovery.
- Restricted derived-timeframe projection to the touched bucket's source slots,
  with a direct latest-finalized lookup.
- Kept a separate live candle in renderer session state and updated chart tails
  without scanning historical candles, including Heikin-Ashi updates.
- Serialized worker calculation with one active request and one latest pending
  state. Full snapshots are prepared only when a rebuild is required.
- Changed legacy ATR building updates to replace their current candle/point in
  place. Added visual revisions so unchanged drawings/signals are retained
  without being retransmitted.
- Added a Pine-inspired authored SDK: `defineIndicator`, `input`, scalar `ta`,
  `series`, `plot`, and `signal`. Definitions, output arrays and lifecycle
  handling are generated internally. Provisional calculations roll back to the
  last committed bar before each tick, preventing cumulative intrabar errors.

## Measured results and checks

In the isolated derived-2m test with 100,000 source bars, 100 tick updates took
approximately 1.59 ms after the changes, versus the earlier 1,004 ms observation.
The new path materialized zero historical candle objects on these updates.
For the legacy ATR building handler, 1,000 updates took approximately 2.16 ms
with either 1,000 or 100,000 historical bars. These single-run measurements
exclude rendering, SQLite and transport; they are not whole-application latency
or FPS measurements.

Validation completed:

- Unit suite: 501 passed, two existing Windows symlink-permission skips.
- Integration suite: 81 passed.
- Final targeted contract, production-shell and scalar-authoring tests: 13 passed.
- Type checking, lint, repository formatting and Git whitespace checks passed.
- Electron application smoke passed.
- Electron indicator-worker smoke passed, including generated plugin loading,
  one-point building updates, rollover, settings rebuild and visual omission.

## Remaining work and practical limits

Ordinary tick work is independent of retained history for the updated paths,
with cost still depending on configured lookback, source/target timeframe ratio,
number of plots/drawings and author code. Extrema use amortized constant-time
queues; arbitrary loops or moving-average variants cannot all promise strict
constant work.

ATR Rope + UT Bot now uses the authored API and persistent committed state for
its rope, UT Bot, signal-follow and rolling POC calculations. Finalized bars
advance that state incrementally and building updates reuse the last committed
state. Renderer rollover can still materialize session history; ordinary
same-bar ticks avoid that copy.

Initial load, timeframe/instrument changes, calculation settings, historical
corrections, missed multi-bar catch-up and retention resets may rebuild from the
start. Live multi-chart profiling is still needed to quantify responsiveness
under the user's actual market feed and indicator configuration.

The authored API is TypeScript/JavaScript, not a Pine parser. It currently offers
lines, horizontal lines, histograms, shapes, boxes, segments and signals. MTF
acquisition, filled bands and table/text-label APIs are not implemented. Signal
was consulted only for authoring ideas; its code and architecture were not copied.

See [the authoring guide](INDICATOR-AUTHORING.md) and
`packages/indicator-examples/src/atr-bands.ts` for the new API. Restart the rebuilt
application and import the generated ATR Rope + UT Bot **0.1.3** package to use
its updated runtime. A source build does not replace an already installed plugin.
The ATR Bands **0.1.0** example package was also generated. Neither package was
installed into the user's live profile during this work.
