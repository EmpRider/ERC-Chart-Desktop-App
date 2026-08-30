# Changelog

All notable changes to ERC Chart are documented here.

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
