# Changelog

All notable changes to ERC Chart are documented here.

## [0.3.5] - 2026-09-06

### Plugin Manager redesign

- Replaced the provider-only management flow with a dedicated Plugin Manager
  for both provider and indicator plugins.
- Added separate Installed Providers and Installed Profiles views so provider
  metadata, profile selection, profile editing, lifecycle controls, and profile
  creation follow the same list-on-the-left/detail-on-the-right workflow.
- Added ZIP and folder import entry points for both provider and indicator
  plugins through the existing secure staging path.
- Kept indicator instance parameters in the chart settings UI while exposing
  installed indicator metadata and declared parameters in Plugin Manager.
- Kept provider connection status visible beside the secure bridge status in
  the application header.

### v0.3.5 release packaging

- Unsigned x64 per-user Windows installer.
- Automatic updates and production code signing remain unavailable.

## [0.3.4] - 2026-09-06

### Chart controls and indicator runtime

- Expanded the KLineCharts workspace controls with chart-native timeframes,
  chart types, timezone selection, drawing tools, screenshots, and fullscreen
  behavior while preserving independent workspace state.
- Added the indicator plugin import/runtime path, SDK metadata-driven settings,
  persisted indicator instances, and the ATR Rope + UT Bot example package.
- Added grouped Inputs/Style indicator settings and runtime presentation metadata
  for dynamic colors and line widths.
- Fixed ATR Rope and UT Bot color-transition gaps by keeping each logical line on
  one continuous series and rendering clean line joins across state changes.

### v0.3.4 release packaging

- Unsigned x64 per-user Windows installer.
- Automatic updates and production code signing remain unavailable.

## [0.3.3] - 2026-09-04

### Realtime background-chart hotfix

- Kept live provider demand active for configured workspaces across inactive
  chart tabs and retained incoming candles in renderer state while chart views
  are unmounted.
- Reconciled live subscriptions incrementally so loading another timeframe does
  not tear down and recreate healthy provider streams.
- Prevented cancelled Binomo polls from emitting late candles and made the
  provider utility ignore late events for retired subscription IDs instead of
  terminating the provider process.

### v0.3.3 hotfix release packaging

- Unsigned x64 per-user Windows installer.
- Automatic updates and production code signing remain unavailable.

## [0.3.2] - 2026-09-04

### Provider management and live data

- Added provider profile management across the desktop UI and runtime for
  creating, editing, starting, stopping, restarting, and removing profiles while
  keeping credential values out of renderer-visible state.
- Added renderer-owned live provider subscriptions with automatic cleanup when a
  renderer closes and incremental candle forwarding into KLineCharts.
- Persisted provider bindings and per-workspace timeframes, restored referenced
  provider profiles during workspace hydration, and preserved independent chart
  workspace settings.
- Extended Binomo provider/runtime handling and regression coverage for the live
  data path.

### v0.3.2 corrective release packaging

- Unsigned x64 per-user Windows installer.
- Automatic updates and production code signing remain unavailable.

## [0.3.1] - 2026-09-03

### Binomo provider patch

- Added the importable Binomo provider package and the desktop flow for provider
  permission review, secure credential entry, installation, startup, instrument
  discovery, and initial candle loading.
- Preserved migrated historical-candle timestamp semantics and added brokered
  authenticated WebSocket live updates with compressed tick handling, with REST
  polling available when no Binomo cookie is supplied.
- Stored credential values through Windows Credential Manager rather than
  provider settings.

### v0.3.1 corrective release packaging

- Unsigned x64 per-user Windows installer.
- Automatic updates and production code signing remain unavailable.

## [0.3.0] - 2026-09-03

### Provider SDK and plugin runtime

- Added the public Provider SDK v1 authoring contract, configuration helpers,
  compatibility metadata, and provider contract conformance kit.
- Added secure provider package staging, integrity/trust validation, permission
  review, versioned install/activation/rollback, and isolated utility-process
  supervision.
- Added profile-scoped provider configuration with controlled restart/reconnect
  lifecycle and brokered network/credential host services.
- Bridged provider instrument discovery, capabilities, historical candles, and
  live tick/candle subscriptions into the provider-neutral Data Service.
- Added public-SDK-only tick and candle provider examples plus end-to-end import,
  startup, conformance, and failure-cleanup regression coverage.

### Provider SDK release packaging

- Unsigned x64 per-user Windows installer.
- Automatic updates and production code signing remain unavailable.

## [0.2.3] - 2026-09-01

### Architecture changes

- Replaced the empty custom chart-core workspace with pinned `klinecharts` 10.0.3.
- Aligned workspace boundaries, TypeScript references, architecture decisions,
  implementation backlog, and drawing requirements with the klinecharts
  integration path.
- Retained provider and indicator SDK/runtime boundaries; chart rendering and
  drawing implementation remain later work.

### Architecture release packaging

- Unsigned x64 per-user Windows installer.
- Automatic updates and production code signing remain unavailable.

## [0.2.2] - 2026-08-31

### Fixed

- Persisted workspace identities, chart fields, and layout orientation across app
  restarts.
- Added safe validation for persisted workspace data and serialized pending saves.

### Workspace persistence release packaging

- Unsigned x64 per-user Windows installer.
- Automatic updates and production code signing remain unavailable.

## [0.2.1] - 2026-08-30

### Changed

- Updated the supported runtime and direct development dependencies to their
  latest stable versions, including Node.js 26.8.1, npm 12.0.2, Electron
  44.0.0, TypeScript 7.0.2 native compilation, and React 19.2.8.
- Updated TypeScript project configuration and package-script policy for the
  upgraded toolchain.
- Hardened workspace validation for malformed project references.

### Corrective release packaging

- Unsigned x64 per-user Windows installer.
- Automatic updates and production code signing remain unavailable.

## [0.2.0] - 2026-08-26

### Added

- SQLite schema migrations, WAL durability safeguards, transactional writes,
  corruption recovery, and concurrent candle access.
- Provider-profile metadata, Windows Generic Credential storage, persistent
  settings and plugin registry state.
- Workspace version 1 serialization and restoration.
- Redacted rotating diagnostics and plaintext-secret containment checks.

### Packaging

- Unsigned x64 per-user Windows installer.
- Automatic updates and production code signing remain unavailable.

## [0.1.0-dev.2] - 2026-08-24

- Added incremental workspace controls and published Development Version 2.

## [0.1.0-dev.1] - 2026-08-11

- Published the initial secure desktop shell development release.
