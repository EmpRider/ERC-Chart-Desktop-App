import {
  type ImportedProviderSession,
  type ProviderImportCredentialValues,
  type ProviderImportPreview,
  isRuntimeInfo,
  type PersistedWorkspace,
  type RuntimeInfo,
} from "@erc-chart/contracts";
import { useEffect, useState, useSyncExternalStore, type JSX } from "react";
import {
  createWorkspaceStore,
  maximumWorkspaces,
  type WorkspaceAction,
  type WorkspaceState,
  type WorkspaceStore,
} from "./workspace.js";
import {
  fromPersistedWorkspace,
  toPersistedWorkspace,
} from "./workspace-persistence.js";
import {
  PluginPermissionReview,
  type PluginPermissionReviewPresentation,
} from "./permission-review.js";
import { ProviderChart } from "./provider-chart.js";

export interface RendererBridge {
  readonly getRuntimeInfo: () => Promise<RuntimeInfo>;
  readonly loadWorkspace: () => Promise<PersistedWorkspace | null>;
  readonly saveWorkspace: (workspace: PersistedWorkspace) => Promise<void>;
  readonly flushWorkspace: () => Promise<void>;
  readonly previewProviderImport: () => Promise<ProviderImportPreview | null>;
  readonly approveProviderImport: (
    requestId: string,
    credentials?: ProviderImportCredentialValues,
  ) => Promise<ImportedProviderSession>;
  readonly cancelProviderImport: (requestId: string) => Promise<void>;
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
  readonly pluginPermissionReview?:
    PluginPermissionReviewPresentation | undefined;
  readonly providerSession?: ImportedProviderSession | undefined;
  readonly providerImportBusy?: boolean;
  readonly providerImportError?: string | undefined;
  readonly onProviderImport?: (() => void) | undefined;
}

export function ApplicationShell({
  connection,
  workspace,
  onWorkspaceAction,
  pluginPermissionReview,
  providerSession,
  providerImportBusy = false,
  providerImportError,
  onProviderImport,
}: ApplicationShellProps): JSX.Element {
  const activeTab =
    workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ??
    workspace.tabs[0];
  if (activeTab === undefined) throw new Error("Workspace unavailable.");
  const workspaceLimitReached = activeTab.layoutSize === maximumWorkspaces;

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
              onWorkspaceAction({
                type: "add-workspace",
                tabId: activeTab.id,
              })
            }
          >
            <span aria-hidden="true">+</span>
            Add workspace
          </button>
          {workspaceLimitReached ? (
            <span role="status">Maximum 4 workspaces</span>
          ) : null}
          {onProviderImport === undefined ? null : (
            <button
              type="button"
              className="provider-import"
              disabled={providerImportBusy}
              onClick={onProviderImport}
            >
              {providerImportBusy ? "Importing provider…" : "Import provider"}
            </button>
          )}
          {providerSession === undefined ? null : (
            <span className="provider-loaded" role="status">
              {providerSession.providerName} connected
            </span>
          )}
          {providerImportError === undefined ? null : (
            <span className="provider-import-error" role="alert">
              {providerImportError}
            </span>
          )}
        </div>

        <section
          className="chart-grid"
          data-layout={activeTab.layoutSize}
          aria-label={`${activeTab.title} charts`}
        >
          {activeTab.slots.map((slot, index) => (
            <article className="chart-slot" data-chart-slot key={slot.id}>
              {index > 0 ? (
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
              ) : null}
              {index === 0 && providerSession !== undefined ? (
                <ProviderChart session={providerSession} />
              ) : (
                <>
                  <div className="slot-number" aria-hidden="true">
                    {index + 1}
                  </div>
                  <p className="eyebrow">Secure desktop shell</p>
                  <h2>
                    {index === 0 ? "Workspace ready" : `Chart ${index + 1}`}
                  </h2>
                  <p className="workspace-copy">Awaiting market data</p>
                </>
              )}
            </article>
          ))}
        </section>
      </main>

      <footer className="app-footer">
        <span>Local desktop session</span>
        <span>ERC Chart alpha</span>
      </footer>
      {pluginPermissionReview === undefined ? null : (
        <PluginPermissionReview {...pluginPermissionReview} />
      )}
    </div>
  );
}

export interface RuntimeApplicationShellProps {
  readonly bridge: RendererBridge | undefined;
}

export function RuntimeApplicationShell({
  bridge,
}: RuntimeApplicationShellProps): JSX.Element {
  const [connection, setConnection] = useState(() =>
    bridge === undefined ? unavailableShellState : connectingShellState,
  );
  const [workspaceStore, setWorkspaceStore] = useState<
    WorkspaceStore | undefined
  >();
  const [workspaceLoadFailed, setWorkspaceLoadFailed] = useState(false);

  useEffect(() => {
    if (bridge === undefined) {
      setConnection(unavailableShellState);
      setWorkspaceLoadFailed(true);
      return;
    }
    let active = true;
    void Promise.all([resolveShellState(bridge), bridge.loadWorkspace()])
      .then(([state, persisted]) => {
        if (!active) return;
        let store: WorkspaceStore;
        if (persisted === null) {
          store = createWorkspaceStore();
        } else {
          const restored = fromPersistedWorkspace(persisted);
          if (restored === undefined) {
            setConnection(state);
            setWorkspaceLoadFailed(true);
            return;
          }
          store = createWorkspaceStore(restored);
        }
        setConnection(state);
        setWorkspaceStore(store);
      })
      .catch(() => {
        if (active) {
          setConnection(unavailableShellState);
          setWorkspaceLoadFailed(true);
        }
      });
    return (): void => {
      active = false;
    };
  }, [bridge]);

  if (bridge === undefined)
    return (
      <ApplicationShell
        connection={unavailableShellState}
        workspace={createWorkspaceStore().getSnapshot()}
        onWorkspaceAction={() => undefined}
      />
    );
  if (workspaceLoadFailed)
    return (
      <p role="alert">Workspace unavailable. Existing data was not changed.</p>
    );
  if (bridge === undefined || workspaceStore === undefined)
    return <p role="status">Restoring workspace…</p>;
  return (
    <HydratedRuntimeApplicationShell
      bridge={bridge}
      store={workspaceStore}
      connection={connection}
    />
  );
}

function HydratedRuntimeApplicationShell({
  bridge,
  store,
  connection,
}: {
  readonly bridge: RendererBridge;
  readonly store: WorkspaceStore;
  readonly connection: ShellConnectionState;
}): JSX.Element {
  const workspace = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [providerPreview, setProviderPreview] = useState<
    ProviderImportPreview | undefined
  >();
  const [providerSession, setProviderSession] = useState<
    ImportedProviderSession | undefined
  >();
  const [providerImportBusy, setProviderImportBusy] = useState(false);
  const [providerImportError, setProviderImportError] = useState<
    string | undefined
  >();
  const dispatch = (action: WorkspaceAction): void => {
    const before = store.getSnapshot();
    store.dispatch(action);
    const after = store.getSnapshot();
    if (after === before) return;
    void bridge
      .saveWorkspace(toPersistedWorkspace(after))
      .catch(() => undefined);
  };

  const beginProviderImport = (): void => {
    if (providerImportBusy) return;
    setProviderImportBusy(true);
    setProviderImportError(undefined);
    void bridge
      .previewProviderImport()
      .then((preview) => {
        if (preview !== null) setProviderPreview(preview);
      })
      .catch(() => {
        setProviderImportError(
          "Provider import could not be prepared. Check the package and try again.",
        );
      })
      .finally(() => setProviderImportBusy(false));
  };

  const pluginPermissionReview: PluginPermissionReviewPresentation | undefined =
    providerPreview === undefined
      ? undefined
      : {
          request: {
            requestId: providerPreview.requestId,
            pluginId: providerPreview.pluginId,
            pluginName: providerPreview.pluginName,
            pluginVersion: providerPreview.pluginVersion,
            kind: "provider",
            mode: providerPreview.mode,
            trust: providerPreview.trust,
            reason: "install",
            permissions: providerPreview.permissions,
          },
          busy: providerImportBusy,
          onDecision: (requestId, decision, credentials): void => {
            if (providerImportBusy) return;
            setProviderImportBusy(true);
            setProviderImportError(undefined);
            if (decision === "reject") {
              void bridge
                .cancelProviderImport(requestId)
                .catch(() => undefined)
                .finally(() => {
                  setProviderPreview(undefined);
                  setProviderImportBusy(false);
                });
              return;
            }
            void bridge
              .approveProviderImport(requestId, credentials)
              .then((session) => {
                setProviderSession(session);
                setProviderPreview(undefined);
              })
              .catch(() => {
                setProviderImportError(
                  "Provider could not be installed, started, or loaded.",
                );
              })
              .finally(() => setProviderImportBusy(false));
          },
        };

  return (
    <ApplicationShell
      connection={connection}
      workspace={workspace}
      onWorkspaceAction={dispatch}
      pluginPermissionReview={pluginPermissionReview}
      providerSession={providerSession}
      providerImportBusy={providerImportBusy}
      providerImportError={providerImportError}
      onProviderImport={beginProviderImport}
    />
  );
}
