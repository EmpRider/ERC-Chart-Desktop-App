# Application Gate Contract

## Purpose

The stable `Delivery gates` workflow exists before the application scaffold. Until a root `package.json` exists, it reports application checks as not applicable and never claims that an application build passed.

## Required Root Scripts

| Script | Owner issue | Platforms | Required behavior |
| --- | --- | --- | --- |
| `format:check` | ECDD-56 | Linux and Windows | Exit `0` only when formatting is compliant; do not modify files. |
| `lint` | ECDD-56 | Linux and Windows | Exit `0` only when strict lint rules pass. |
| `typecheck` | ECDD-56 | Linux and Windows | Exit `0` only when the complete TypeScript workspace type-checks. |
| `test:unit` | ECDD-56 | Linux and Windows | Run deterministic unit tests and fail on any test failure. |
| `test:integration` | ECDD-56 | Linux and Windows | Run isolated integration tests and fail on any test failure. |
| `build` | ECDD-54 | Linux and Windows | Build the declared workspace without publishing or signing. |
| `test:performance` | ECDD-56 | Linux and Windows | Run reproducible performance checks and fail declared regressions. |
| `audit:ci` | ECDD-56 | Linux and Windows | Run the approved dependency/security audit and fail blocking findings. |
| `version:check` | ECDD-54 | Linux and Windows | Validate version consistency without changing versions. |
| `package:win` | ECDD-62 | Windows | Build the unsigned NSIS x64 installer without publishing it. |
| `smoke:installer` | ECDD-62 | Windows | Exercise the installer smoke contract and fail unsafe or incomplete packaging. |

ECDD-54 owns the root npm workspace and application manifest. When that scaffold is created, it removes `tools/delivery-governance/package-lock.json`, includes the governance tool in the root npm workspace, and moves the governance dependency graph into the single root `package-lock.json`.

ECDD-56 owns the strict lint, type, test, audit, and performance gates. Those commands must be non-interactive and deterministic in CI.

ECDD-62 owns `package:win`, `smoke:installer`, checksum generation, tag creation, GitHub Release publication, and the release workflow. No checksum, tag, release, installer publication, or auto-update behavior is part of the governance bootstrap.

## Platform Rules

- `Application / Linux` runs for task-to-epic and epic-to-main pull requests whenever the root application manifest is present.
- `Application / Windows` runs only for an `epic/*` pull request targeting `main` when the application manifest is present.
- A skipped Windows job is valid only for task-to-epic work or when no application manifest exists.
- Cancelled jobs and missing required scripts fail the aggregate gate.
