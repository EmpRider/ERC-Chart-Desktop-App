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

The authored structured-series contract now caps retained collection items at
4,096. `node tools/indicator-series-performance.mjs` replays 100,000 bars while
holding that maximum state size. On the September 9 workspace run it completed
in approximately 21.4 seconds and produced 100,000 points. This is a synthetic
SDK-only boundary measurement, not whole-application latency.

PR #114 follow-up: `npm run test:performance` now runs the structured-series,
drawing reconciliation and authored ATR benchmarks in CI. History workloads
must finish within the worker's 60,000 ms maximum; ATR building and finalized
updates must each stay below 100 ms. The worker timeout tests also verify the
per-bar formula and 60,000 ms cap using controlled timers.

September 9 observations on Node 26.8.1, Windows (single runs):

| Workload                                                |   Observed time |
| ------------------------------------------------------- | --------------: |
| 100,000 bars, 4,096 numeric series items                |         23.99 s |
| 100,000 bars, 2,000 stable drawings                     |         38.67 s |
| Authored ATR, 100,000 bars, default inputs              |         19.46 s |
| Authored ATR, 1,000 building updates after that history | 116.52 ms total |
| Authored ATR, one finalized update after that history   |         0.65 ms |

Drawing replay before reusing unchanged frozen geometry measured 49.25 s in
isolation and 79.01 s while other tests were running. Reusing the committed
geometry avoids allocating and freezing 2,000 replacement objects per candle.
The ATR fixture uses flat synthetic candles; it does not exercise maximum POC
zone settings. These component budgets do not establish whole-application FPS.

### ECDD-229 authored multi-chart acceptance

ECDD-229 adds `tools/indicator-multichart-performance.mjs` to the repository's
mandatory `npm run test:performance` command. The gate builds the maintained ATR
Rope + UT Bot indicator through the real SDK v2 authoring transform, imports the
compiled package, then measures four independent indicator instances representing
four simultaneously active charts. Package compilation happens before runtime
timing starts.

The enforced workload and budgets are:

- four charts with 25,000 history bars each, 100,000 bars aggregate;
- aggregate history replay below 60,000 ms and no individual chart above that
  same history budget;
- 250 provisional rounds across four charts, 1,000 building updates total,
  completing below 5,000 ms;
- every individual provisional or finalized indicator update below the existing
  100 ms worker update budget;
- one finalized update per chart, with the four-chart finalized sweep below
  1,000 ms;
- provisional updates must keep each retained point-history array stable rather
  than cloning it.

Delivery #1038 on Ubuntu 24.04 / Node 26.8.1 measured the final clean candidate
as follows:

| ECDD-229 workload                                  | Observed time | CI budget |
| -------------------------------------------------- | ------------: | --------: |
| Four-chart history, 100,000 bars aggregate         |     12.640 s |      60 s |
| Slowest single-chart 25,000-bar history            |      3.244 s |      60 s |
| 1,000 provisional authored-indicator updates       |     85.83 ms |       5 s |
| Slowest four-chart provisional sweep               |      0.80 ms |    100 ms |
| Slowest individual provisional update              |      0.50 ms |    100 ms |
| Four-chart finalized sweep                         |      0.86 ms |       1 s |
| Slowest individual finalized update                |      0.40 ms |    100 ms |

The same CI run kept the existing authored/runtime gates green: the maintained
ATR Rope + UT Bot 100,000-bar history completed in about 10.09 seconds, its
1,000 building updates in about 67.93 ms total with a 0.48 ms maximum update,
the 100,000-bar structured-series gate in about 8.89 seconds, and the 2,000
stable-drawing/100,000-bar gate in about 28.30 seconds.

This is a real multi-instance authored **runtime** acceptance gate and is suitable
for CI/release regression detection. It is deliberately not a claim about
renderer FPS, provider/network latency, or end-to-end market-feed responsiveness.
Provider-aware MTF acquisition and per-TA timeframe execution remain owned by
ECDD-142; ECDD-229 does not duplicate that source-engine work.

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
start. ECDD-229 now enforces multi-chart authored-indicator runtime performance
in CI. Live operational profiling is still required when quantifying actual
end-user renderer FPS, provider/network latency, and a user's market-feed plus
indicator configuration.

The authored API is TypeScript/JavaScript, not a Pine parser. It currently offers
lines, horizontal lines, histograms, shapes, boxes, segments and signals.
Provider-aware MTF acquisition/per-TA execution remains ECDD-142 scope; filled
bands and table/text-label APIs are not part of this optimization acceptance.
Signal was consulted only for authoring ideas; its code and architecture were
not copied.

See [the authoring guide](INDICATOR-AUTHORING.md) and
`packages/indicator-examples/src/atr-bands.ts` for the new API. Restart the rebuilt
application and import the generated ATR Rope + UT Bot **0.1.3** package to use
its updated runtime. A source build does not replace an already installed plugin.
The ATR Bands **0.1.0** example package was also generated. Neither package was
installed into the user's live profile during this work.
