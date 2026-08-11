# ECDD-60 Tabs and Layouts Implementation Plan

**Goal:** Provide deterministic multi-tab workspace state and one-to-four chart layout controls.

## 1. Pure workspace state

- Write tests for initial state, add/select/close, layout expansion/reduction, invalid actions, and the four-slot maximum.
- Implement immutable state transitions and stable slot IDs.
- Expose no persistence or chart-domain fields.

## 2. External store

- Test subscribe, getSnapshot, dispatch, no-op action behavior, and unsubscribe.
- Implement a small renderer-owned store around the pure reducer.
- Keep state ownership outside React components.

## 3. Shell controls

- Add server-rendered tests for tab semantics, selected state, layout choices, and slot count.
- Add tab and layout controls using native buttons and ARIA state.
- Render honest empty chart-slot placeholders only.

## 4. Runtime and styling

- Connect the store with `useSyncExternalStore`.
- Add responsive 1/2/3/4 geometry while retaining ECDD-59 visual language.
- Preserve CSP compatibility and reduced-motion behavior.

## 5. Verification and delivery

- Run focused TDD cycles and all repository gates.
- Publish only after ECDD-59 merges.
- Require current-head Delivery, CodeRabbit, Semgrep, and Qodo evidence before squash merge.
