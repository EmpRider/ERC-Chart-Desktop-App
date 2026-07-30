# Signal Reference Feature Catalogue

Version: 1.0 draft
Purpose: Preserve the requirement that Signal-project behavior is ultimately accounted for while protecting the ERC-chart MVP boundary.

## Interpretation rules

- **Reference** means desired behavior or protocol evidence, not source reuse.
- **MVP** means required for the first usable ERC-chart release.
- **Post-MVP 1** means signal broadcasting.
- **Post-MVP 2** means replay/backtesting.
- **Post-MVP 3** means execution, trade history, and optimizer parity.
- **Not carried forward** means browser/userscript mechanics or insecure proof-of-concept behavior that must not exist in ERC-chart.

## Feature mapping

| Capability | Reference evidence | ERC-chart disposition | Notes |
|---|---|---|---|
| Binomo historical candles | `binomo-chart-demo.user.js` | MVP | Reimplement in first-party TypeScript provider |
| Binomo live ticks | userscript hook and `python/WSmimicCode.py` | MVP | Direct standalone connection; no browser hook |
| Authenticated Binomo Phoenix channels | `python/WSmimicCode.py` | MVP protocol spike | Use only if required for chart/provider capabilities |
| Backward history pagination | `binomo-chart-demo.user.js` | MVP | Preserve timestamp and gap semantics through adapter tests |
| Custom timeframe aggregation | `binomo-chart-demo.user.js` | MVP | Provider declares safe base mapping/alignment |
| Current building candle | `ChartDataManager.js`, runtime classes | MVP | Generic data-service candle builder |
| Finalized candles | core runtime/storage | MVP | Only finalized candles persisted |
| Typed-array candle storage | `CandleDataStore.js`, `CandleAccessor.js` | MVP design reference | New implementation with 100,000-candle target |
| `HL2`, `HLC3`, `OHLC4` | candle store/accessor and framework exports | MVP | Indicator SDK sources |
| Candlestick renderer | `ChartRenderer.js` | MVP | Reimplemented in new chart engine |
| Line price chart | Not implemented as a chart type | MVP new feature | Must be built |
| Area price chart | Not implemented as a chart type | MVP new feature | Must be built |
| Pointer-anchored wheel zoom | `ChartInteraction.js` | MVP parity test | Preserve user-visible behavior |
| Horizontal pan and future space | `ChartInteraction.js`, `ChartLayout.js` | MVP parity test | Preserve |
| X-axis drag/reset | `ChartInteraction.js` | MVP parity test | Preserve |
| Y-axis scale/pan/reset | `ChartInteraction.js` | MVP parity test | Preserve |
| Crosshair with time/price labels | `Crosshair.js`, `ChartRenderer.js` | MVP parity test | Preserve |
| Hover OHLC and percentage | `ChartRenderer.js` | MVP parity test | Preserve |
| Jump to latest | `ChartUI.js`, `ChartInteraction.js` | MVP parity test | Preserve |
| Timeframe switching | chart/MTF modules | MVP | Timeframes come from provider |
| Overlay indicators | `IndicatorManager.js` | MVP | Worker result rendered by host |
| Indicator panels | `IndicatorManager.js`, config UI | MVP | Configure/show/hide/resize/remove |
| Multi-timeframe indicator data | `MTFManager.js`, `MTFResolver.js` | MVP | Contract-based and provider-validated |
| Other-indicator lookup | `IndicatorWrapper.indicator()` | MVP with redesign | Use explicit instance/output binding and DAG |
| Incremental TA calculation | `BaseIndicator.js`, `ta/incremental.js` | MVP performance reference | SDK permits incremental lifecycle |
| Indicator line plot | `plot.js`, `plotLine.js` | MVP |
| Histogram | `plotHistogram.js` | MVP |
| Horizontal line | `plotHLine.js` | MVP |
| Fill/bands | `plotBands.js`, framework `fill` | MVP |
| Shapes | `plotShapes.js` | MVP |
| Boxes | `plotBox.js` | MVP |
| Text | `plotText.js` | MVP |
| Runtime plugin registration | `PluginManager.js` | Replaced in MVP | New ZIP/folder install, manifests, trust, isolation |
| Indicator settings persistence | state/settings storage | MVP | Stored in workspace/plugin settings |
| Chart/workspace state | `ChartStateManager.js` | MVP with redesign | Local versioned workspace |
| Historical IndexedDB cache | `UnifiedIndexedDBStorage.js` | Replaced in MVP | SQLite WAL desktop cache |
| Window minimize/maximize/resize | `WindowManager.js`, `ChartUI.js` | MVP through native shell | Normal desktop window behavior |
| Four charts/layouts/tabs | Not implemented in reference | MVP new feature | Max four visible per window |
| Multiple independent app instances | Not implemented in reference | MVP new feature | No single-instance lock |
| Interactive trend line | Not implemented in reference | MVP new feature | Session-only |
| Horizontal/vertical drawings | Not implemented in reference | MVP new feature | Session-only |
| Rectangle drawing | Not implemented in reference | MVP new feature | Session-only |
| Fibonacci retracement | Not implemented in reference | MVP new feature | Session-only |
| Text annotation drawing | Not implemented in reference | MVP new feature | Session-only |
| Signal creation | Base/framework signal APIs | Contract only in MVP | Delivery deferred |
| Signal broadcast/consumers | Executor/signal modules partially imply downstream flow | Post-MVP 1 | New reliable event/consumer architecture |
| Replay engine/UI | `ChartReplayEngine.js`, `ReplayUI.js` | Post-MVP 2 | Reimplement with live-like semantics |
| Backtesting engine/UI | `BacktestingEngine.js`, worker and UI | Post-MVP 2 | Separate compute and result architecture |
| Trade executor | `src/executor/` | Post-MVP 3 | Requires separate security/risk approval |
| Trade result monitoring | executor WebSocket/result modules | Post-MVP 3 |
| Trade history/P&L userscript | `trade-history-pnl.user.js` | Post-MVP 3 |
| Stake/martingale modes | backtesting/executor modules | Post-MVP 3, only if reconfirmed |
| Optimizer scripts/runs | `optimizer/` | Post-MVP 3 |
| Browser WebSocket interception | userscript and executor hook | Not carried forward | Desktop adapter connects directly |
| Hard-coded authentication cookie | Python proof of concept | Not carried forward | Rotate credential if valid |
| Disabled TLS/cipher security | Python proof of concept | Not carried forward | Production TLS validation is mandatory |
| Always-focused browser workaround | `AlwaysFocused.js` | Not carried forward directly | Desktop lifecycle uses native visibility/process handling |

## Source-review conclusions

1. The reference is a single-chart browser/userscript-oriented library, not the target desktop architecture.
2. The current renderer is candlestick-only; ERC-chart line and area chart types are new work.
3. Reference `plotLine`/`plotBox` functions are indicator rendering primitives, not interactive drawing tools.
4. Runtime plugin registration does not provide package installation, trust, permission, compatibility, or isolation.
5. Current defaults and view limits are much smaller than the ERC-chart 100,000-candle requirement.
6. The reference already contains useful correctness tests for candle storage, MTF, incremental indicators, zoom anchoring, pan/latest behavior, replay, backtesting, and execution.
7. Inspection ran the reference runtime suite: 96 tests passed. One build-assets test was blocked because Rollup was unavailable in the inspection environment.
8. No source credential value is copied into these documents.

## Parity management rule

Every reference capability must end in exactly one state:

- accepted MVP requirement with an acceptance test;
- named post-MVP backlog item;
- explicitly rejected browser/insecure behavior with a reason; or
- pending product decision with an owner.

This catalogue is updated whenever scope changes. “All Signal features eventually” does not mean “all Signal features in the MVP.”
