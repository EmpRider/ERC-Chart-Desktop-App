# ECDD-60 Tabs and Layouts Design

## Scope

Add the Epic 1 workspace model and shell controls for multiple tabs and one-to-four visible chart slots. Chart rendering, provider data, indicators, persistence, and cross-window synchronization remain outside this task.

## Domain model

Workspace state lives in a renderer-owned store outside React components. A state contains ordered tabs, one active tab ID, and the next deterministic tab number. Each tab contains a layout size from 1 through 4 and exactly that many stable chart-slot IDs.

Pure actions add, select, close, and resize tabs. The model always retains at least one tab, rejects unknown IDs and invalid layout sizes, preserves existing slot IDs when resizing, and never exposes more than four slots. Closing the active tab selects the nearest surviving tab deterministically.

## React integration

The runtime creates one store and React observes it with `useSyncExternalStore`. Presentational shell props receive state and an action dispatcher; components do not implement domain transitions.

The shell adds:

- an accessible tab list with add and close controls;
- an accessible layout selector with buttons for 1, 2, 3, and 4 charts;
- a responsive grid of semantic chart-slot placeholders.

The active tab and selected layout have text-independent ARIA state. Keyboard activation uses native buttons. Slot placeholders state that market data is not yet connected and expose no fake chart functionality.

## Layout geometry

One chart fills the workspace. Two charts split evenly. Three charts use one wide primary slot above two secondary slots. Four charts use a two-by-two grid. Narrow windows stack slots vertically so every placeholder remains legible.

## Performance and verification

All transitions are O(number of tabs + 4 slots); no render loop exists yet. Unit tests exhaust action behavior and invariants. Server markup tests verify tabs, layout controls, ARIA selection, and exact slot counts. Existing sandbox/CSP Electron smoke must continue to reach the connected state.
