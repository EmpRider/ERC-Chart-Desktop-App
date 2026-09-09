import { useEffect, useMemo, useState, type FormEvent, type JSX } from "react";
import type {
  InstalledIndicatorSummary,
  PluginImportSourceKind,
  ProviderManagementSnapshot,
  ProviderProfileCreateRequest,
  ProviderProfileSettings,
  ProviderProfileSummary,
  ProviderProfileUpdateRequest,
} from "@erc-chart/contracts";

type PluginManagerTab = "providers" | "indicators";
type ProviderManagerSection = "providers" | "profiles";

export interface PluginManagerProps {
  readonly snapshot: ProviderManagementSnapshot;
  readonly indicators: readonly InstalledIndicatorSummary[];
  readonly busy?: boolean;
  readonly error?: string | undefined;
  readonly providerImportBusy?: boolean;
  readonly providerImportError?: string | undefined;
  readonly indicatorImportBusy?: boolean;
  readonly indicatorImportError?: string | undefined;
  readonly onClose: () => void;
  readonly onProviderImport: (sourceKind: PluginImportSourceKind) => void;
  readonly onIndicatorImport: (sourceKind: PluginImportSourceKind) => void;
  readonly onIndicatorRemove: (pluginId: string) => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onCreate: (request: ProviderProfileCreateRequest) => Promise<void>;
  readonly onUpdate: (request: ProviderProfileUpdateRequest) => Promise<void>;
  readonly onStart: (profileId: string) => Promise<void>;
  readonly onStop: (profileId: string) => Promise<void>;
  readonly onDelete: (profileId: string) => Promise<void>;
}

function parseSettings(value: string): ProviderProfileSettings {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Settings must be a JSON object.");
  }
  const settings: Record<string, boolean | number | string> = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (
      typeof item !== "boolean" &&
      typeof item !== "string" &&
      !(typeof item === "number" && Number.isFinite(item))
    ) {
      throw new Error(`Setting ${key} must be a string, number, or boolean.`);
    }
    settings[key] = item;
  }
  return settings;
}

function credentialsFromForm(
  form: HTMLFormElement,
  keys: readonly string[],
): Readonly<Record<string, string>> {
  const data = new FormData(form);
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = data.get(`credential:${key}`);
      return typeof value === "string" && value.length > 0
        ? [[key, value]]
        : [];
    }),
  );
}

function ProfileEditor({
  profile,
  busy,
  onUpdate,
  onStart,
  onStop,
  onDelete,
}: {
  readonly profile: ProviderProfileSummary;
  readonly busy: boolean;
  readonly onUpdate: PluginManagerProps["onUpdate"];
  readonly onStart: PluginManagerProps["onStart"];
  readonly onStop: PluginManagerProps["onStop"];
  readonly onDelete: PluginManagerProps["onDelete"];
}): JSX.Element {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [settingsText, setSettingsText] = useState(() =>
    JSON.stringify(profile.settings, null, 2),
  );
  const [formError, setFormError] = useState<string>();

  useEffect(() => {
    setDisplayName(profile.displayName);
    setSettingsText(JSON.stringify(profile.settings, null, 2));
  }, [profile.displayName, profile.settings]);

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    try {
      const settings = parseSettings(settingsText);
      const credentials = credentialsFromForm(
        event.currentTarget,
        profile.credentialKeys,
      );
      void onUpdate({
        profileId: profile.profileId,
        displayName,
        settings,
        ...(Object.keys(credentials).length === 0 ? {} : { credentials }),
      }).catch(() => setFormError("Provider profile could not be saved."));
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Settings are invalid.",
      );
    }
  };

  return (
    <form className="provider-profile-card" onSubmit={save}>
      <div className="provider-profile-heading">
        <div>
          <strong>{profile.displayName}</strong>
          <span>{profile.profileId}</span>
        </div>
        <span className="provider-status" data-status={profile.status}>
          {profile.status}
        </span>
      </div>
      <label>
        <span>Profile name</span>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.currentTarget.value)}
          maxLength={256}
          required
        />
      </label>
      <label>
        <span>Settings</span>
        <textarea
          value={settingsText}
          onChange={(event) => setSettingsText(event.currentTarget.value)}
          rows={4}
          spellCheck={false}
          aria-label={`${profile.displayName} settings JSON`}
        />
      </label>
      {profile.credentialKeys.length === 0 ? null : (
        <fieldset>
          <legend>Replace credentials</legend>
          {profile.credentialKeys.map((key) => (
            <label key={key}>
              <span>{key}</span>
              <input
                type="password"
                name={`credential:${key}`}
                autoComplete="new-password"
                placeholder="Leave blank to keep current value"
              />
            </label>
          ))}
        </fieldset>
      )}
      {formError === undefined ? null : <p role="alert">{formError}</p>}
      <div className="provider-profile-actions">
        <button type="submit" disabled={busy}>
          Save settings
        </button>
        {profile.status === "ready" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setFormError(undefined);
              void onStop(profile.profileId).catch(() =>
                setFormError("Provider profile could not be stopped."),
              );
            }}
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setFormError(undefined);
              void onStart(profile.profileId).catch(() =>
                setFormError("Provider profile could not be started."),
              );
            }}
          >
            Start
          </button>
        )}
        <button
          type="button"
          className="provider-danger"
          disabled={busy}
          onClick={() => {
            setFormError(undefined);
            void onDelete(profile.profileId).catch(() =>
              setFormError("Provider profile could not be removed."),
            );
          }}
        >
          Remove profile
        </button>
      </div>
    </form>
  );
}

function CreateProfile({
  providers,
  busy,
  onCreate,
}: {
  readonly providers: ProviderManagementSnapshot["installedProviders"];
  readonly busy: boolean;
  readonly onCreate: PluginManagerProps["onCreate"];
}): JSX.Element {
  const [providerId, setProviderId] = useState(providers[0]?.providerId ?? "");
  const [displayName, setDisplayName] = useState("");
  const [settingsText, setSettingsText] = useState("{}");
  const [createError, setCreateError] = useState<string>();
  const selectedProvider = providers.find(
    (provider) => provider.providerId === providerId,
  );
  const credentialKeys = selectedProvider?.credentialKeys ?? [];

  useEffect(() => {
    if (!providers.some((provider) => provider.providerId === providerId)) {
      setProviderId(providers[0]?.providerId ?? "");
    }
  }, [providerId, providers]);

  const create = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setCreateError(undefined);
    try {
      const settings = parseSettings(settingsText);
      const credentials = credentialsFromForm(
        event.currentTarget,
        credentialKeys,
      );
      void onCreate({ providerId, displayName, settings, credentials })
        .then(() => {
          setDisplayName("");
          setSettingsText("{}");
        })
        .catch(() => setCreateError("Provider profile could not be created."));
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Settings are invalid.",
      );
    }
  };

  return (
    <form className="provider-profile-create" onSubmit={create}>
      <h3>Add profile</h3>
      <label>
        <span>Provider</span>
        <select
          value={providerId}
          onChange={(event) => setProviderId(event.currentTarget.value)}
          required
        >
          {providers.map((provider) => (
            <option key={provider.providerId} value={provider.providerId}>
              {provider.providerName}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Profile name</span>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.currentTarget.value)}
          placeholder="Trading account"
          maxLength={256}
          required
        />
      </label>
      <label>
        <span>Settings</span>
        <textarea
          value={settingsText}
          onChange={(event) => setSettingsText(event.currentTarget.value)}
          rows={3}
          spellCheck={false}
        />
      </label>
      {credentialKeys.map((key) => (
        <label key={key}>
          <span>{key}</span>
          <input
            type="password"
            name={`credential:${key}`}
            autoComplete="new-password"
            required
          />
        </label>
      ))}
      {createError === undefined ? null : <p role="alert">{createError}</p>}
      <button type="submit" disabled={busy}>
        Create and start
      </button>
    </form>
  );
}

function ImportActions({
  kind,
  busy,
  onImport,
}: {
  readonly kind: "provider" | "indicator";
  readonly busy: boolean;
  readonly onImport: (sourceKind: PluginImportSourceKind) => void;
}): JSX.Element {
  return (
    <div className="plugin-import-actions" aria-label={`Import ${kind}`}>
      <button type="button" disabled={busy} onClick={() => onImport("zip")}>
        {busy ? "Importing…" : "Import ZIP"}
      </button>
      <button type="button" disabled={busy} onClick={() => onImport("folder")}>
        Import folder
      </button>
    </div>
  );
}

export function PluginManager({
  snapshot,
  indicators,
  busy = false,
  error,
  providerImportBusy = false,
  providerImportError,
  indicatorImportBusy = false,
  indicatorImportError,
  onClose,
  onProviderImport,
  onIndicatorImport,
  onIndicatorRemove,
  onRefresh,
  onCreate,
  onUpdate,
  onStart,
  onStop,
  onDelete,
}: PluginManagerProps): JSX.Element {
  const [tab, setTab] = useState<PluginManagerTab>("providers");
  const [providerSection, setProviderSection] =
    useState<ProviderManagerSection>("providers");
  const [providerId, setProviderId] = useState(
    snapshot.installedProviders[0]?.providerId ?? "",
  );
  const [profileId, setProfileId] = useState(
    snapshot.profiles[0]?.profileId ?? "",
  );
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [indicatorId, setIndicatorId] = useState(indicators[0]?.pluginId ?? "");

  useEffect(() => {
    if (
      !snapshot.installedProviders.some(
        (item) => item.providerId === providerId,
      )
    ) {
      setProviderId(snapshot.installedProviders[0]?.providerId ?? "");
    }
  }, [providerId, snapshot.installedProviders]);

  useEffect(() => {
    if (!snapshot.profiles.some((profile) => profile.profileId === profileId)) {
      setProfileId(snapshot.profiles[0]?.profileId ?? "");
    }
  }, [profileId, snapshot.profiles]);

  useEffect(() => {
    if (!indicators.some((item) => item.pluginId === indicatorId)) {
      setIndicatorId(indicators[0]?.pluginId ?? "");
    }
  }, [indicatorId, indicators]);

  const selectedProvider = useMemo(
    () =>
      snapshot.installedProviders.find(
        (item) => item.providerId === providerId,
      ),
    [providerId, snapshot.installedProviders],
  );
  const selectedProfile = useMemo(
    () => snapshot.profiles.find((profile) => profile.profileId === profileId),
    [profileId, snapshot.profiles],
  );
  const selectedIndicator = useMemo(
    () => indicators.find((item) => item.pluginId === indicatorId),
    [indicatorId, indicators],
  );
  const activeImportError =
    tab === "providers" ? providerImportError : indicatorImportError;

  return (
    <div className="plugin-manager-backdrop" role="presentation">
      <section
        className="plugin-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-manager-title"
      >
        <header className="plugin-manager-header">
          <div>
            <p className="eyebrow">Extensions</p>
            <h2 id="plugin-manager-title">Plugin Manager</h2>
          </div>
          <div className="plugin-manager-header-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onRefresh().catch(() => undefined)}
            >
              Refresh
            </button>
            <button
              type="button"
              aria-label="Close plugin manager"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>

        <div
          className="plugin-manager-tabs"
          role="tablist"
          aria-label="Plugin type"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "providers"}
            className={tab === "providers" ? "active" : undefined}
            onClick={() => setTab("providers")}
          >
            Providers <span>{snapshot.installedProviders.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "indicators"}
            className={tab === "indicators" ? "active" : undefined}
            onClick={() => setTab("indicators")}
          >
            Indicators <span>{indicators.length}</span>
          </button>
        </div>

        {error === undefined ? null : (
          <p className="plugin-manager-error" role="alert">
            {error}
          </p>
        )}
        {activeImportError === undefined ? null : (
          <p className="plugin-manager-error" role="alert">
            {activeImportError}
          </p>
        )}

        {tab === "providers" ? (
          <div className="plugin-manager-body">
            <aside
              className="plugin-manager-sidebar"
              aria-label="Provider management"
            >
              <div
                className="plugin-manager-sidebar-tabs"
                role="tablist"
                aria-label="Provider management section"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={providerSection === "providers"}
                  className={
                    providerSection === "providers" ? "active" : undefined
                  }
                  onClick={() => {
                    setProviderSection("providers");
                    setCreatingProfile(false);
                  }}
                >
                  Installed providers
                  <span>{snapshot.installedProviders.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={providerSection === "profiles"}
                  className={
                    providerSection === "profiles" ? "active" : undefined
                  }
                  onClick={() => {
                    setProviderSection("profiles");
                    setCreatingProfile(false);
                  }}
                >
                  Installed profiles
                  <span>{snapshot.profiles.length}</span>
                </button>
              </div>
              <div className="plugin-manager-list">
                {providerSection === "providers" ? (
                  snapshot.installedProviders.length === 0 ? (
                    <p className="plugin-manager-empty">
                      No providers installed.
                    </p>
                  ) : (
                    snapshot.installedProviders.map((provider) => {
                      const profiles = snapshot.profiles.filter(
                        (profile) => profile.providerId === provider.providerId,
                      );
                      const ready = profiles.some(
                        (profile) => profile.status === "ready",
                      );
                      return (
                        <button
                          type="button"
                          key={provider.providerId}
                          className={
                            provider.providerId === providerId
                              ? "selected"
                              : undefined
                          }
                          aria-pressed={provider.providerId === providerId}
                          onClick={() => setProviderId(provider.providerId)}
                        >
                          <span className="plugin-list-icon" aria-hidden="true">
                            P
                          </span>
                          <span className="plugin-list-copy">
                            <strong>{provider.providerName}</strong>
                            <small>
                              {provider.version} · {profiles.length} profile
                              {profiles.length === 1 ? "" : "s"}
                            </small>
                          </span>
                          <span
                            className="plugin-list-state"
                            data-ready={ready}
                          >
                            {ready ? "●" : "○"}
                          </span>
                        </button>
                      );
                    })
                  )
                ) : snapshot.profiles.length === 0 ? (
                  <p className="plugin-manager-empty">No profiles created.</p>
                ) : (
                  snapshot.profiles.map((profile) => (
                    <button
                      type="button"
                      key={profile.profileId}
                      className={
                        !creatingProfile && profile.profileId === profileId
                          ? "selected"
                          : undefined
                      }
                      aria-pressed={
                        !creatingProfile && profile.profileId === profileId
                      }
                      onClick={() => {
                        setProfileId(profile.profileId);
                        setCreatingProfile(false);
                      }}
                    >
                      <span className="plugin-list-icon" aria-hidden="true">
                        U
                      </span>
                      <span className="plugin-list-copy">
                        <strong>{profile.displayName}</strong>
                        <small>
                          {profile.providerName} · {profile.version}
                        </small>
                      </span>
                      <span
                        className="plugin-list-state"
                        data-ready={profile.status === "ready"}
                      >
                        {profile.status === "ready" ? "●" : "○"}
                      </span>
                    </button>
                  ))
                )}
              </div>
              {providerSection === "providers" ? (
                <ImportActions
                  kind="provider"
                  busy={providerImportBusy}
                  onImport={onProviderImport}
                />
              ) : (
                <div className="plugin-profile-actions">
                  <button
                    type="button"
                    className={creatingProfile ? "selected" : undefined}
                    disabled={busy || snapshot.installedProviders.length === 0}
                    onClick={() => setCreatingProfile(true)}
                  >
                    Add profile
                  </button>
                </div>
              )}
            </aside>

            <section className="plugin-manager-detail">
              {providerSection === "profiles" ? (
                creatingProfile ? (
                  snapshot.installedProviders.length === 0 ? (
                    <div className="plugin-manager-detail-empty">
                      <strong>Install a provider first</strong>
                      <span>A profile needs an installed provider plugin.</span>
                    </div>
                  ) : (
                    <section className="plugin-detail-section profile-editor-detail">
                      <CreateProfile
                        providers={snapshot.installedProviders}
                        busy={busy}
                        onCreate={onCreate}
                      />
                    </section>
                  )
                ) : selectedProfile === undefined ? (
                  <div className="plugin-manager-detail-empty">
                    <strong>Select or add a profile</strong>
                    <span>Profile connection settings appear here.</span>
                  </div>
                ) : (
                  <>
                    <div className="plugin-detail-heading">
                      <div>
                        <p className="eyebrow">Provider profile</p>
                        <h3>{selectedProfile.displayName}</h3>
                        <span>{selectedProfile.profileId}</span>
                      </div>
                      <span
                        className="provider-status"
                        data-status={selectedProfile.status}
                      >
                        {selectedProfile.status}
                      </span>
                    </div>
                    <div className="plugin-detail-meta">
                      <span>{selectedProfile.providerName}</span>
                      <span>v{selectedProfile.version}</span>
                    </div>
                    <section className="plugin-detail-section profile-editor-detail">
                      <ProfileEditor
                        key={selectedProfile.profileId}
                        profile={selectedProfile}
                        busy={busy}
                        onUpdate={onUpdate}
                        onStart={onStart}
                        onStop={onStop}
                        onDelete={onDelete}
                      />
                    </section>
                  </>
                )
              ) : selectedProvider === undefined ? (
                <div className="plugin-manager-detail-empty">
                  <strong>Select or import a provider</strong>
                  <span>Provider plugin information appears here.</span>
                </div>
              ) : (
                <>
                  <div className="plugin-detail-heading">
                    <div>
                      <p className="eyebrow">Provider plugin</p>
                      <h3>{selectedProvider.providerName}</h3>
                      <span>{selectedProvider.providerId}</span>
                    </div>
                    <span className="plugin-version">
                      v{selectedProvider.version}
                    </span>
                  </div>
                  <div className="plugin-detail-meta">
                    <span>
                      {
                        snapshot.profiles.filter(
                          (profile) =>
                            profile.providerId === selectedProvider.providerId,
                        ).length
                      }{" "}
                      profiles
                    </span>
                    <span>
                      {selectedProvider.credentialKeys.length === 0
                        ? "No credentials required"
                        : `${selectedProvider.credentialKeys.length} credential field${selectedProvider.credentialKeys.length === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  <section className="plugin-detail-section">
                    <div className="plugin-detail-section-heading">
                      <div>
                        <h4>Provider installation</h4>
                        <p>
                          Profiles for this provider are managed from the
                          Installed profiles tab.
                        </p>
                      </div>
                    </div>
                  </section>
                </>
              )}
            </section>
          </div>
        ) : (
          <div className="plugin-manager-body">
            <aside
              className="plugin-manager-sidebar"
              aria-label="Installed indicators"
            >
              <div className="plugin-manager-sidebar-heading">
                <strong>Installed indicators</strong>
                <span>{indicators.length}</span>
              </div>
              <div className="plugin-manager-list">
                {indicators.length === 0 ? (
                  <p className="plugin-manager-empty">
                    No indicator plugins installed.
                  </p>
                ) : (
                  indicators.map((indicator) => (
                    <button
                      type="button"
                      key={indicator.pluginId}
                      className={
                        indicator.pluginId === indicatorId
                          ? "selected"
                          : undefined
                      }
                      aria-pressed={indicator.pluginId === indicatorId}
                      onClick={() => setIndicatorId(indicator.pluginId)}
                    >
                      <span
                        className="plugin-list-icon indicator"
                        aria-hidden="true"
                      >
                        ƒ
                      </span>
                      <span className="plugin-list-copy">
                        <strong>{indicator.pluginName}</strong>
                        <small>
                          {indicator.definition.name} · {indicator.version}
                        </small>
                      </span>
                    </button>
                  ))
                )}
              </div>
              <ImportActions
                kind="indicator"
                busy={indicatorImportBusy}
                onImport={onIndicatorImport}
              />
            </aside>

            <section className="plugin-manager-detail">
              {selectedIndicator === undefined ? (
                <div className="plugin-manager-detail-empty">
                  <strong>Select or import an indicator</strong>
                  <span>
                    Plugin information and declared parameters appear here.
                  </span>
                </div>
              ) : (
                <>
                  <div className="plugin-detail-heading">
                    <div>
                      <p className="eyebrow">Indicator plugin</p>
                      <h3>{selectedIndicator.pluginName}</h3>
                      <span>{selectedIndicator.pluginId}</span>
                    </div>
                    <span className="plugin-version">
                      v{selectedIndicator.version}
                    </span>
                  </div>
                  <div className="plugin-detail-meta">
                    <span>
                      {selectedIndicator.definition.placement === "overlay"
                        ? "Chart overlay"
                        : "Separate pane"}
                    </span>
                    <span>
                      {selectedIndicator.definition.requiresLiveTicks
                        ? "Uses live ticks"
                        : "Candle updates"}
                    </span>
                  </div>
                  <section className="plugin-detail-section indicator-definition">
                    <h4>{selectedIndicator.definition.name}</h4>
                    {selectedIndicator.definition.description ===
                    undefined ? null : (
                      <p>{selectedIndicator.definition.description}</p>
                    )}
                    <div className="indicator-definition-grid">
                      <div>
                        <span>Inputs</span>
                        <strong>
                          {selectedIndicator.definition.inputs.length}
                        </strong>
                      </div>
                      <div>
                        <span>Outputs</span>
                        <strong>
                          {selectedIndicator.definition.outputs.length}
                        </strong>
                      </div>
                      <div>
                        <span>Plots</span>
                        <strong>
                          {selectedIndicator.definition.plots.length}
                        </strong>
                      </div>
                    </div>
                  </section>
                  <section className="plugin-detail-section">
                    <div className="plugin-detail-section-heading">
                      <div>
                        <h4>Declared parameters</h4>
                        <p>
                          Values are configured per indicator instance from the
                          chart settings panel.
                        </p>
                      </div>
                    </div>
                    {selectedIndicator.definition.inputs.length === 0 ? (
                      <p className="plugin-manager-empty">
                        This indicator has no configurable parameters.
                      </p>
                    ) : (
                      <div className="indicator-parameter-list">
                        {selectedIndicator.definition.inputs.map((input) => (
                          <div key={input.key}>
                            <span>
                              <strong>{input.label}</strong>
                              <small>{input.key}</small>
                            </span>
                            <span>
                              {input.type}
                              {input.effect === undefined
                                ? ""
                                : ` · ${input.effect}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                  <section className="plugin-detail-section">
                    <div className="plugin-detail-section-heading">
                      <div>
                        <h4>Indicator installation</h4>
                        <p>
                          Removing the plugin keeps workspace configuration, so
                          reinstalling it can restore those instances.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="provider-danger"
                        disabled={busy || indicatorImportBusy}
                        onClick={() => {
                          void onIndicatorRemove(selectedIndicator.pluginId);
                        }}
                      >
                        Remove indicator
                      </button>
                    </div>
                  </section>
                </>
              )}
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

export type ProviderManagerProps = PluginManagerProps;
export const ProviderManager: typeof PluginManager = PluginManager;
