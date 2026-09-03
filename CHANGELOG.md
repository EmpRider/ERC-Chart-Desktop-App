# Changelog

All notable changes to ERC Chart are documented here.

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

### Packaging

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
