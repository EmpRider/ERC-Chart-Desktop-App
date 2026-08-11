# ECDD-200 Incremental Workspace Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the numeric layout selector with one-at-a-time workspace add and remove controls, retaining one permanent workspace and enforcing a maximum of four per chart tab.

**Architecture:** Keep all transitions in the existing pure renderer workspace reducer. React renders intent-based controls from the active tab state and dispatches actions; the current CSS grid continues to consume `layoutSize`, which stays synchronized with the ordered stable workspace slots.

**Tech Stack:** TypeScript 6, React 19, Node.js 24 test runner, server-rendered React markup tests, CSS.

## Global Constraints

- Jira issue: `ECDD-200`; parent epic: `ECDD-67`.
- A chart tab starts with one permanent workspace.
- Add one workspace per activation, with an absolute maximum of four per tab.
- Keep the add button visible and disabled at four with the exact hint `Maximum 4 workspaces`.
- Only added workspaces expose close controls; the primary workspace cannot be removed.
- Preserve surviving workspace IDs when a workspace is closed.
- Do not change chart-tab add, select, or close behavior.
- Do not add persistence, chart data, providers, indicators, drawings, dependencies, or new privilege boundaries.

---

### Task 1: Intent-based workspace state transitions

**Files:**

- Modify: `packages/renderer/src/workspace.ts`
- Modify: `packages/renderer/test/workspace.test.mjs`
- Modify: `packages/renderer/test/workspace-types.test.ts`

**Interfaces:**

- Consumes: existing `WorkspaceState`, `WorkspaceTab`, `WorkspaceStore`, and chart-tab actions.
- Produces: `maximumWorkspaces: 4`, `WorkspaceTab.nextWorkspaceNumber`, `add-workspace`, and `remove-workspace` actions for the shell.
- Invariant: `tab.layoutSize === tab.slots.length`, `1 <= tab.slots.length <= 4`, and `tab.slots[0]` is permanent.

- [ ] **Step 1: Write failing reducer tests**

Replace the direct layout-resize test with behavioral additions and removals:

```javascript
test("adds workspaces one at a time and stops at four", () => {
  const initial = createInitialWorkspace();
  const two = workspaceReducer(initial, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  const three = workspaceReducer(two, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  const four = workspaceReducer(three, {
    type: "add-workspace",
    tabId: "tab-1",
  });

  assert.deepEqual(
    four.tabs[0].slots.map((slot) => slot.id),
    ["tab-1-chart-1", "tab-1-chart-2", "tab-1-chart-3", "tab-1-chart-4"],
  );
  assert.equal(four.tabs[0].layoutSize, 4);
  assert.equal(
    workspaceReducer(four, { type: "add-workspace", tabId: "tab-1" }),
    four,
  );
});

test("removes only added workspaces and never reuses a workspace ID", () => {
  const initial = createInitialWorkspace();
  const two = workspaceReducer(initial, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  const three = workspaceReducer(two, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  const removed = workspaceReducer(three, {
    type: "remove-workspace",
    tabId: "tab-1",
    workspaceId: "tab-1-chart-2",
  });

  assert.deepEqual(
    removed.tabs[0].slots.map((slot) => slot.id),
    ["tab-1-chart-1", "tab-1-chart-3"],
  );
  assert.equal(removed.tabs[0].layoutSize, 2);
  assert.equal(
    workspaceReducer(removed, {
      type: "remove-workspace",
      tabId: "tab-1",
      workspaceId: "tab-1-chart-1",
    }),
    removed,
  );

  const addedAgain = workspaceReducer(removed, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  assert.deepEqual(
    addedAgain.tabs[0].slots.map((slot) => slot.id),
    ["tab-1-chart-1", "tab-1-chart-3", "tab-1-chart-4"],
  );
});
```

Update the initial-state literal to include `nextWorkspaceNumber: 2`. Add unknown-tab and unknown-workspace no-op assertions. Update the subscriber test so an attempted fifth addition emits no notification.

- [ ] **Step 2: Write the failing type contract**

Replace the `set-layout` fixtures in `workspace-types.test.ts`:

```typescript
const validAddAction: WorkspaceAction = {
  type: "add-workspace",
  tabId: "tab-1",
};

const validRemoveAction: WorkspaceAction = {
  type: "remove-workspace",
  tabId: "tab-1",
  workspaceId: "tab-1-chart-2",
};

const removedLayoutAction: WorkspaceAction = {
  // @ts-expect-error Numeric layout selection is no longer a workspace action.
  type: "set-layout",
  tabId: "tab-1",
  layoutSize: 4,
};

void validAddAction;
void validRemoveAction;
void removedLayoutAction;
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
npm run build && node --test packages/renderer/test/workspace.test.mjs
```

Expected: FAIL because `add-workspace` and `remove-workspace` are not handled and `nextWorkspaceNumber` is absent. The type-check also fails because the new action names are outside `WorkspaceAction`.

- [ ] **Step 4: Implement minimal reducer behavior**

In `workspace.ts`, export the maximum, add the monotonic counter, replace `set-layout`, and update only the addressed tab:

```typescript
export const maximumWorkspaces = 4 as const;

export interface WorkspaceTab {
  readonly id: string;
  readonly title: string;
  readonly layoutSize: LayoutSize;
  readonly slots: readonly ChartSlot[];
  readonly nextWorkspaceNumber: number;
}

export type WorkspaceAction =
  | { readonly type: "add-tab" }
  | { readonly type: "select-tab"; readonly tabId: string }
  | { readonly type: "close-tab"; readonly tabId: string }
  | { readonly type: "add-workspace"; readonly tabId: string }
  | {
      readonly type: "remove-workspace";
      readonly tabId: string;
      readonly workspaceId: string;
    };
```

Use exhaustive helpers that return the next valid closed-domain size:

```typescript
function incrementLayoutSize(layoutSize: LayoutSize): LayoutSize | undefined {
  switch (layoutSize) {
    case 1:
      return 2;
    case 2:
      return 3;
    case 3:
      return 4;
    case 4:
      return undefined;
  }
}

function decrementLayoutSize(layoutSize: LayoutSize): LayoutSize {
  switch (layoutSize) {
    case 4:
      return 3;
    case 3:
      return 2;
    case 2:
    case 1:
      return 1;
  }
}
```

`add-workspace` appends `${tab.id}-chart-${tab.nextWorkspaceNumber}` only when an increment exists, then increments `nextWorkspaceNumber`. `remove-workspace` rejects index `0` and unknown IDs, filters the addressed slot, and decrements `layoutSize`. Both actions return the original state for every invalid or limit case.

- [ ] **Step 5: Run focused tests and type-check to verify GREEN**

Run:

```bash
npm run build
node --test packages/renderer/test/workspace.test.mjs
npm run typecheck
```

Expected: all focused tests pass and TypeScript reports no errors.

- [ ] **Step 6: Commit the state transition**

```bash
git add packages/renderer/src/workspace.ts packages/renderer/test/workspace.test.mjs packages/renderer/test/workspace-types.test.ts
git commit -m "ECDD-200: add incremental workspace state"
```

### Task 2: Accessible add and close controls

**Files:**

- Modify: `packages/renderer/src/development-shell.tsx`
- Modify: `packages/renderer/test/development-shell.test.mjs`
- Modify: `apps/desktop/static/styles.css`

**Interfaces:**

- Consumes: `maximumWorkspaces`, `add-workspace`, `remove-workspace`, active `WorkspaceTab.layoutSize`, and stable slot IDs from Task 1.
- Produces: one toolbar add button, a maximum-limit hint, and one close button for each non-primary chart slot.

- [ ] **Step 1: Write failing shell markup tests**

Replace the numeric-layout shell test with these observable contracts:

```javascript
test("renders one enabled add control and no close control initially", () => {
  const markup = renderShell(connectingShellState);

  assert.match(markup, />Add workspace<\/button>/);
  assert.doesNotMatch(markup, /Add workspace<\/button>[^]*disabled/);
  assert.doesNotMatch(markup, /Close workspace/);
  assert.doesNotMatch(markup, /Use (?:one|two|three|four) chart layout/);
});

test("disables addition at four and exposes close controls for added workspaces", () => {
  let workspace = createInitialWorkspace();
  for (let index = 0; index < 3; index += 1) {
    workspace = workspaceReducer(workspace, {
      type: "add-workspace",
      tabId: "tab-1",
    });
  }
  const markup = renderShell(connectingShellState, workspace);

  assert.match(markup, /disabled=""/);
  assert.match(markup, /title="Maximum 4 workspaces"/);
  assert.equal((markup.match(/aria-label="Close workspace /g) ?? []).length, 3);
  assert.equal((markup.match(/data-chart-slot=/g) ?? []).length, 4);
});
```

Keep the exact attribute-order matching flexible: assert semantics separately,
not one complete generated opening tag.

- [ ] **Step 2: Run the shell test and verify RED**

Run:

```bash
npm run build && node --test packages/renderer/test/development-shell.test.mjs
```

Expected: FAIL because the numeric selector is still present and chart slots have no close controls.

- [ ] **Step 3: Implement the shell controls**

Import `maximumWorkspaces`, remove `LayoutSize` and `layoutNames`, and derive the limit from the active tab:

```tsx
const workspaceLimitReached = activeTab.layoutSize === maximumWorkspaces;
```

Replace the selector with:

```tsx
<div className="workspace-toolbar">
  <button
    type="button"
    className="workspace-add"
    disabled={workspaceLimitReached}
    title={workspaceLimitReached ? "Maximum 4 workspaces" : undefined}
    aria-label={
      workspaceLimitReached
        ? "Add workspace. Maximum 4 workspaces"
        : "Add workspace"
    }
    onClick={() =>
      onWorkspaceAction({ type: "add-workspace", tabId: activeTab.id })
    }
  >
    <span aria-hidden="true">+</span>
    Add workspace
  </button>
  {workspaceLimitReached ? (
    <span role="status">Maximum 4 workspaces</span>
  ) : null}
</div>
```

Inside each chart-slot article, before the slot number, render a close button only when `index > 0`:

```tsx
{
  index > 0 ? (
    <button
      type="button"
      className="workspace-close"
      aria-label={`Close workspace ${index + 1}`}
      onClick={() =>
        onWorkspaceAction({
          type: "remove-workspace",
          tabId: activeTab.id,
          workspaceId: slot.id,
        })
      }
    >
      ×
    </button>
  ) : null;
}
```

- [ ] **Step 4: Style enabled, disabled, focus, and close states**

Remove `.layout-selector` rules. Add focused rules without introducing images, fonts, animations, or inline styles:

```css
.workspace-add {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #1d2b40;
  border-radius: 0.5rem;
  background: #0a111c;
  color: #8998ac;
  cursor: pointer;
}

.workspace-add:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.workspace-close {
  position: absolute;
  top: 0.7rem;
  right: 0.7rem;
  display: grid;
  width: 1.8rem;
  height: 1.8rem;
  place-items: center;
  border: 1px solid #24344a;
  border-radius: 0.4rem;
  background: #0a111c;
  color: #8998ac;
  cursor: pointer;
}
```

Include `.workspace-add:not(:disabled):hover`, `.workspace-add:focus-visible`,
`.workspace-close:hover`, and `.workspace-close:focus-visible` in the existing
high-contrast focus treatment.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npm run build
node --test packages/renderer/test/development-shell.test.mjs packages/renderer/test/workspace.test.mjs
npm run typecheck
```

Expected: all focused behavior and type tests pass with no warnings or failures.

- [ ] **Step 6: Commit the shell controls**

```bash
git add packages/renderer/src/development-shell.tsx packages/renderer/test/development-shell.test.mjs apps/desktop/static/styles.css
git commit -m "ECDD-200: replace layout selector with workspace controls"
```

## Final verification

- [ ] Run `npm run format:check`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run test:unit`.
- [ ] Run `npm run test:integration` with a writable Electron cache.
- [ ] Run `npm run build`.
- [ ] Run `npm run smoke:electron` and `npm run smoke:multi-instance` on a display-capable environment; otherwise rely on the unchanged CI Linux smoke gates and state the local display limitation.
- [ ] Run `npm run test:performance`.
- [ ] Run `npm run audit:ci`.
- [ ] Run `npm run version:check`.
- [ ] Run repository governance validation from a clean generated-output state.
- [ ] Inspect `git diff --check`, the complete diff, and task-to-epic PR scope before publishing.
