# ECDD-61 Multi-Instance Implementation Plan

**Goal:** Add repeatable evidence that two ERC Chart application processes run independently.

## 1. Concurrent runner contract

- Write a test that records two process runners starting before either completes.
- Write success and one-instance failure tests.
- Implement the smallest `Promise.all` orchestration over the existing bounded process runner.

## 2. Executable harness

- Create two independent temporary user-data directories.
- Launch the same Electron entry twice with the current sandbox-enabled arguments.
- Reuse readiness, timeout, exit, and bounded diagnostic behavior.
- Remove both profiles on every outcome.

## 3. Delivery gate

- Add the stable `smoke:multi-instance` root command.
- Run it under Xvfb immediately after the single-process smoke in Linux CI.
- Keep Windows installer smoke in ECDD-62.

## 4. Verification and delivery

- Run process-focused tests and all repository gates.
- Require both Electron instances to reach ready in CI.
- Publish only after ECDD-60 merges and complete current-head machine and Qodo review before squash merge.
