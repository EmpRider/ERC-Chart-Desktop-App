export type LayoutSize = 1 | 2 | 3 | 4;

export const maximumWorkspaces = 4 as const;

export interface ChartSlot {
  readonly id: string;
}

export interface WorkspaceTab {
  readonly id: string;
  readonly title: string;
  readonly layoutSize: LayoutSize;
  readonly slots: readonly ChartSlot[];
  readonly nextWorkspaceNumber: number;
}

export interface WorkspaceState {
  readonly tabs: readonly WorkspaceTab[];
  readonly activeTabId: string;
  readonly nextTabNumber: number;
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

function createTab(tabNumber: number): WorkspaceTab {
  const id = `tab-${tabNumber}`;
  return {
    id,
    title: `Chart ${tabNumber}`,
    layoutSize: 1,
    slots: [{ id: `${id}-chart-1` }],
    nextWorkspaceNumber: 2,
  };
}

export function createInitialWorkspace(): WorkspaceState {
  return {
    tabs: [createTab(1)],
    activeTabId: "tab-1",
    nextTabNumber: 2,
  };
}

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

function decrementLayoutSize(layoutSize: LayoutSize): LayoutSize | undefined {
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

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "add-tab": {
      const tab = createTab(state.nextTabNumber);
      return {
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        nextTabNumber: state.nextTabNumber + 1,
      };
    }
    case "select-tab":
      if (
        action.tabId === state.activeTabId ||
        !state.tabs.some((tab) => tab.id === action.tabId)
      ) {
        return state;
      }
      return { ...state, activeTabId: action.tabId };
    case "close-tab": {
      const index = state.tabs.findIndex((tab) => tab.id === action.tabId);
      if (index === -1 || state.tabs.length === 1) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.tabId);
      if (action.tabId !== state.activeTabId) return { ...state, tabs };
      const replacement = tabs[Math.min(index, tabs.length - 1)];
      if (replacement === undefined) return state;
      return { ...state, tabs, activeTabId: replacement.id };
    }
    case "add-workspace": {
      const index = state.tabs.findIndex((tab) => tab.id === action.tabId);
      if (index === -1) return state;
      const current = state.tabs[index];
      if (current === undefined) return state;
      const layoutSize = incrementLayoutSize(current.layoutSize);
      if (layoutSize === undefined) return state;
      const workspaceNumber = current.nextWorkspaceNumber;
      const updated = {
        ...current,
        layoutSize,
        slots: [
          ...current.slots,
          { id: `${current.id}-chart-${workspaceNumber}` },
        ],
        nextWorkspaceNumber: workspaceNumber + 1,
      };
      const tabs = [...state.tabs];
      tabs[index] = updated;
      return { ...state, tabs };
    }
    case "remove-workspace": {
      const tabIndex = state.tabs.findIndex((tab) => tab.id === action.tabId);
      if (tabIndex === -1) return state;
      const current = state.tabs[tabIndex];
      if (current === undefined) return state;
      const workspaceIndex = current.slots.findIndex(
        (slot) => slot.id === action.workspaceId,
      );
      if (workspaceIndex <= 0) return state;
      const layoutSize = decrementLayoutSize(current.layoutSize);
      if (layoutSize === undefined) return state;
      const updated = {
        ...current,
        layoutSize,
        slots: current.slots.filter((slot) => slot.id !== action.workspaceId),
      };
      const tabs = [...state.tabs];
      tabs[tabIndex] = updated;
      return { ...state, tabs };
    }
  }
}

export interface WorkspaceStore {
  readonly getSnapshot: () => WorkspaceState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispatch: (action: WorkspaceAction) => void;
}

export function createWorkspaceStore(
  initialState: WorkspaceState = createInitialWorkspace(),
): WorkspaceStore {
  let state = initialState;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: (): WorkspaceState => state,
    subscribe: (listener): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    dispatch: (action): void => {
      const next = workspaceReducer(state, action);
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
  };
}
