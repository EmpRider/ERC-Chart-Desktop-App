import {
  type Candle,
  type ImportedProviderSession,
  type ProviderLiveEvent,
  type ProviderLiveRequest,
  type ProviderImportCredentialValues,
  type ProviderImportPreview,
  type ProviderManagementSnapshot,
  type ProviderProfileCreateRequest,
  type ProviderProfileSummary,
  type ProviderProfileUpdateRequest,
  type ProviderSessionRequest,
  isRuntimeInfo,
  type PersistedWorkspace,
  type RuntimeInfo,
} from "@erc-chart/contracts";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
} from "react";
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
import {
  ProviderManager,
  type ProviderManagerProps,
} from "./provider-manager.js";

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
  readonly listProviderProfiles: () => Promise<ProviderManagementSnapshot>;
  readonly createProviderProfile: (
    request: ProviderProfileCreateRequest,
  ) => Promise<ImportedProviderSession>;
  readonly updateProviderProfile: (
    request: ProviderProfileUpdateRequest,
  ) => Promise<ProviderProfileSummary>;
  readonly startProviderProfile: (
    profileId: string,
  ) => Promise<ImportedProviderSession>;
  readonly loadProviderSession: (
    request: ProviderSessionRequest,
  ) => Promise<ImportedProviderSession>;
  readonly stopProviderProfile: (profileId: string) => Promise<void>;
  readonly deleteProviderProfile: (profileId: string) => Promise<void>;
  readonly subscribeProviderData: (
    request: ProviderLiveRequest,
    listener: (event: ProviderLiveEvent) => void,
  ) => Promise<() => Promise<void>>;
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
  readonly providerSessions?: readonly ImportedProviderSession[] | undefined;
  readonly onProviderSessionSelect?:
    ((tabId: string, profileId: string) => void) | undefined;
  readonly onWorkspaceTimeframeSelect?:
    | ((tabId: string, workspaceId: string, timeframeId: string) => void)
    | undefined;
  readonly onProviderManagerOpen?: (() => void) | undefined;
  readonly providerManager?: ProviderManagerProps | undefined;
}

export function ApplicationShell({
  connection,
  workspace,
  onWorkspaceAction,
  pluginPermissionReview,
  providerSession,
  providerSessions,
  onProviderSessionSelect,
  onWorkspaceTimeframeSelect,
  onProviderManagerOpen,
  providerManager,
}: ApplicationShellProps): JSX.Element {
  const availableProviderSessions =
    providerSessions ??
    (providerSession === undefined ? [] : [providerSession]);
  const activeTab =
    workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ??
    workspace.tabs[0];
  if (activeTab === undefined) throw new Error("Workspace unavailable.");
  const workspaceLimitReached = activeTab.layoutSize === maximumWorkspaces;
  const activeProviderProfileId =
    activeTab.providerProfileId ??
    activeTab.slots.find(
      (slot) =>
        slot.persisted !== undefined &&
        slot.persisted.instrumentId !== "UNCONFIGURED",
    )?.persisted?.providerProfileId;
  const providerProfileSessions = availableProviderSessions.filter(
    (session, index, sessions) =>
      sessions.findIndex(
        (candidate) => candidate.profileId === session.profileId,
      ) === index,
  );
  const activeProviderSession =
    availableProviderSessions.find(
      (session) =>
        session.profileId === activeProviderProfileId &&
        session.timeframeId === "1m",
    ) ??
    availableProviderSessions.find(
      (session) => session.profileId === activeProviderProfileId,
    );

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
          {onProviderSessionSelect !== undefined &&
          (availableProviderSessions.length > 0 ||
            activeProviderProfileId !== undefined) ? (
            <label className="tab-provider-select">
              <span>Provider</span>
              <select
                aria-label={`Provider for ${activeTab.title}`}
                value={activeProviderProfileId ?? ""}
                onChange={(event) =>
                  onProviderSessionSelect(
                    activeTab.id,
                    event.currentTarget.value,
                  )
                }
              >
                <option value="">Select provider</option>
                {activeProviderProfileId !== undefined &&
                activeProviderSession === undefined ? (
                  <option value={activeProviderProfileId}>
                    {activeProviderProfileId} (unavailable)
                  </option>
                ) : null}
                {providerProfileSessions.map((session) => (
                  <option value={session.profileId} key={session.profileId}>
                    {session.providerName} · {session.instrument.symbol}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
          {availableProviderSessions.length === 0 ? null : (
            <span className="provider-loaded" role="status">
              {availableProviderSessions.length === 1
                ? `${availableProviderSessions[0]?.providerName ?? "Provider"} connected`
                : `${availableProviderSessions.length} provider profiles connected`}
            </span>
          )}
          {onProviderManagerOpen === undefined ? null : (
            <button
              type="button"
              className="provider-manage"
              onClick={onProviderManagerOpen}
            >
              Providers
            </button>
          )}
        </div>

        <section
          className="chart-grid"
          data-layout={activeTab.layoutSize}
          aria-label={`${activeTab.title} charts`}
        >
          {activeTab.slots.map((slot, index) => {
            const slotTimeframeId =
              slot.persisted === undefined
                ? activeProviderSession?.timeframeId
                : timeframeIdForSeconds(slot.persisted.timeframeSeconds);
            const slotInstrumentId =
              slot.persisted === undefined ||
              slot.persisted.instrumentId === "UNCONFIGURED"
                ? activeProviderSession?.instrument.id
                : slot.persisted.instrumentId;
            const exactSession = availableProviderSessions.find(
              (session) =>
                session.profileId === activeProviderProfileId &&
                session.instrument.id === slotInstrumentId &&
                session.timeframeId === slotTimeframeId,
            );
            const fallbackSession =
              activeProviderSession?.instrument.id === slotInstrumentId
                ? activeProviderSession
                : undefined;
            const chartSession = exactSession ?? fallbackSession;
            return (
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
                {chartSession !== undefined ? (
                  <ProviderChart
                    session={chartSession}
                    selectedTimeframeId={
                      slotTimeframeId ?? chartSession.timeframeId
                    }
                    availableTimeframeIds={
                      chartSession.availableTimeframeIds ??
                      activeProviderSession?.availableTimeframeIds ?? [
                        chartSession.timeframeId,
                      ]
                    }
                    timeframeLoading={
                      exactSession === undefined &&
                      slotTimeframeId !== undefined &&
                      slotTimeframeId !== chartSession.timeframeId
                    }
                    onTimeframeChange={
                      onWorkspaceTimeframeSelect === undefined
                        ? undefined
                        : (timeframeId) =>
                            onWorkspaceTimeframeSelect(
                              activeTab.id,
                              slot.id,
                              timeframeId,
                            )
                    }
                  />
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
            );
          })}
        </section>
      </main>

      <footer className="app-footer">
        <span>Local desktop session</span>
        <span>ERC Chart alpha</span>
      </footer>
      {pluginPermissionReview === undefined ? null : (
        <PluginPermissionReview {...pluginPermissionReview} />
      )}
      {providerManager === undefined ? null : (
        <ProviderManager {...providerManager} />
      )}
    </div>
  );
}

function timeframeIdForSeconds(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function timeframeSecondsForId(timeframeId: string): number | undefined {
  const match = /^(\d+)(s|m|h|d)$/u.exec(timeframeId);
  if (match === null) return undefined;
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) return undefined;
  const multiplier =
    match[2] === "s"
      ? 1
      : match[2] === "m"
        ? 60
        : match[2] === "h"
          ? 3_600
          : 86_400;
  return amount * multiplier;
}

function providerSessionKey(session: ImportedProviderSession): string {
  return [session.profileId, session.instrument.id, session.timeframeId].join(
    "\u0000",
  );
}

const providerLiveCandleCacheMinimum = 500;

function mergeCandles(
  current: readonly Candle[],
  incoming: readonly Candle[],
): readonly Candle[] {
  if (incoming.length === 0) return current;
  const candlesByOpenTime = new Map<number, Candle>();
  for (const candle of current)
    candlesByOpenTime.set(candle.openTimeMs, candle);
  for (const candle of incoming)
    candlesByOpenTime.set(candle.openTimeMs, candle);
  const merged = [...candlesByOpenTime.values()].sort(
    (left, right) => left.openTimeMs - right.openTimeMs,
  );
  const limit = Math.max(providerLiveCandleCacheMinimum, current.length);
  return merged.length > limit ? merged.slice(-limit) : merged;
}

function mergeProviderSession(
  current: readonly ImportedProviderSession[],
  session: ImportedProviderSession,
): readonly ImportedProviderSession[] {
  const key = providerSessionKey(session);
  const existing = current.find(
    (candidate) => providerSessionKey(candidate) === key,
  );
  const mergedSession =
    existing === undefined
      ? session
      : {
          ...session,
          candles: mergeCandles(session.candles, existing.candles),
        };
  return [
    ...current.filter((candidate) => providerSessionKey(candidate) !== key),
    mergedSession,
  ];
}

export function mergeProviderSessionCandles(
  current: readonly ImportedProviderSession[],
  request: ProviderLiveRequest,
  candles: readonly Candle[],
): readonly ImportedProviderSession[] {
  let changed = false;
  const next = current.map((session) => {
    if (
      session.profileId !== request.profileId ||
      session.instrument.id !== request.instrumentId ||
      session.timeframeId !== request.timeframeId
    ) {
      return session;
    }
    changed = true;
    return { ...session, candles: mergeCandles(session.candles, candles) };
  });
  return changed ? next : current;
}

export function providerLiveRequestsForWorkspace(
  workspace: WorkspaceState,
): readonly ProviderLiveRequest[] {
  const requests = workspace.tabs.flatMap((tab) =>
    tab.slots.flatMap((slot) => {
      const persisted = slot.persisted;
      if (
        persisted === undefined ||
        persisted.instrumentId === "UNCONFIGURED"
      ) {
        return [];
      }
      return [
        {
          profileId: persisted.providerProfileId,
          instrumentId: persisted.instrumentId,
          timeframeId: timeframeIdForSeconds(persisted.timeframeSeconds),
        },
      ];
    }),
  );
  return requests.filter(
    (request, index) =>
      requests.findIndex(
        (candidate) =>
          providerLiveRequestKey(candidate) === providerLiveRequestKey(request),
      ) === index,
  );
}

function providerLiveRequestKey(request: ProviderLiveRequest): string {
  return JSON.stringify([
    request.profileId,
    request.instrumentId,
    request.timeframeId,
  ]);
}

function providerLiveRequestFromKey(
  key: string,
): ProviderLiveRequest | undefined {
  try {
    const value: unknown = JSON.parse(key);
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      value.some((item) => typeof item !== "string")
    ) {
      return undefined;
    }
    return {
      profileId: value[0] as string,
      instrumentId: value[1] as string,
      timeframeId: value[2] as string,
    };
  } catch {
    return undefined;
  }
}

export function providerSessionRestoreRequests(
  workspace: WorkspaceState,
  profileId: string,
  session: ImportedProviderSession,
): readonly ProviderSessionRequest[] {
  const requests = workspace.tabs
    .filter((tab) => tab.providerProfileId === profileId)
    .flatMap((tab) =>
      tab.slots.flatMap((slot) => {
        if (
          slot.persisted === undefined ||
          slot.persisted.instrumentId === "UNCONFIGURED"
        ) {
          return [];
        }
        const timeframeId = timeframeIdForSeconds(
          slot.persisted.timeframeSeconds,
        );
        if (
          session.availableTimeframeIds !== undefined &&
          !session.availableTimeframeIds.includes(timeframeId)
        ) {
          return [];
        }
        if (
          slot.persisted.instrumentId === session.instrument.id &&
          timeframeId === session.timeframeId
        ) {
          return [];
        }
        return [
          {
            profileId,
            instrumentId: slot.persisted.instrumentId,
            timeframeId,
          },
        ];
      }),
    );
  return requests.filter(
    (request, index) =>
      requests.findIndex(
        (candidate) =>
          candidate.profileId === request.profileId &&
          candidate.instrumentId === request.instrumentId &&
          candidate.timeframeId === request.timeframeId,
      ) === index,
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
  const [providerSessions, setProviderSessions] = useState<
    readonly ImportedProviderSession[]
  >([]);
  const [providerImportBusy, setProviderImportBusy] = useState(false);
  const [providerImportError, setProviderImportError] = useState<
    string | undefined
  >();
  const [providerManagerOpen, setProviderManagerOpen] = useState(false);
  const [providerManagement, setProviderManagement] =
    useState<ProviderManagementSnapshot>({
      installedProviders: [],
      profiles: [],
    });
  const [providerManagementBusy, setProviderManagementBusy] = useState(false);
  const [providerManagementError, setProviderManagementError] = useState<
    string | undefined
  >();
  const liveSubscriptions = useRef(
    new Map<
      string,
      {
        readonly request: ProviderLiveRequest;
        cancelled: boolean;
        unsubscribe: (() => Promise<void>) | undefined;
      }
    >(),
  );
  const liveRequestSignature = providerLiveRequestsForWorkspace(workspace)
    .filter((request) =>
      providerSessions.some(
        (session) =>
          session.profileId === request.profileId &&
          session.instrument.id === request.instrumentId &&
          session.timeframeId === request.timeframeId,
      ),
    )
    .map(providerLiveRequestKey)
    .sort()
    .join("\n");
  const dispatch = (action: WorkspaceAction): void => {
    const before = store.getSnapshot();
    store.dispatch(action);
    const after = store.getSnapshot();
    if (after === before) return;
    void bridge
      .saveWorkspace(toPersistedWorkspace(after))
      .catch(() => undefined);
  };
  const bindProviderSession = (
    tabId: string,
    session: ImportedProviderSession,
  ): void => {
    const match = /^(\d+)(s|m|h|d)$/u.exec(session.timeframeId);
    const amount = match === null ? 60 : Number(match[1]);
    const unit = match?.[2] ?? "s";
    const multiplier =
      unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3_600 : 86_400;
    const availableTimeframeSeconds = session.availableTimeframeIds
      ?.map(timeframeSecondsForId)
      .filter((value): value is number => value !== undefined);
    dispatch({
      type: "configure-tab-provider",
      tabId,
      providerProfileId: session.profileId,
      instrumentId: session.instrument.id,
      timeframeSeconds: amount * multiplier,
      ...(availableTimeframeSeconds === undefined
        ? {}
        : { availableTimeframeSeconds }),
    });
  };
  const upsertProviderSession = (session: ImportedProviderSession): void => {
    setProviderSessions((current) => mergeProviderSession(current, session));
  };
  const selectProviderSession = (tabId: string, profileId: string): void => {
    if (profileId.length === 0) return;
    const session =
      providerSessions.find(
        (candidate) =>
          candidate.profileId === profileId && candidate.timeframeId === "1m",
      ) ??
      providerSessions.find((candidate) => candidate.profileId === profileId);
    if (session === undefined) return;
    bindProviderSession(tabId, session);
    const requests = providerSessionRestoreRequests(
      store.getSnapshot(),
      profileId,
      session,
    );
    for (const request of requests) {
      if (
        providerSessions.some(
          (candidate) =>
            candidate.profileId === request.profileId &&
            candidate.instrument.id === request.instrumentId &&
            candidate.timeframeId === request.timeframeId,
        )
      ) {
        continue;
      }
      void bridge
        .loadProviderSession(request)
        .then(upsertProviderSession)
        .catch(() => undefined);
    }
  };

  useEffect(() => {
    const profileIds = [
      ...new Set(
        store
          .getSnapshot()
          .tabs.flatMap((tab) =>
            tab.providerProfileId === undefined ? [] : [tab.providerProfileId],
          ),
      ),
    ];
    if (profileIds.length === 0) return;

    let active = true;
    for (const profileId of profileIds) {
      void bridge
        .startProviderProfile(profileId)
        .then(async (session) => {
          if (!active) return;
          setProviderSessions((current) =>
            mergeProviderSession(current, session),
          );
          const restoreRequests = providerSessionRestoreRequests(
            store.getSnapshot(),
            profileId,
            session,
          );
          const restored = await Promise.all(
            restoreRequests.map((request) =>
              bridge.loadProviderSession(request).catch(() => undefined),
            ),
          );
          if (!active) return;
          setProviderSessions((current) =>
            restored.reduce<readonly ImportedProviderSession[]>(
              (next, restoredSession) =>
                restoredSession === undefined
                  ? next
                  : mergeProviderSession(next, restoredSession),
              current,
            ),
          );
        })
        .catch(() => undefined);
    }
    return (): void => {
      active = false;
    };
  }, [bridge, store]);

  useEffect(() => {
    const requests = liveRequestSignature
      .split("\n")
      .filter((key) => key.length > 0)
      .map(providerLiveRequestFromKey)
      .filter(
        (request): request is ProviderLiveRequest => request !== undefined,
      );
    const desired = new Map(
      requests.map((request) => [providerLiveRequestKey(request), request]),
    );

    for (const [key, current] of liveSubscriptions.current) {
      if (desired.has(key)) continue;
      liveSubscriptions.current.delete(key);
      current.cancelled = true;
      void current.unsubscribe?.().catch(() => undefined);
    }

    for (const [key, request] of desired) {
      if (liveSubscriptions.current.has(key)) continue;
      const current = {
        request,
        cancelled: false,
        unsubscribe: undefined as (() => Promise<void>) | undefined,
      };
      liveSubscriptions.current.set(key, current);
      void bridge
        .subscribeProviderData(request, (event) => {
          if (
            current.cancelled ||
            liveSubscriptions.current.get(key) !== current ||
            event.type !== "candles"
          ) {
            return;
          }
          setProviderSessions((sessions) =>
            mergeProviderSessionCandles(sessions, request, event.candles),
          );
        })
        .then((unsubscribe) => {
          if (
            current.cancelled ||
            liveSubscriptions.current.get(key) !== current
          ) {
            void unsubscribe().catch(() => undefined);
            return;
          }
          current.unsubscribe = unsubscribe;
        })
        .catch(() => {
          if (liveSubscriptions.current.get(key) === current) {
            liveSubscriptions.current.delete(key);
          }
        });
    }
  }, [bridge, liveRequestSignature]);

  useEffect(
    () => () => {
      const subscriptions = [...liveSubscriptions.current.values()];
      liveSubscriptions.current.clear();
      for (const current of subscriptions) {
        current.cancelled = true;
        void current.unsubscribe?.().catch(() => undefined);
      }
    },
    [bridge],
  );

  const bindActiveTabIfUnconfigured = (
    session: ImportedProviderSession,
  ): void => {
    const snapshot = store.getSnapshot();
    const activeTab =
      snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ??
      snapshot.tabs[0];
    const configuredProviderProfileId =
      activeTab?.providerProfileId ??
      activeTab?.slots.find(
        (slot) =>
          slot.persisted !== undefined &&
          slot.persisted.instrumentId !== "UNCONFIGURED",
      )?.persisted?.providerProfileId;
    if (activeTab !== undefined && configuredProviderProfileId === undefined) {
      bindProviderSession(activeTab.id, session);
    }
  };
  const selectWorkspaceTimeframe = (
    tabId: string,
    workspaceId: string,
    timeframeId: string,
  ): void => {
    const timeframeSeconds = timeframeSecondsForId(timeframeId);
    if (timeframeSeconds === undefined) return;
    const snapshot = store.getSnapshot();
    const tab = snapshot.tabs.find((candidate) => candidate.id === tabId);
    const slot = tab?.slots.find((candidate) => candidate.id === workspaceId);
    const profileId =
      tab?.providerProfileId ?? slot?.persisted?.providerProfileId;
    const profileSession =
      providerSessions.find(
        (session) =>
          session.profileId === profileId && session.timeframeId === "1m",
      ) ?? providerSessions.find((session) => session.profileId === profileId);
    const instrumentId =
      slot?.persisted !== undefined &&
      slot.persisted.instrumentId !== "UNCONFIGURED"
        ? slot.persisted.instrumentId
        : profileSession?.instrument.id;
    if (
      tab === undefined ||
      slot === undefined ||
      profileId === undefined ||
      instrumentId === undefined
    ) {
      return;
    }
    dispatch({
      type: "configure-workspace",
      tabId,
      workspaceId,
      persisted: {
        ...(slot.persisted ?? {
          chartType: "candlestick" as const,
          indicators: [],
        }),
        providerProfileId: profileId,
        instrumentId,
        timeframeSeconds,
      },
    });
    if (
      providerSessions.some(
        (session) =>
          session.profileId === profileId &&
          session.instrument.id === instrumentId &&
          session.timeframeId === timeframeId,
      )
    ) {
      return;
    }
    void bridge
      .loadProviderSession({ profileId, instrumentId, timeframeId })
      .then(upsertProviderSession)
      .catch(() => undefined);
  };
  const refreshProviderManagement = async (): Promise<void> => {
    setProviderManagementBusy(true);
    setProviderManagementError(undefined);
    try {
      setProviderManagement(await bridge.listProviderProfiles());
    } catch {
      setProviderManagementError("Provider profiles could not be loaded.");
      throw new Error("Provider profiles could not be loaded.");
    } finally {
      setProviderManagementBusy(false);
    }
  };
  const runProviderManagementAction = async (
    action: () => Promise<void>,
  ): Promise<void> => {
    if (providerManagementBusy) return;
    setProviderManagementBusy(true);
    setProviderManagementError(undefined);
    try {
      await action();
      setProviderManagement(await bridge.listProviderProfiles());
    } catch {
      setProviderManagementError("Provider operation failed.");
      throw new Error("Provider operation failed.");
    } finally {
      setProviderManagementBusy(false);
    }
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
                upsertProviderSession(session);
                bindActiveTabIfUnconfigured(session);
                setProviderPreview(undefined);
                if (providerManagerOpen) void refreshProviderManagement();
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
      providerSessions={providerSessions}
      onProviderSessionSelect={selectProviderSession}
      onWorkspaceTimeframeSelect={selectWorkspaceTimeframe}
      onProviderManagerOpen={() => {
        setProviderManagerOpen(true);
        void refreshProviderManagement().catch(() => undefined);
      }}
      providerManager={
        providerManagerOpen
          ? {
              snapshot: providerManagement,
              busy: providerManagementBusy,
              error: providerManagementError,
              importBusy: providerImportBusy,
              importError: providerImportError,
              onClose: () => setProviderManagerOpen(false),
              onImport: beginProviderImport,
              onRefresh: refreshProviderManagement,
              onCreate: (request) =>
                runProviderManagementAction(async () => {
                  const session = await bridge.createProviderProfile(request);
                  upsertProviderSession(session);
                  bindActiveTabIfUnconfigured(session);
                }),
              onUpdate: (request) =>
                runProviderManagementAction(async () => {
                  await bridge.updateProviderProfile(request);
                }),
              onStart: (profileId) =>
                runProviderManagementAction(async () => {
                  const session = await bridge.startProviderProfile(profileId);
                  upsertProviderSession(session);
                  bindActiveTabIfUnconfigured(session);
                }),
              onStop: (profileId) =>
                runProviderManagementAction(async () => {
                  await bridge.stopProviderProfile(profileId);
                  setProviderSessions((current) =>
                    current.filter(
                      (session) => session.profileId !== profileId,
                    ),
                  );
                }),
              onDelete: (profileId) =>
                runProviderManagementAction(async () => {
                  await bridge.deleteProviderProfile(profileId);
                  setProviderSessions((current) =>
                    current.filter(
                      (session) => session.profileId !== profileId,
                    ),
                  );
                }),
            }
          : undefined
      }
    />
  );
}
