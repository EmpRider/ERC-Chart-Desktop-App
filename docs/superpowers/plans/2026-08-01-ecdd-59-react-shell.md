# ECDD-59 React Dark Shell Implementation Plan

**Goal:** Deliver the dark-only production React shell without exposing ECDD-60 controls.

## 1. Pin the renderer runtime

- Add exact React 19 and React DOM production dependencies.
- Add exact React type development dependencies.
- Enable `react-jsx` for the renderer TypeScript project.

## 2. Define testable shell state

- Write resolver tests for valid, missing, rejected, and malformed preload bridges.
- Implement a safe `connecting | connected | unavailable` state model.
- Ensure rejected values and private error text never reach the UI.

## 3. Build the React component

- Write server-rendered semantic structure tests first.
- Implement the header, workspace empty state, status badge, and local-session footer.
- Keep tabs, layouts, charts, settings, and provider controls absent.

## 4. Mount and style

- Replace the manual runtime entry with `createRoot` and a bridge-state effect.
- Replace development-card CSS with the full-window responsive dark shell.
- Preserve the ECDD-58 CSP and all sandbox assumptions.

## 5. Verify and deliver

- Run focused red/green tests, then all repository quality gates.
- Confirm the runtime bundle and CSP-compatible Electron smoke.
- Publish only after ECDD-58 merges, then complete current-head CodeRabbit and Qodo review before squash merge.
