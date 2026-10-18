# ECDD-201 Development Version 2 Implementation Plan

> **Execution:** Complete these steps inline on
> `task/ECDD-201-development-version-2`, then follow the repository's reviewed
> task-to-epic and epic-to-main promotion path.

**Goal:** Publish the reviewed Epic 2 development checkpoint as the unsigned
Windows prerelease `v0.1.0-dev.2` without representing Epic 2 as complete.

**Architecture:** Keep the existing exact-SHA `master` release workflow and
packaging pipeline unchanged. Update only the release identity, its executable
contract, curated notes, and current development documentation; GitHub Actions
continues to build, smoke-test, checksum, and publish the installer.

**Tech Stack:** Node.js 24, Node test runner, Electron Builder/NSIS, GitHub
Actions, GitHub Releases.

## Constraints

- Jira issue: `ECDD-201`; parent epic: `ECDD-67`.
- Release version: `0.1.0-dev.2`; immutable tag: `v0.1.0-dev.2`.
- Installer assets:
  `ERC-Chart-Setup-0.1.0-dev.2.exe` and its `.sha256` sidecar.
- Preserve the existing unsigned, per-user, x64 NSIS packaging and automatic
  update policy.
- Describe this as a development checkpoint; stable Epic 2 release `v0.2.0`
  remains future work.
- Promote the reviewed `main` commit exactly to `master`; do not create the tag
  manually.

## Task 1: Lock the new release identity with a failing contract test

**Files:**

- Modify: `tools/packaging/packaging-contract.test.mjs`

- [ ] Change release identity, packaged-version, and checksum expectations from
      Development Version 1 to Development Version 2.
- [ ] Run `npm run build && node --test tools/packaging/packaging-contract.test.mjs`.
- [ ] Verify RED because production metadata still reports `0.1.0-dev.1`.

## Task 2: Implement the minimal metadata and release-note change

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tools/packaging/publish-release.mjs`
- Modify: `docs/development/MONOREPO.md`

- [ ] Set the root application and lockfile identity to `0.1.0-dev.2` while
      preserving internal workspace package versions.
- [ ] Curate Development Version 2 notes around the reviewed workspace controls
      and retain the security, packaging, and known-limitations context.
- [ ] Document the current release and preserve Development Version 1 as an
      immutable prior prerelease.
- [ ] Re-run the focused contract test and verify GREEN.

## Task 3: Verify and deliver through governance

- [ ] Run formatting, lint, typecheck, unit, integration, runtime build,
      performance, audit, version, governance, and diff checks.
- [ ] Open a draft task PR to the epic, collect the required current-head review
      and CI evidence, resolve findings, and squash-merge it.
- [ ] Open the epic PR to `main`, collect the required review and Windows
      packaging evidence, and merge it with a merge commit.
- [ ] Fast-forward `master` to the exact reviewed `main` commit.
- [ ] Wait for the release workflow, then independently verify the published
      tag, installer, checksum, prerelease flag, and source commit.
