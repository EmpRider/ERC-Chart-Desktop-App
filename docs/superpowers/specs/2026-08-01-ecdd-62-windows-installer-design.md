# ECDD-62 Windows installer and release design

## Scope

ECDD-62 turns the reviewed Epic 1 desktop shell into Development Version 1. The
application version is `0.1.0-dev.1`; the immutable release tag is
`v0.1.0-dev.1`. The release contains exactly the unsigned x64 NSIS installer
`ERC-Chart-Setup-0.1.0-dev.1.exe` and its `.sha256` file. Stable `v0.1.0`
remains a later release.

Automatic updates are disabled. Packaging uses `--publish never`, declares no
publish provider, disables NSIS differential packages, and does not ship
`electron-updater` or update metadata.

## Packaged application

`prepare-package` creates a clean, disposable application directory under
`out/`. It bundles the Electron main process and both utility-process entries,
copies the already-built preload and renderer assets, and writes a minimal
production `package.json`. No repository source, tests, development dependency,
or workspace symlink is packaged.

electron-builder produces one per-user, one-click NSIS x64 installer. Its
configuration consumes the immutable ECDD-58 fuse policy: Node mode, Node
options, inspector arguments, and file-protocol privileges stay disabled;
cookie encryption, ASAR integrity, and ASAR-only loading stay enabled.

## Installer verification

The Windows smoke command fails closed unless it runs on Windows and finds the
exact versioned installer. It silently installs for the current user, launches
the installed executable with an isolated profile and a bounded smoke-result
path, requires the secure renderer-ready marker and exit code zero, then runs
the uninstaller and verifies cleanup. Temporary profiles and smoke files are
removed in all outcomes.

Pure tests cover path containment, exact artifact naming, bounded process
failure, checksum formatting, and release-version parsing. The epic-to-main
Windows job performs the actual package and installer smoke.

## Release transaction

A serialized Windows workflow runs only after a push to `main`. It verifies the
exact checked-out SHA, a valid unreleased application version, all quality and
security gates, packaging, installer smoke, filename, and SHA-256 before it
creates a draft GitHub pre-release targeting that SHA. It uploads both assets
and publishes the draft only after both are present. Failures before draft
creation produce no tag or release; failures after that point leave an auditable
draft and never move an existing tag.

Release notes identify ECDD-53, Development Version 1 limitations, unsigned
status, and disabled automatic updates.
