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
- Added the first Pine-inspired authored SDK. Its early public recurrence helper
  was later removed by the September 15 SDK-v2 correction; current authoring uses
  top-level scalar/history semantics and compiler-managed persistent `var` state.
  Definitions, output arrays and lifecycle handling remain generated internally.
  Provisional calculations roll back to the last committed bar before each tick,
  preventing cumulative intrabar errors.

## Measured results and checks

### ECDD-241 final correction measurements — 2026-09-19

Fresh Windows measurements on the final correction task branch use the repository
performance gates rather than the historical observations below. The local
workstation runs Node 25.9.0; exact-head Delivery CI must repeat required gates
with the repository-pinned Node 26.8.1/npm 12.0.2 toolchain before promotion.

| Final correction workload                              | Fresh observation |             Enforced budget |
| ------------------------------------------------------ | ----------------: | --------------------------: |
| Authoring transform overhead                           |          36.22 ms |                      100 ms |
| Indicator package build                                |         582.24 ms |                    5,000 ms |
| Compiler history path, 100,000 bars                    |         747.76 ms | 60 s worker history ceiling |
| Runtime identity path, 100,000 bars                    |           30.47 s |                        60 s |
| Runtime identity, slowest building update              |           1.16 ms |                      100 ms |
| Worker snapshot materialization, worst total           |          42.23 ms |        60 s history ceiling |
| Dependency payload, 400,000 points                     | 1.015 s worst run |                         5 s |
| Persistent state, 100,000 bars / 4,096 items           |            5.54 s |          bounded-state gate |
| Drawings, 100,000 bars / 2,000 retained                |           26.00 s |                        60 s |
| ATR Rope + UT Bot, 100,000 bars                        |           19.84 s |                        60 s |
| ATR Rope + UT Bot, slowest building update             |           1.07 ms |                      100 ms |
| Provider-aware MTF, 100,000 chart bars                 |         672.39 ms |                        60 s |
| Renderer MTF alignment, 100,000 chart bars             |          11.57 ms |                         1 s |
| Four-chart/four-worker history, 100,000 aggregate bars |           21.84 s |                        60 s |
| Four-chart building sweep, slowest sweep               |           2.84 ms |                         5 s |
| Four-chart slowest individual building update          |           0.90 ms |                      100 ms |
| Four-chart finalized sweep                             |           7.97 ms |                         1 s |

The dedicated maintained-example stress replayed 10,000 ATR Rope + UT Bot bars
with production-like POC migration in about 2.48 seconds. Its fixture permits at
most 20 retained zones × 11 segments × two overlays = 440 overlays, so it proves
the corrected persistent-handle architecture stays comfortably inside the
unchanged 2,000-drawing safeguard without raising the cap.

The performance command begins with a scaffold step that explicitly reports
`NOT MEASURED`; that step is not treated as acceptance evidence. The measured
indicator/runtime/source/renderer/multi-chart gates that follow all completed
successfully.

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
mandatory `npm run test:performance` command. The canonical gate builds the
maintained ATR Rope + UT Bot indicator through the real SDK v2 authoring
transform, then drives four independent headless chart owners through production
`reconcilePluginIndicators` chart scoping and production
`createBrowserIndicatorRuntime` worker supervision. Each chart-scoped runtime ID
owns one supervisor-managed worker executing the production indicator
`worker-entry` against the compiled maintained plugin package.

Node `worker_threads` supplies only the host adapter needed to present the browser
Worker-style messaging surface in headless CI. Chart ownership, runtime ID
scoping, snapshot/building/rollover classification, browser-runtime supervision,
worker-entry transport and authored plugin execution use production code paths.
The headless chart objects exercise orchestration and KLineCharts indicator
lifecycle ownership but do not render pixels.

The enforced workload and budgets are:

- four chart owners and four isolated workers with 25,000 history bars each,
  100,000 bars aggregate;
- aggregate history replay below 60,000 ms and no individual chart above that
  same history budget;
- 250 provisional rounds across four charts, 1,000 building updates total,
  completing below 5,000 ms;
- every individual provisional or finalized indicator update below the existing
  100 ms worker update budget;
- one finalized rollover per chart, with the four-chart finalized sweep below
  1,000 ms;
- provisional updates must keep each retained renderer row-history array stable
  rather than cloning it.

Delivery #1047 on Ubuntu 24.04 / Node 26.8.1 measured clean head
`0553d2de66cbbfbad2d86ad957786e0840d5489d` as follows:

| ECDD-229 workload                            | Observed time | CI budget |
| -------------------------------------------- | ------------: | --------: |
| Four-chart history, 100,000 bars aggregate   |      14.247 s |      60 s |
| Slowest single-chart 25,000-bar history      |       3.580 s |      60 s |
| 1,000 provisional authored-indicator updates |     327.21 ms |       5 s |
| Slowest four-chart provisional sweep         |       5.67 ms |    100 ms |
| Slowest individual provisional update        |       2.81 ms |    100 ms |
| Four-chart finalized rollover sweep          |       5.16 ms |       1 s |
| Slowest individual finalized update          |       1.24 ms |    100 ms |

The same CI run kept the existing authored/runtime gates green: the maintained
ATR Rope + UT Bot 100,000-bar history completed in about 10.31 seconds, its
1,000 building updates in about 70.77 ms total with a 0.58 ms maximum update,
the 100,000-bar structured-series gate in about 8.91 seconds, and the 2,000
stable-drawing/100,000-bar gate in about 28.78 seconds. The authored transform
overhead measured about 5.80 ms against its 100 ms budget and package generation
about 111.05 ms against its 5,000 ms budget.

ECDD-237 extends the `indicator-history` gate with one compiler-managed
persistent object containing an opaque `plot.box()` handle. This exercises both
persistent-state reads and finalized commits through `cloneSeriesState()` while
retaining the SDK-owned handle by identity. Review-fix validation on Windows /
Node 26.8.1 measured the following against the existing worker budgets:

| ECDD-237 opaque persistent-state workload | Observed time | CI budget |
| ----------------------------------------- | ------------: | --------: |
| 100,000-bar history replay                |     769.25 ms |      60 s |
| Slowest of 1,000 building updates         |       0.05 ms |    100 ms |
| Finalized update                          |       0.01 ms |    100 ms |

This is a real multi-chart authored **runtime/orchestration** acceptance gate and
is suitable for CI/release regression detection. It is deliberately not a claim
about renderer FPS, pixel-paint latency, provider/network latency or end-to-end
market-feed responsiveness. Provider-aware MTF acquisition and per-TA timeframe
execution remain owned by ECDD-142; ECDD-229 does not duplicate that
source-engine work.

Validation completed on Delivery #1047:

- Unit suite: 550 passed, one platform-specific skip, zero failures.
- Integration suite: 148 passed, including the production-orchestration contract.
- Repository governance, Markdown lint, formatting, lint and type checking passed.
- Electron application, workspace-restart and multi-instance smokes passed.
- Build, authored performance acceptance, audit and version checks passed.
- Dependency audit reported zero vulnerabilities.

## ECDD-145 worker resilience and TA complexity gate

ECDD-145 adds an enforced finalized steady-state complexity fixture at
`tools/indicator-ta-complexity-performance.mjs`. It runs 100,000 updates per
kernel and uses a 50,000-period adversarial window for SMA, EMA, highest and
lowest. Each kernel has a deliberately loose 1,000 ms regression budget so CI
detects accidental history/window rescans without depending on workstation
micro-benchmark noise.

The fixture covers the Jira acceptance matrix directly: SMA, EMA, RSI, ATR and
crossover must retain O(1) steady-state update structure, while highest/lowest
must retain amortized O(1) behavior. Before the ECDD-145 extrema fix, the
50,000-period descending `highest` case took about 9.9-11.9 seconds for 100,000
updates because each expiration shifted the retained array prefix. The runtime
now advances a deque head and only compacts an accumulated stale prefix
occasionally, keeping both work and retained memory bounded. The local GREEN
measurement after that change was:

| Kernel    | 100,000-update time | Gate budget |
| --------- | ------------------: | ----------: |
| SMA       |             7.17 ms |    1,000 ms |
| EMA       |             5.82 ms |    1,000 ms |
| RSI       |            12.06 ms |    1,000 ms |
| ATR       |             4.46 ms |    1,000 ms |
| Crossover |             3.33 ms |    1,000 ms |
| Highest   |             8.53 ms |    1,000 ms |
| Lowest    |             9.83 ms |    1,000 ms |

Worker supervision now also enforces the existing product/resource limits at
the runtime boundary: at most 20 active indicator workers for the four-chart,
five-indicator-per-chart product maximum, at most two in-flight requests per
instance, and at most three consecutive lifecycle failures before automatic
recreation is refused. A successful calculation clears the consecutive-failure
counter; explicit instance disposal clears the disabled state so a user-driven
restart can start fresh. Lower configuration generations and lower revisions in
the current configuration are rejected before dispatch. Worker creation,
`postMessage`, timeout/crash/protocol failure, and termination paths settle
callers deterministically even when host worker methods themselves throw.

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
start. ECDD-229 now enforces production chart/worker orchestration for
multi-chart authored-indicator runtime performance in CI. Live operational
profiling is still required when quantifying actual end-user renderer FPS,
provider/network latency, and a user's market-feed plus indicator configuration.

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
