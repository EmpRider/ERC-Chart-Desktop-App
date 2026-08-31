# ECDD-80 Provider Contract Test Kit Design

Jira: [ECDD-80](https://erc-chart.atlassian.net/browse/ECDD-80)

Parent epic: [ECDD-79](https://erc-chart.atlassian.net/browse/ECDD-79)

## Scope

Implement the provider-neutral contract fixtures, builders, and conformance
helpers reserved for `@erc-chart/testing`. The kit gives first-party and future
third-party provider implementations one stable way to prove compatibility with
provider contract version 1 before Epic 4 adds a Binomo adapter.

Manifest JSON Schema, package installation, signing policy, utility-process
supervision, permission UI, and Binomo network behavior remain outside ECDD-80.

## Public API

The testing workspace exposes four operations:

- `createProviderContractFixture` builds deterministic metadata, history,
  subscription, candle, tick, and adapter-lifecycle fixtures;
- `runProviderContractConformance` exercises provider metadata and the adapter
  connect/capabilities/history/subscribe/unsubscribe/disconnect lifecycle;
- `createProviderEnvelopeCases` supplies current, malformed, unknown-version,
  and stale-generation boundary cases; and
- `inspectProviderHistoryEnvelope` provides the reference acceptance result for
  those cases.

Reports contain stable violation codes, safe messages, and boundary paths.
Unknown provider versions and host-incompatible metadata fail before adapter
code executes. Once connected, cleanup is attempted even after an operation or
value validation failure.

## Validation boundaries

The kit verifies only frozen v1 behavior:

- provider and host compatibility versions;
- non-empty metadata identifiers;
- capability value shapes;
- history results matching the requested instrument and timeframe;
- finite timestamps, OHLC invariants, non-negative optional volume;
- subscription ticks matching the requested instrument;
- stable uppercase provider error codes; and
- response version, generation, revision, request ID, and history payload.

It deliberately does not define provider-specific symbols, timeframes,
authentication fields, endpoints, or reconnect behavior.

## Architecture

Implementation lives in `packages/testing`, which depends only on public
`@erc-chart/contracts` and `@erc-chart/provider-sdk` APIs for this task. Runtime
packages do not depend on the test kit. This preserves the frozen dependency
direction while allowing adapter and runtime test suites to reuse the fixtures.

## Verification

Focused tests cover a complete valid lifecycle, fail-closed compatibility,
malformed history, adapter failure cleanup, and the four required envelope
cases. Type fixtures prove consumers must provide branded contract identifiers
and complete provider subjects. The repository format, boundary, lint, type,
unit, integration, build, audit, version, and Electron smoke gates must remain
green.
