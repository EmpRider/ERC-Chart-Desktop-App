# ERC-chart Provider SDK Implementation Decisions

Version: 1.0 draft
Date: 2026-09-01
Status: Accepted implementation guidance
Owner: EmpRider
Jira: ECDD-207 under Epic ECDD-79

## Purpose

This document freezes the provider-plugin authoring model for ERC-chart before the Provider SDK and Binomo adapter are implemented. It is derived from the current desktop architecture plus behavioral/protocol evidence observed in the Signal `binomo-chart-demo.user.js` reference implementation.

The Signal userscript is evidence for how Binomo history and live data behave. Its userscript architecture, browser hooks, direct chart coupling, IndexedDB ownership, and custom chart engine are not implementation requirements for ERC-chart.

Unless superseded by a later ADR, this document is the implementation target for the public provider SDK.

## 1. Core design rule

A provider plugin has one primary responsibility:

> Translate an external market-data service into ERC-chart's normalized provider contract.

A provider plugin may know provider-specific authentication, endpoints, request formats, paging rules, WebSocket protocols, instrument identifiers, timestamp semantics, native timeframes, and safe timeframe-derivation metadata.

A provider plugin must not own ERC-chart application state such as candle storage, history gap detection, canonical series revisions, chart rendering, indicator calculation, workspace persistence, or general MTF aggregation.

Required flow:

```text
External provider
      ↓
Provider plugin
      ↓
normalized instruments / capabilities / history / live events
      ↓
Provider Runtime
      ↓
ERC Data Service
      ↓
canonical revisioned market-data state
      ├── klinecharts
      └── Indicator Runtime / ta.*
```

## 2. Minimal public provider SDK surface

The provider authoring model should have seven primary concepts/APIs:

1. `defineProvider(...)` — plugin registration, metadata, configuration declaration, and adapter factory.
2. `connect()` — establish or prepare the provider session.
3. `disconnect()` — cleanly release provider/session resources.
4. `getCapabilities()` — describe provider functionality and timeframe support.
5. `getInstruments()` — return/discover instruments that ERC-chart can offer to users.
6. `requestHistory(...)` — return normalized historical candles for one instrument/timeframe request.
7. `subscribe(...)` — start normalized live delivery and return a subscription handle.

`unsubscribe()` belongs to the returned subscription handle and is not counted as a separate top-level provider-adapter operation.

The required adapter therefore has six runtime operations. `defineProvider(...)` is the seventh author-facing SDK concept.

Conceptual target:

```ts
export interface ProviderAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getCapabilities(): Promise<ProviderCapabilities>;
  getInstruments(): Promise<readonly Instrument[]>;
  requestHistory(
    request: ProviderHistoryRequest,
  ): Promise<readonly Candle[]>;
  subscribe(
    request: ProviderSubscriptionRequest,
    sink: ProviderDataSink,
  ): Promise<ProviderSubscription>;
}

export interface ProviderSubscription {
  unsubscribe(): Promise<void>;
}
```

The exact final TypeScript spelling can evolve during implementation. The behavior and responsibility boundaries above are frozen.

### 2.1 Current implementation gap

The current `packages/provider-sdk/src/index.ts` already defines `connect`, `disconnect`, `getCapabilities`, `requestHistory`, and `subscribe`.

The public implementation target adds instrument discovery through `getInstruments()` or an equivalent provider-neutral API before the Provider SDK is considered complete.

## 3. `defineProvider(...)`

`defineProvider(...)` is the provider registration/authoring entry point.

It should let a provider package declare:

- stable provider ID and display name;
- provider/host contract compatibility;
- provider version metadata;
- provider configuration schema;
- secret/credential fields without persisting secret values in normal configuration;
- network permissions/allowlists required by the plugin;
- adapter factory.

Illustrative syntax:

```ts
export default defineProvider({
  id: "binomo",
  name: "Binomo",
  version: "1.0.0",

  config: {
    apiEndpoint: config.string(),
    websocketEndpoint: config.string(),
    token: config.secret(),
  },

  create(host, settings) {
    return new BinomoProvider(host, settings);
  },
});
```

The syntax is illustrative. The important behavior is that provider configuration is declared by the plugin while ERC-chart owns validation, UI presentation, persistence of non-secret settings, and controlled reconfiguration.

Provider plugins do not receive direct access to React UI, klinecharts, Electron renderer objects, SQLite, or workspace documents.

## 4. Provider host services

Provider adapters require controlled host capabilities, but these are supporting services rather than additional provider lifecycle methods.

A restricted provider host/context may expose capabilities such as:

```ts
interface ProviderHost {
  network: NetworkBroker;
  credentials: CredentialLease;
  logger: ProviderLogger;
  now(): number;
  reportStatus(status: ProviderStatus): void;
}
```

The exact shape remains implementation-defined.

Required security rules:

- provider network traffic goes through the ERC network broker;
- manifest-declared network permissions are enforced;
- secrets are retrieved through a controlled credential lease;
- secrets remain in Windows Credential Manager;
- provider plugins do not receive arbitrary filesystem, process, shell, Electron, or database access;
- provider logs must use host redaction rules.

The indicator-SDK rule that forbids exposing a runtime `ctx` object does not prohibit a restricted provider host capability object. Providers genuinely require network, credential, logging, and lifecycle services; indicator calculations do not.

## 5. `connect()` and `disconnect()`

### 5.1 `connect()`

`connect()` prepares the provider for requests and subscriptions.

Provider-specific work may include:

- authentication or session establishment;
- opening a WebSocket or other streaming transport;
- validating configured endpoints;
- initializing provider protocol state;
- validating credentials;
- preparing heartbeat/reconnect protocol state.

A successful `connect()` does not directly mutate chart or indicator state.

### 5.2 `disconnect()`

`disconnect()` releases provider-owned resources, including:

- sockets;
- timers;
- protocol listeners;
- authentication/session state;
- in-flight provider requests where cancellation is supported.

ERC-chart may call disconnect during provider changes, profile changes, workspace shutdown, plugin disable/uninstall, provider crash recovery, or controlled reconfiguration.

## 6. `getCapabilities()`

Provider capabilities are authoritative. ERC-chart must not invent one universal provider capability set or timeframe list.

Capabilities should describe at least:

- whether instrument discovery is supported;
- native historical timeframes;
- native live timeframes or live event modes;
- whether ticks, candles, or both can be delivered live;
- optional market fields such as volume or bid/ask where relevant;
- safe timeframe-derivation metadata when applicable;
- deterministic bar-alignment metadata required for derivation.

The existing SDK capability shape may be expanded during implementation.

Conceptual richer shape:

```ts
interface ProviderCapabilities {
  instruments: boolean;
  historicalTimeframes: readonly TimeframeId[];
  liveTimeframes: readonly TimeframeId[];
  liveTicks: boolean;
  liveCandles: boolean;
  timeframeDerivation?: {
    supported: boolean;
    baseTimeframes: readonly TimeframeId[];
    alignment: "epoch" | string;
  };
}
```

The provider supplies derivation facts. ERC Data Service owns the actual general-purpose timeframe aggregation.

### 6.1 Binomo-derived requirement

The Signal reference shows that some useful Binomo timeframes can be derived safely from a native/base timeframe using deterministic epoch-aligned buckets. For example, the reference derives 120-second and 180-second historical candles from 60-second candles.

ERC-chart should preserve the behavioral capability but move aggregation out of the Binomo provider and into Data Service. The Binomo adapter declares that such derivation is safe and supplies the required alignment/base metadata.

## 7. `getInstruments()`

Instrument discovery is required so the desktop application can populate symbol/instrument selectors without hard-coded provider-specific symbols.

Conceptual target:

```ts
interface Instrument {
  id: InstrumentId;
  symbol: string;
  name: string;
  pricePrecision?: number;
  assetClass?: string;
  currency?: string;
  isActive?: boolean;
}
```

A first implementation may return an array:

```ts
getInstruments(): Promise<readonly Instrument[]>;
```

If providers with very large catalogues require search/paging later, the API may gain a query/page form without changing the responsibility boundary.

Every normalized live or historical event must identify its instrument deterministically. ERC-chart must not rely on an assumption that the provider stream contains only the currently visible symbol.

This corrects a fragile reference behavior in the Signal Binomo userscript, where live asset messages are forwarded without an explicit symbol check in the userscript-level loop.

## 8. `requestHistory(...)`

The host asks for one normalized historical range for one instrument and timeframe.

Conceptual request:

```ts
await provider.requestHistory({
  instrumentId: "Z-CRY/IDX",
  timeframeId: "1m",
  fromMs,
  toMs,
  limit,
});
```

### 8.1 Provider responsibilities

The provider plugin owns provider-specific protocol work necessary to satisfy that request, including:

- remote URL/request construction;
- authentication headers/tokens;
- provider-specific chunk sizes;
- provider-specific backward/forward paging;
- rate-limit response interpretation;
- bounded retry/backoff required by the remote protocol;
- remote payload parsing;
- provider timestamp semantics;
- normalization into ERC candles;
- stable provider error mapping.

### 8.2 Data Service responsibilities

The provider plugin does not decide the application's overall history-cache policy.

ERC Data Service owns:

- deciding which historical ranges are missing from the canonical cache;
- persistence and cache lookup;
- gap detection across stored/canonical data;
- cross-request de-duplication;
- merge/reconciliation with live data;
- retention policy;
- canonical revisions.

Therefore the Binomo reference behavior is split deliberately:

```text
Signal userscript
  storage gap detection + Binomo paging + normalization

ERC-chart
  Data Service: cache/gap decision
  Binomo provider: Binomo paging/protocol/normalization
```

### 8.3 Binomo timestamp normalization

The Signal reference treats Binomo historical `created_at` as a candle closing timestamp and converts it to the candle opening timestamp by subtracting the timeframe duration.

That is provider-specific normalization and belongs inside the Binomo adapter before returning ERC `Candle` values.

The Data Service must receive normalized timestamps and must not contain Binomo-specific timestamp rules.

## 9. `subscribe(...)`

`subscribe(...)` establishes one logical live-data subscription requested by ERC-chart.

Conceptual form:

```ts
const subscription = await provider.subscribe(
  {
    instrumentId: "Z-CRY/IDX",
    timeframeId: "1m",
  },
  sink,
);
```

The provider converts provider-specific live messages into normalized events through the sink.

### 9.1 Tick-producing provider

For a provider such as the Binomo behavior observed in Signal:

```ts
sink.onTicks([
  {
    instrumentId: "Z-CRY/IDX",
    price: 123.45,
    timeMs: 1780000000000,
  },
]);
```

ERC Data Service then builds/updates the canonical candle for every required timeframe.

### 9.2 Candle-producing provider

A provider that natively publishes candle snapshots/updates may emit normalized candles through:

```ts
sink.onCandles(candles);
```

Data Service still validates and reconciles those events before chart/indicator consumers observe them.

### 9.3 No direct chart update

A provider must never call APIs equivalent to the Signal userscript's:

```ts
chart.updateFromTick(...);
chart.setCandles(...);
```

The desktop flow is:

```text
provider live event
      ↓
Provider Runtime
      ↓
Data Service
      ↓
canonical mutation + revision
      ├── klinecharts adapter
      └── indicator runtime
```

### 9.4 Upstream subscription ownership

Provider adapters implement subscribe/unsubscribe, but ERC Data Service/provider runtime decide when an actual upstream subscription is required.

Compatible consumers should share one canonical upstream subscription where safe.

Example:

```text
one provider BTCUSDT/1m subscription
      ↓
canonical 1m series
      ├── chart A
      ├── chart B
      ├── RSI
      └── EMA
```

The provider plugin must not need to know how many charts or indicators are consuming the canonical series.

## 10. Tick-to-candle construction

Tick-to-candle construction belongs to ERC Data Service, not provider plugins.

The Signal reference currently forwards a live rate/timestamp into `CandlestickChart.updateFromTick()`, which independently updates all configured timeframe candles. The desktop architecture preserves the behavior but relocates it to the canonical market-data layer.

Required semantics:

- determine deterministic period start for each required timeframe;
- create a building candle from the first tick of a period;
- update high/low/close on later ticks;
- finalize the old building candle when a new period begins;
- append/start the next building candle;
- publish revisioned mutations to all consumers;
- use the same canonical building candle for klinecharts and indicators.

A provider may emit a normalized tick. It must not maintain a second independent application candle truth.

## 11. Timeframe aggregation

General MTF/custom-timeframe aggregation belongs to Data Service.

The provider declares native timeframes and safe derivation metadata.

Data Service performs aggregation using deterministic provider-approved boundaries.

For example:

```text
Binomo native/base 1m
      ↓
Data Service epoch-aligned aggregation
      ├── 2m
      └── 3m
```

Historical and live derived timeframes must converge to the same boundary semantics.

A provider-specific API may still internally page native historical data, but should not expose a separate custom-candle engine to chart or indicator code.

## 12. Dynamic provider configuration

Provider configuration remains dynamic after installation.

The SDK must allow plugins to declare configuration fields and distinguish normal settings from credentials/secrets.

A required `updateConfig()` adapter method is intentionally not part of the minimal contract.

Default safe transition:

```text
user changes provider profile
      ↓
host validates normalized config
      ↓
identify affected provider instance/profile
      ↓
disconnect old adapter when required
      ↓
create/reinitialize adapter with new config
      ↓
connect
      ↓
refresh capabilities/instruments when required
      ↓
invalidate affected canonical dependencies
      ↓
restore active subscriptions
```

An optional future in-place `reconfigure()` capability may be introduced as an optimization for providers that can prove safe behavior. It is not required for SDK v1.

Changing one provider profile must not restart unrelated provider profiles.

## 13. Reconnect and failure behavior

ERC Provider Runtime owns lifecycle supervision and process-level failure isolation.

The provider adapter owns provider-protocol knowledge required to reconnect or resume correctly. The runtime may restart/recreate an adapter when necessary.

The Data Service owns canonical reconciliation after interruption:

```text
connection interruption
      ↓
provider/runtime reconnect
      ↓
Data Service identifies/requests missing range when required
      ↓
provider returns normalized repair history
      ↓
Data Service reconciles snapshot/history/live boundary
      ↓
revisioned live delivery resumes
```

Charts and indicators do not implement provider-specific reconnect logic.

A provider crash must not terminate the renderer or unrelated providers.

## 14. Explicit non-responsibilities of provider plugins

The following must stay outside provider plugins:

- klinecharts instances or rendering calls;
- React UI ownership;
- indicator calculations or `ta.*` implementation;
- indicator dependency graphs;
- canonical candle/series storage;
- SQLite access;
- workspace persistence;
- general history-gap policy;
- cross-provider cache policy;
- canonical revision generation;
- general tick-to-candle state machine;
- general MTF/custom-timeframe aggregation;
- chart/indicator subscription reference counting;
- Electron/Node/filesystem/process access beyond explicitly brokered capabilities;
- direct Windows Credential Manager access;
- signal routing/broadcasting.

If provider code needs one of these to work, the provider/runtime boundary should be reconsidered before adding another public SDK API.

## 15. Mapping from the Signal Binomo userscript

| Signal reference behavior | ERC-chart owner |
|---|---|
| `CONFIG` provider metadata/settings | `defineProvider(...)` + provider profile config |
| Binomo REST URL construction | Binomo provider |
| Binomo API chunk sizing/paging | Binomo provider |
| Binomo retry/rate-limit interpretation | Binomo provider/network policy |
| Binomo historical timestamp conversion | Binomo provider |
| WebSocket message parsing | Binomo provider |
| live `rate` + `created_at` normalization | Binomo provider -> normalized `Tick` |
| WebSocket monkey patch of Binomo page | removed; real provider connection/network broker |
| `chart.updateFromTick(...)` | Data Service canonical tick/candle state machine |
| `chart.setCandles(...)` | Data Service ingestion/cache -> renderer adapter |
| storage history bounds/gap detection | Data Service/storage |
| 2m/3m candle creation | Data Service aggregation from provider-declared base/alignment |
| chart redraw throttling | klinecharts/renderer integration |
| direct globals such as `window.demoChart` | removed from production provider contract |

## 16. Implementation requirements

### Provider SDK

- add a clean provider-definition/registration helper or equivalent stable package contract;
- keep the adapter surface minimal;
- add provider-neutral instrument discovery;
- define versioned `Instrument`, capability, history, subscription, and sink contracts;
- define configuration-schema helpers including secret fields;
- do not export privileged runtime internals as normal provider APIs;
- provide TypeScript examples for a tick provider and a candle provider.

### Provider Runtime

- instantiate adapters from validated plugin packages/profiles;
- supply brokered network, credential, logging, and status capabilities;
- supervise connect/disconnect/restart lifecycle;
- enforce manifest permissions and compatibility;
- isolate provider crashes from renderer and unrelated providers;
- multiplex logical consumer demand into upstream provider subscriptions where safe;
- restore active subscription demand after controlled reconnect/restart.

### Data Service

- own canonical normalized market-data state;
- own cache/gap decisions and persistence integration;
- own tick-to-candle construction;
- own derived timeframe aggregation;
- own revisions and deterministic snapshot/building/finalized/correction mutations;
- share canonical series between renderer and indicator runtime;
- reconcile reconnect/backfill/live boundaries without provider-specific logic.

### Binomo adapter

- implement Binomo-specific history request/chunk/paging behavior;
- normalize Binomo historical closing timestamps to ERC opening timestamps;
- implement a real provider transport path rather than browser WebSocket monkey-patching;
- normalize live Binomo asset messages with explicit instrument identity;
- declare native timeframe and safe derivation/alignment capabilities;
- avoid direct chart, storage, indicator, and MTF-aggregation dependencies.

## 17. Acceptance scenarios

The Provider SDK implementation is incomplete until automated tests cover at least:

1. A provider can be installed and instantiated using only the public provider SDK contract.
2. `getInstruments()` returns normalized instruments used by ERC selectors.
3. A provider cannot silently deliver a live event without deterministic instrument identity.
4. `requestHistory()` normalizes provider timestamps and payloads without leaking provider-specific types into Data Service.
5. Data Service decides a missing history range while the adapter only performs the provider-specific remote paging needed for that request.
6. A tick-only provider updates one canonical building candle that is observed by both klinecharts and indicator consumers.
7. A candle-producing provider can emit normalized candle updates through the same canonical Data Service boundary.
8. Two compatible chart/indicator consumers do not require duplicate upstream subscriptions unnecessarily.
9. Provider-declared safe derivation metadata allows deterministic derived timeframe aggregation in Data Service.
10. Unsupported timeframe requests fail through a stable provider-neutral error.
11. Changing provider profile configuration reconnects/recreates only the affected provider/profile when required.
12. Secrets remain in Windows Credential Manager and are accessible only through the credential lease.
13. A provider cannot access renderer/klinecharts, SQLite, workspace, filesystem, process, or Electron internals through the public SDK.
14. A provider crash does not terminate the renderer or another provider.
15. Reconnect plus gap repair reconciles history and live data before normal revisioned delivery resumes.
16. The Binomo adapter can reproduce the useful reference behaviors without requiring a Binomo browser tab or WebSocket hook.

## 18. Non-goals for this decision

This document does not freeze:

- the complete v1 `Instrument` metadata field set;
- the exact configuration DSL spelling;
- the exact provider status enum;
- whether very large instrument catalogues use pagination in v1;
- internal MessagePort envelope shapes;
- internal retry implementation shared between network broker and provider adapter;
- post-MVP trade execution/provider order APIs;
- signal-consumer APIs.

Those details may be finalized during implementation as long as the public responsibility boundaries and required behaviors in this document remain intact.
