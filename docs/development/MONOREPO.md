# TypeScript Monorepo

## Toolchain

ERC Chart uses Node.js `24.18.1`, npm `11.9.0`, and npm workspaces. The root
`package-lock.json` is the only lockfile. Use the following clean setup:

```bash
npm ci
```

Do not run a second package manager or create lockfiles inside a workspace.

## Workspace Map

| Workspace                    | Public package                 | Responsibility                                                                  |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| `apps/desktop`               | `@erc-chart/desktop`           | Electron application composition and packaging entry                            |
| `packages/contracts`         | `@erc-chart/contracts`         | Pure versioned data shapes, error codes, capability identifiers, and validators |
| `packages/electron-main`     | `@erc-chart/electron-main`     | Lifecycle, privileged APIs, process supervision, protocols, and security policy |
| `packages/preload`           | `@erc-chart/preload`           | Narrow renderer bridge generated from allowlisted IPC contracts                 |
| `packages/renderer`          | `@erc-chart/renderer`          | React shell, chart-slot composition, UI state, and views                        |
| `packages/chart-core`        | `@erc-chart/chart-core`        | Framework-independent chart domain, viewport, rendering, and interaction        |
| `packages/data-service`      | `@erc-chart/data-service`      | Canonical market-data state, candle building, cache coordination, and revisions |
| `packages/provider-sdk`      | `@erc-chart/provider-sdk`      | Provider manifest and adapter authoring API                                     |
| `packages/provider-runtime`  | `@erc-chart/provider-runtime`  | Validated provider loading and utility-process protocol                         |
| `packages/indicator-sdk`     | `@erc-chart/indicator-sdk`     | Indicator manifest, inputs, outputs, and plot authoring API                     |
| `packages/indicator-runtime` | `@erc-chart/indicator-runtime` | Worker lifecycle, dependency graph, budgets, and output validation              |
| `packages/storage`           | `@erc-chart/storage`           | SQLite, workspace persistence, and migration APIs                               |
| `packages/testing`           | `@erc-chart/testing`           | Contract fixtures, builders, and conformance helpers                            |

Each application workspace has a strict TypeScript project and one public root
entry. Import another workspace only through its package name:

```typescript
import type { Candle } from "@erc-chart/contracts";
```

Deep imports such as `@erc-chart/contracts/src/market-data.js` and relative
imports that escape a workspace are forbidden.

## Dependency Direction

The executable contract in
`tools/workspace-boundaries/workspace-contract.json` mirrors Contract Baseline
v1. In particular:

- contracts depend on no application package;
- provider SDK, indicator SDK, and chart core may depend only on contracts;
- preload may depend only on contracts;
- provider runtime may depend only on contracts and provider SDK;
- indicator runtime may depend only on contracts and indicator SDK;
- storage may depend only on contracts;
- data service may depend only on contracts, storage, and provider SDK;
- renderer cannot depend on privileged main, provider-runtime, or storage
  internals; and
- circular workspace dependencies are forbidden.

Run `npm run boundaries:check` to validate the inventory, manifests,
dependencies, imports, project references, pinned toolchain, and one-lockfile
rule. The same validation is part of `npm run lint` and CI.

## Root Commands

| Command                        | Purpose                                                           |
| ------------------------------ | ----------------------------------------------------------------- |
| `npm run format:check`         | Verify formatting without changing files                          |
| `npm run lint`                 | Validate package boundaries and lint source/configuration files   |
| `npm run typecheck`            | Type-check every TypeScript project and contract type fixture     |
| `npm run test:unit`            | Run deterministic contract and governance unit tests              |
| `npm run test:integration`     | Exercise workspace rules against real filesystem fixtures         |
| `npm run build`                | Build every declared TypeScript project without packaging         |
| `npm run build:runtime`        | Build TypeScript plus preload, renderer, and static runtime files |
| `npm start`                    | Build and launch the Electron development shell                   |
| `npm run smoke:electron`       | Boot Electron and verify the secure renderer bridge               |
| `npm run smoke:multi-instance` | Boot two Electron processes concurrently with isolated profiles   |
| `npm run test:performance`     | Report the honest ECDD-54 scaffold performance disposition        |
| `npm run audit:ci`             | Fail on high or critical dependency vulnerabilities               |
| `npm run version:check`        | Revalidate pinned versions and package consistency                |

`package:win` and `smoke:installer` are present for the stable CI command
contract but deliberately fail with an ECDD-62 deferral message. ECDD-54 does
not build or claim an installer, and ECDD-55 preserves that deferral.

## Electron Development Shell

ECDD-55 adds the minimal executable process skeleton. `npm start` launches one
Electron instance, starts the data utility process, installs the narrow
`window.ercChart.getRuntimeInfo()` bridge, and renders deterministic dummy
content. The provider utility entry and SDK contracts are present, but no
provider is launched or connected at startup.

The renderer is sandboxed and has Node integration disabled. The preload is a
single CommonJS bundle because sandboxed preload scripts cannot load arbitrary
ES modules. The renderer receives no raw Electron or generic IPC API.

On Linux, the Electron smoke command requires a display server. CI runs it
under `xvfb-run`; a local headless environment without X11/Wayland reports the
missing display instead of hanging.

ECDD-55 does not create an installer, tag, or GitHub release. After all Epic 1
tasks and installer automation pass the approved reviews, Development Version
1 will be published as application `0.1.0-dev.1`, immutable tag
`v0.1.0-dev.1`, with the Windows `.exe` and `.sha256` assets. Stable `v0.1.0`
remains a later release.
