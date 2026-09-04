import { useEffect, useMemo, useState, type FormEvent, type JSX } from "react";
import type {
  ProviderManagementSnapshot,
  ProviderProfileCreateRequest,
  ProviderProfileSettings,
  ProviderProfileSummary,
  ProviderProfileUpdateRequest,
} from "@erc-chart/contracts";

export interface ProviderManagerProps {
  readonly snapshot: ProviderManagementSnapshot;
  readonly busy?: boolean;
  readonly error?: string | undefined;
  readonly importBusy?: boolean;
  readonly importError?: string | undefined;
  readonly onClose: () => void;
  readonly onImport: () => void;
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
  readonly onUpdate: ProviderManagerProps["onUpdate"];
  readonly onStart: ProviderManagerProps["onStart"];
  readonly onStop: ProviderManagerProps["onStop"];
  readonly onDelete: ProviderManagerProps["onDelete"];
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
          <strong>{profile.providerName}</strong>
          <span>{profile.version}</span>
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
        <span>Settings (JSON)</span>
        <textarea
          value={settingsText}
          onChange={(event) => setSettingsText(event.currentTarget.value)}
          rows={3}
          spellCheck={false}
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
          Save
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
          Remove
        </button>
      </div>
    </form>
  );
}

export function ProviderManager({
  snapshot,
  busy = false,
  error,
  importBusy = false,
  importError,
  onClose,
  onImport,
  onRefresh,
  onCreate,
  onUpdate,
  onStart,
  onStop,
  onDelete,
}: ProviderManagerProps): JSX.Element {
  const [providerId, setProviderId] = useState(
    snapshot.installedProviders[0]?.providerId ?? "",
  );
  const [displayName, setDisplayName] = useState("");
  const [settingsText, setSettingsText] = useState("{}");
  const [createError, setCreateError] = useState<string>();
  const selectedProvider = useMemo(
    () =>
      snapshot.installedProviders.find(
        (provider) => provider.providerId === providerId,
      ),
    [providerId, snapshot.installedProviders],
  );

  useEffect(() => {
    if (
      providerId.length === 0 &&
      snapshot.installedProviders[0] !== undefined
    ) {
      setProviderId(snapshot.installedProviders[0].providerId);
    }
  }, [providerId, snapshot.installedProviders]);

  const create = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setCreateError(undefined);
    if (selectedProvider === undefined) {
      setCreateError("Install a provider before creating a profile.");
      return;
    }
    try {
      const settings = parseSettings(settingsText);
      const credentials = credentialsFromForm(
        event.currentTarget,
        selectedProvider.credentialKeys,
      );
      void onCreate({
        providerId: selectedProvider.providerId,
        displayName,
        settings,
        credentials,
      })
        .then(() => {
          setDisplayName("");
          setSettingsText("{}");
        })
        .catch(() => setCreateError("Provider profile could not be created."));
    } catch (caught) {
      setCreateError(
        caught instanceof Error ? caught.message : "Settings are invalid.",
      );
    }
  };

  return (
    <div className="provider-manager-backdrop" role="presentation">
      <section
        className="provider-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-manager-title"
      >
        <header>
          <div>
            <p className="eyebrow">Market data</p>
            <h2 id="provider-manager-title">Provider manager</h2>
          </div>
          <button
            type="button"
            aria-label="Close provider manager"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="provider-manager-toolbar">
          <span>
            {snapshot.profiles.length} profile
            {snapshot.profiles.length === 1 ? "" : "s"} ·{" "}
            {snapshot.installedProviders.length} provider
            {snapshot.installedProviders.length === 1 ? "" : "s"} installed
          </span>
          <div className="provider-manager-toolbar-actions">
            <button
              type="button"
              className="provider-import"
              disabled={busy || importBusy}
              onClick={onImport}
            >
              {importBusy ? "Importing…" : "Import provider"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onRefresh().catch(() => undefined)}
            >
              Refresh
            </button>
          </div>
        </div>
        {error === undefined ? null : <p role="alert">{error}</p>}
        {importError === undefined ? null : (
          <p className="provider-import-error" role="alert">
            {importError}
          </p>
        )}

        <div className="provider-manager-content">
          <section
            className="provider-manager-list"
            aria-label="Provider profiles"
          >
            {snapshot.profiles.length === 0 ? (
              <p className="provider-manager-empty">
                No provider profiles yet.
              </p>
            ) : (
              snapshot.profiles.map((profile) => (
                <ProfileEditor
                  key={profile.profileId}
                  profile={profile}
                  busy={busy}
                  onUpdate={onUpdate}
                  onStart={onStart}
                  onStop={onStop}
                  onDelete={onDelete}
                />
              ))
            )}
          </section>

          <form className="provider-profile-create" onSubmit={create}>
            <h3>Create profile</h3>
            <label>
              <span>Installed provider</span>
              <select
                value={providerId}
                onChange={(event) => setProviderId(event.currentTarget.value)}
                required
              >
                <option value="">Select provider</option>
                {snapshot.installedProviders.map((provider) => (
                  <option value={provider.providerId} key={provider.providerId}>
                    {provider.providerName} · {provider.version}
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
              <span>Settings (JSON)</span>
              <textarea
                value={settingsText}
                onChange={(event) => setSettingsText(event.currentTarget.value)}
                rows={3}
                spellCheck={false}
              />
            </label>
            {selectedProvider?.credentialKeys.map((key) => (
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
            {createError === undefined ? null : (
              <p role="alert">{createError}</p>
            )}
            <button
              type="submit"
              disabled={busy || selectedProvider === undefined}
            >
              Create and start
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
