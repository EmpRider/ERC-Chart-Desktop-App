# ECDD-80 Provider Contract Test Kit Implementation Plan

**Goal:** Provide reusable v1 provider fixtures and conformance helpers for
first-party and third-party adapters.

**Architecture:** Implement the kit in the existing `@erc-chart/testing`
workspace using only public contracts and provider SDK APIs. Keep production
runtime packages independent from testing code.

## Constraints

- Provider-neutral; no Binomo fields or network behavior.
- No new external dependency.
- Unknown versions and stale generations fail closed.
- Adapter cleanup runs after connected-operation failures.
- Standard repository gates include the new test suite.

## Tasks

- [x] Add the testing workspace's public provider-contract API.
- [x] Add deterministic metadata, market-data, and adapter fixtures.
- [x] Add metadata, capabilities, history, tick, and lifecycle conformance.
- [x] Add current, malformed, unknown-version, and stale-generation cases.
- [x] Add runtime and TypeScript contract tests.
- [x] Add the testing suite to `test:unit`.
- [ ] Run the focused and full repository verification matrix.
- [ ] Commit and open the ECDD-80 task PR against the ECDD-79 epic branch.
