# ECDD-61 Multi-Instance Design

## Scope

Prove that two independent ERC Chart application processes can boot concurrently. The application already omits Electron's single-instance lock; this task adds bounded executable evidence and a required Linux delivery gate rather than inventing coordination behavior.

Database sharing and SQLite WAL contention remain in Epic 2. Installer-level Windows proof remains part of the ECDD-62 and Epic 1 exit matrix.

## Harness

The multi-instance harness builds runtime assets once, creates two distinct temporary Electron user-data directories, and launches two Electron processes concurrently with the existing sandbox-enabled smoke argument contract. Each process must independently emit `ERC_CHART_SMOKE_READY` and exit zero within the existing timeout.

Distinct user-data directories prevent Chromium profile locking from obscuring the application requirement. Both processes use the same application entry and repository working directory, which proves there is no application-level singleton lock.

## Failure behavior

The harness uses `Promise.allSettled` to wait for both outcomes and then rethrows
the first failure if either process cannot start, times out, exits non-zero, or
misses the readiness marker. A timed-out runner settles only after the child
closes. Existing bounded stdout/stderr diagnostics are reused; every
successfully created temporary profile is removed after all runners settle,
without masking the original smoke failure if cleanup also fails.

## CI and verification

A new stable root command, `smoke:multi-instance`, runs after the existing single-process Electron smoke under Xvfb. Unit tests prove both runners start before either is released, both must succeed, and one rejection fails the aggregate. CI remains sandbox-enabled and uses no `--no-sandbox` bypass.
