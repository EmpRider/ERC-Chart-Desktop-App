# ECDD-58 Security Hardening Implementation Plan

**Goal:** Enforce the renderer, navigation, IPC, and package-time fuse boundaries required by Epic 1.

**Architecture:** Keep decisions pure in `@erc-chart/electron-main`, translate Electron events in the desktop adapter, and expose one packaging policy for ECDD-62. Add no runtime dependency.

## 1. Renderer CSP

- Add a unit assertion for the exact fail-closed policy and resource ordering.
- Add the CSP meta element before renderer resources.
- Verify the runtime build copies the policy unchanged.

## 2. Navigation and new-window denial

- Add predicate tests for the canonical entry and hostile URL variants.
- Add the pure navigation predicate and narrow web-contents policy types.
- Extend the desktop window adapter to install the policy immediately after BrowserWindow construction.
- Test that denied navigation is prevented and child windows are always denied.

## 3. IPC sender validation

- Change the core handler contract to receive a narrow sender description.
- Add positive main-frame and negative missing/subframe/external sender tests.
- Validate synchronously before returning runtime information.
- Translate `event.senderFrame` in the Electron adapter without exposing Electron types to the package.

## 4. Electron fuse policy

- Add an exact policy test covering every Electron v1 fuse key used by electron-builder.
- Export an immutable policy from `@erc-chart/electron-main`.
- Record that ECDD-62 must apply the object during packaging and verify the packaged binary.

## 5. Verification and delivery

- Run focused tests after each red/green cycle.
- Run format, lint, typecheck, all unit/integration tests, runtime build, performance, audit, version, and diff checks.
- Run sandbox-enabled Electron smoke in CI.
- Publish a task-to-epic PR, address current-head CodeRabbit and Qodo findings, and squash-merge only after all required gates pass.

