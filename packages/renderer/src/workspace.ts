export type LayoutSize = 1 | 2 | 3 | 4;

export interface ChartSlot {
  readonly id: string;
}

export interface WorkspaceTab {
  readonly id: string;
  readonly title: string;
  readonly layoutSize: LayoutSize;
  readonly slots: readonly ChartSlot[];
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
  | {
      readonly type: "set-layout";
      readonly tabId: string;
      readonly layoutSize: LayoutSize;
    };

function createTab(tabNumber: number): WorkspaceTab {
  const id = `tab-${tabNumber}`;
  return {
    id,
    title: `Chart ${tabNumber}`,
    layoutSize: 1,
    slots: [{ id: `${id}-chart-1` }],
  };
}

export function createInitialWorkspace(): WorkspaceState {
  return {
    tabs: [createTab(1)],
    activeTabId: "tab-1",
    nextTabNumber: 2,
  };
}

function isLayoutSize(value: number): value is LayoutSize {
  return Number.isInteger(value) && value >= 1 && value <= 4;
}

function resizeTab(tab: WorkspaceTab, layoutSize: LayoutSize): WorkspaceTab {
  if (tab.layoutSize === layoutSize) return tab;
  const slots = Array.from({ length: layoutSize }, (_, index) =>
    tab.slots[index] === undefined
      ? { id: `${tab.id}-chart-${index + 1}` }
      : tab.slots[index],
  );
  return { ...tab, layoutSize, slots };
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
    case "set-layout": {
      if (!isLayoutSize(action.layoutSize)) return state;
      const index = state.tabs.findIndex((tab) => tab.id === action.tabId);
      if (index === -1) return state;
      const current = state.tabs[index];
      if (current === undefined) return state;
      const resized = resizeTab(current, action.layoutSize);
      if (resized === current) return state;
      const tabs = [...state.tabs];
      tabs[index] = resized;
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
