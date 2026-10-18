# ECDD-200 Incremental Workspace Controls Design

Jira: [ECDD-200](https://erc-chart.atlassian.net/browse/ECDD-200)

Parent epic: [ECDD-67](https://erc-chart.atlassian.net/browse/ECDD-67)

## Scope

Replace the active chart tab's numeric `1 / 2 / 3 / 4` layout selector with an
explicit **Add workspace** button. Each chart tab still starts with one visible
workspace. A user can add one workspace at a time up to four and can close only
the workspaces added after the original one.

Existing chart-tab add, select, and close behavior remains unchanged. Workspace
persistence, real chart rendering, providers, indicators, drawings, and cross-
window synchronization remain outside ECDD-200.

## Approved behavior

- A new chart tab contains one permanent primary workspace.
- **Add workspace** adds exactly one workspace to the active chart tab and makes
  no change to other tabs.
- The fourth workspace is the hard maximum. At that point the add button remains
  visible, is disabled, and exposes the hint `Maximum 4 workspaces` to pointer
  and assistive-technology users.
- Every added workspace has its own close button. The primary workspace has no
  close button and the state model rejects attempts to remove it.
- Closing an added workspace removes only that workspace, preserves every
  surviving workspace ID, and immediately re-enables the add button when the
  active tab is below the maximum.
- The responsive one-through-four grid geometry remains unchanged and is driven
  by the current workspace count.
- The numeric selector and the `N visible` label are removed.

## State model

The renderer-owned pure store remains the only owner of workspace transitions.
`set-layout` is replaced by two intent-based actions:

```typescript
type WorkspaceAction =
  | { readonly type: "add-workspace"; readonly tabId: string }
  | {
      readonly type: "remove-workspace";
      readonly tabId: string;
      readonly workspaceId: string;
    };
```

Existing tab actions remain part of the same union. Each tab keeps its current
`layoutSize` for the CSS layout contract and adds a monotonic
`nextWorkspaceNumber`. New workspace IDs use that counter instead of the array
index, so removing and re-adding a workspace never changes or duplicates a
surviving React key. `layoutSize` always equals `slots.length`.

The reducer treats an unknown tab, an unknown workspace, removal of the first
workspace, and addition at four workspaces as no-ops. This preserves the store's
existing rule that subscribers are notified only for real state changes.

## Shell and accessibility

The toolbar renders one native button labelled **Add workspace**. Below the
maximum it dispatches `add-workspace` for the active tab. At the maximum it uses
the native `disabled` attribute plus `title` and an accessible description with
the exact maximum-limit hint.

Each non-primary chart-slot article renders a native close button in its upper-
right corner. Its accessible label identifies the displayed workspace number,
and activation dispatches `remove-workspace` with the stable workspace ID.
Controls remain keyboard-operable without custom key handling. Focus and hover
styles follow the existing shell palette; disabled styling remains visibly
distinct without relying only on color.

## Alternatives considered

1. **Intent-based reducer actions (selected):** matches the UI operations,
   enforces limits in one domain layer, and supports arbitrary added-workspace
   removal without exposing invalid counts.
2. **Keep `set-layout` behind the new buttons:** smaller initial diff, but it
   cannot express which workspace was closed and would recreate slots by array
   position, weakening stable identity.
3. **Manage workspace count in React local state:** rejected because tab state,
   tests, and persistence preparation already depend on the renderer store being
   the single source of truth.

## Verification

Pure reducer tests cover one-at-a-time addition, the four-workspace limit,
primary-workspace protection, arbitrary added-workspace removal, stable IDs,
and no-op subscriber behavior. Server-rendered shell tests cover the enabled and
disabled add states, the exact limit hint, close-button visibility, removal of
the numeric selector, and exact chart-slot counts. Repository formatting, lint,
type-check, unit, integration, build, performance, audit, version, and Electron
smoke gates must remain green. No dependency or security-boundary change is
required.
