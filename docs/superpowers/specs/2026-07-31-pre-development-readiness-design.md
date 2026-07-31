# Pre-Development Readiness Design

## Goal

Finish only the decisions and records that must exist before application implementation starts. Do not implement Electron, TypeScript packages, provider code, chart code, storage, or UI in this change.

## Approved completion boundary

Development may start after all of the following are true:

1. The ten architecture approval checklist decisions in section 29 of the architecture specification are accepted and traceable.
2. Contract Baseline v1 freezes package names, dependency directions, boundary ownership, contract families, version identifiers, and change control.
3. Open architecture decisions have explicit owners and the latest milestone at which each must be resolved.
4. Architecture spikes that are not required for the TypeScript monorepo are explicitly deferred to the relevant implementation epic rather than treated as global blockers.
5. ECDD-56 governance work is recorded as complete through merged PR evidence.
6. The repository contains a single readiness record that states whether implementation may begin.

## Architecture acceptance

The existing architecture specification already defines the accepted product direction:

- Windows 10/11 x64 Electron desktop application;
- TypeScript with strict compiler settings;
- React dark-theme renderer;
- four visible charts per window and independent application instances;
- provider utility processes and Node-disabled indicator Web Workers;
- SQLite WAL and Windows Credential Manager;
- session-only drawings for MVP;
- signed Production Mode and explicitly enabled unsigned Developer Mode;
- Binomo protocol validation before full Binomo adapter implementation; and
- signal broadcasting, replay/backtesting, and execution deferred to Post-MVP.

The readiness change records acceptance of these existing decisions. It does not redesign them.

## Contract Baseline v1

Contract Baseline v1 is documentation-first. It freezes names and dependency directions without pretending that runtime schemas or TypeScript interfaces already exist.

The baseline defines these future workspace units:

```text
apps/desktop
packages/contracts
packages/electron-main
packages/preload
packages/renderer
packages/chart-core
packages/data-service
packages/provider-sdk
packages/provider-runtime
packages/indicator-sdk
packages/indicator-runtime
packages/storage
packages/testing
```

Allowed dependency direction is toward `packages/contracts` and other lower-level pure packages. Privileged Electron, provider, storage, and renderer internals must never leak into SDK or chart-core packages.

The contract families are versioned independently from package versions:

- Host API: `1`
- IPC: `1`
- Provider: `1`
- Indicator: `1`
- Manifest: `1`
- Workspace: `1`
- Market data: `1`
- Database schema: `1`

Changing a frozen contract requires an ADR and compatibility assessment. ECDD-54 may create the TypeScript representation of this baseline, but it may not silently rename or reverse a boundary.

## Deferred architecture gates

The following work is not required before ECDD-54 begins:

- Binomo protocol validation: before full Binomo adapter implementation in Epic 4.
- Credential Manager bridge proof: before credential persistence implementation in Epic 2.
- SQLite WAL multi-process proof: before shared database behavior is accepted in Epic 2.
- four-chart/100,000-candle benchmark: before chart-engine feature freeze in Epic 5.
- twenty-worker benchmark: before indicator-runtime feature freeze in Epic 7.
- final minimum-PC selection: after rendering and worker measurements, before release performance acceptance.

These are mandatory milestone gates, not cancelled tasks.

## Evidence and completion

The readiness record must cite:

- the architecture specification;
- Contract Baseline v1;
- the ECDD-56 merged PR and squash SHA;
- the owner/gate table for open decisions and spikes; and
- the successful governance checks for the readiness PR.

No claim of readiness is allowed until the readiness PR is merged into `epic/ECDD-53-repository-build` and the Jira evidence comments are written.
