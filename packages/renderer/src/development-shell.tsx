import { isRuntimeInfo, type RuntimeInfo } from "@erc-chart/contracts";
import { useEffect, useState, useSyncExternalStore, type JSX } from "react";
import {
  createWorkspaceStore,
  type LayoutSize,
  type WorkspaceAction,
  type WorkspaceState,
} from "./workspace.js";

export interface RendererBridge {
  readonly getRuntimeInfo: () => Promise<RuntimeInfo>;
}

export interface ShellConnectionState {
  readonly kind: "connecting" | "connected" | "unavailable";
  readonly label: string;
  readonly message: string;
}

export const connectingShellState: ShellConnectionState = {
  kind: "connecting",
  label: "Connecting secure bridge",
  message: "Verifying desktop runtime",
};

const connectedShellState: ShellConnectionState = {
  kind: "connected",
  label: "Secure bridge connected",
  message: "Desktop runtime verified",
};

const unavailableShellState: ShellConnectionState = {
  kind: "unavailable",
  label: "Shell unavailable",
  message: "The secure application bridge could not be reached.",
};

export async function resolveShellState(
  bridge: RendererBridge | undefined,
): Promise<ShellConnectionState> {
  try {
    const runtimeInfo = await bridge?.getRuntimeInfo();
    if (!isRuntimeInfo(runtimeInfo)) return unavailableShellState;
    return connectedShellState;
  } catch {
    return unavailableShellState;
  }
}

export interface ApplicationShellProps {
  readonly connection: ShellConnectionState;
  readonly workspace: WorkspaceState;
  readonly onWorkspaceAction: (action: WorkspaceAction) => void;
}

export function ApplicationShell({
  connection,
  workspace,
  onWorkspaceAction,
}: ApplicationShellProps): JSX.Element {
  const activeTab =
    workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ??
    workspace.tabs[0];
  if (activeTab === undefined) throw new Error("Workspace unavailable.");
  const layoutNames: Readonly<Record<LayoutSize, string>> = {
    1: "one",
    2: "two",
    3: "three",
    4: "four",
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            EC
          </span>
          <div>
            <h1>ERC Chart</h1>
            <p>Desktop workspace</p>
          </div>
        </div>
        <div className="runtime-state" role="status" aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          <span data-status={connection.kind}>{connection.label}</span>
          <span className="status-detail">{connection.message}</span>
        </div>
      </header>

      <main className="workspace">
        <nav className="tab-strip" aria-label="Chart workspaces">
          <div className="tab-list" role="tablist">
            {workspace.tabs.map((tab) => (
              <div className="tab-item" key={tab.id}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab.id === workspace.activeTabId}
                  onClick={() =>
                    onWorkspaceAction({ type: "select-tab", tabId: tab.id })
                  }
                >
                  {tab.title}
                </button>
                {workspace.tabs.length > 1 ? (
                  <button
                    type="button"
                    className="tab-close"
                    aria-label={`Close ${tab.title}`}
                    onClick={() =>
                      onWorkspaceAction({ type: "close-tab", tabId: tab.id })
                    }
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="add-tab"
            aria-label="Add chart tab"
            onClick={() => onWorkspaceAction({ type: "add-tab" })}
          >
            +
          </button>
        </nav>

        <div className="workspace-toolbar">
          <div
            className="layout-selector"
            role="group"
            aria-label="Chart layout"
          >
            {([1, 2, 3, 4] as const).map((layoutSize) => (
              <button
                type="button"
                key={layoutSize}
                aria-label={`Use ${layoutNames[layoutSize]} chart layout`}
                aria-pressed={activeTab.layoutSize === layoutSize}
                onClick={() =>
                  onWorkspaceAction({
                    type: "set-layout",
                    tabId: activeTab.id,
                    layoutSize,
                  })
                }
              >
                {layoutSize}
              </button>
            ))}
          </div>
          <span>{activeTab.layoutSize} visible</span>
        </div>

        <section
          className="chart-grid"
          data-layout={activeTab.layoutSize}
          aria-label={`${activeTab.title} charts`}
        >
          {activeTab.slots.map((slot, index) => (
            <article className="chart-slot" data-chart-slot key={slot.id}>
              <div className="slot-number" aria-hidden="true">
                {index + 1}
              </div>
              <p className="eyebrow">Secure desktop shell</p>
              <h2>{index === 0 ? "Workspace ready" : `Chart ${index + 1}`}</h2>
              <p className="workspace-copy">Awaiting market data</p>
            </article>
          ))}
        </section>
      </main>

      <footer className="app-footer">
        <span>Local desktop session</span>
        <span>ERC Chart alpha</span>
      </footer>
    </div>
  );
}

export interface RuntimeApplicationShellProps {
  readonly bridge: RendererBridge | undefined;
}

const runtimeWorkspaceStore = createWorkspaceStore();

export function RuntimeApplicationShell({
  bridge,
}: RuntimeApplicationShellProps): JSX.Element {
  const [connection, setConnection] = useState(() =>
    bridge === undefined ? unavailableShellState : connectingShellState,
  );
  const workspace = useSyncExternalStore(
    runtimeWorkspaceStore.subscribe,
    runtimeWorkspaceStore.getSnapshot,
    runtimeWorkspaceStore.getSnapshot,
  );

  useEffect(() => {
    if (bridge === undefined) {
      setConnection(unavailableShellState);
      return;
    }
    let active = true;
    void resolveShellState(bridge).then((state) => {
      if (active) setConnection(state);
    });
    return (): void => {
      active = false;
    };
  }, [bridge]);

  return (
    <ApplicationShell
      connection={connection}
      workspace={workspace}
      onWorkspaceAction={runtimeWorkspaceStore.dispatch}
    />
  );
}
