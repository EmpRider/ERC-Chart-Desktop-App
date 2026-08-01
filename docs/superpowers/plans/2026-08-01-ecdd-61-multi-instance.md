# ECDD-61 Multi-Instance Implementation Plan

**Goal:** Add repeatable evidence that two ERC Chart application processes run independently.

## 1. Concurrent runner contract

- Write a test that records two process runners starting before either completes.
- Write success, one-instance failure, and rejection-aggregation tests.
- Use `Promise.allSettled` over the bounded process runners, then rethrow the
  first rejection only after every runner settles.

## 2. Executable harness

- Create two independent temporary user-data directories.
- Launch the same Electron entry twice with the current sandbox-enabled arguments.
- Reuse readiness, timeout, exit, and bounded diagnostic behavior.
- Collect profiles as each creation succeeds, remove every collected profile
  on every outcome, and preserve the original smoke failure if cleanup fails.

## 3. Delivery gate

- Add the stable `smoke:multi-instance` root command.
- Run it under Xvfb immediately after the single-process smoke in Linux CI.
- Keep Windows installer smoke in ECDD-62.

## 4. Verification and delivery

- Run process-focused tests and all repository gates.
- Require both Electron instances to reach ready in CI.
- Publish only after ECDD-60 merges and complete current-head machine and Qodo review before squash merge.
