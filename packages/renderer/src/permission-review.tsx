import type {
  PluginKind,
  PluginManifestPermissions,
} from "@erc-chart/contracts";
import { useState, type JSX } from "react";

export type PluginPermissionDecision = "approve" | "reject";
export type PluginPermissionReviewReason = "install" | "permission-change";
export type PluginPermissionReviewMode = "production" | "developer";
export type PluginPermissionReviewTrust = "bundled" | "signed" | "unsigned";

export interface PluginPermissionReviewRequest {
  readonly requestId: string;
  readonly pluginId: string;
  readonly pluginName: string;
  readonly pluginVersion: string;
  readonly kind: PluginKind;
  readonly mode: PluginPermissionReviewMode;
  readonly trust: PluginPermissionReviewTrust;
  readonly reason: PluginPermissionReviewReason;
  readonly permissions: PluginManifestPermissions;
}

export interface PluginPermissionReviewPresentation {
  readonly request: PluginPermissionReviewRequest;
  readonly busy?: boolean;
  readonly onDecision: (
    requestId: string,
    decision: PluginPermissionDecision,
    credentials: Readonly<Record<string, string>>,
  ) => void;
}

export type PluginPermissionReviewProps = PluginPermissionReviewPresentation;

function PermissionList({
  title,
  description,
  values,
}: {
  readonly title: string;
  readonly description: string;
  readonly values: readonly string[];
}): JSX.Element {
  return (
    <section className="permission-group">
      <div className="permission-group-heading">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {values.length === 0 ? (
        <p className="permission-empty">No access requested</p>
      ) : (
        <ul>
          {values.map((value) => (
            <li key={value}>
              <code>{value}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PluginPermissionReview({
  request,
  busy = false,
  onDecision,
}: PluginPermissionReviewProps): JSX.Element {
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const trustLabel =
    request.trust === "bundled"
      ? "Bundled plugin"
      : request.trust === "signed"
        ? "Trusted signed plugin"
        : "Unsigned Developer Mode plugin";

  return (
    <div className="permission-review-backdrop">
      <section
        className="permission-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-permission-review-title"
        aria-describedby="plugin-permission-review-summary"
      >
        <header className="permission-review-header">
          <p className="eyebrow">Plugin security</p>
          <h2 id="plugin-permission-review-title">Review plugin permissions</h2>
          <p id="plugin-permission-review-summary">
            {request.reason === "permission-change"
              ? "This update changes requested permissions and must be approved again before activation."
              : "Review the access this plugin requests before it can be activated."}
          </p>
        </header>

        <div className="permission-plugin-identity">
          <div>
            <strong>{request.pluginName}</strong>
            <span>
              {request.kind} · v{request.pluginVersion}
            </span>
          </div>
          <span className="permission-trust" data-trust={request.trust}>
            {trustLabel}
          </span>
        </div>

        {request.mode === "developer" && request.trust === "unsigned" ? (
          <p className="permission-warning" role="alert">
            Developer Mode permits unsigned local code. Only approve packages
            you trust and understand.
          </p>
        ) : null}

        <div className="permission-groups">
          <PermissionList
            title="Network"
            description="Remote endpoints the plugin may contact."
            values={request.permissions.network}
          />
          <PermissionList
            title="Credentials"
            description="Credential keys the plugin may request. Values entered below are transferred to desktop secure storage and are not persisted in plugin settings."
            values={request.permissions.credentials}
          />
          <PermissionList
            title="Storage"
            description="Scoped application storage capabilities."
            values={request.permissions.storage}
          />
        </div>

        {request.permissions.credentials.length === 0 ? null : (
          <section className="permission-credential-fields">
            <div className="permission-group-heading">
              <h3>Credential values</h3>
              <p>
                Optional. Leave a value blank to install the provider without
                that credential.
              </p>
            </div>
            {request.permissions.credentials.map((credentialKey) => (
              <label key={credentialKey}>
                <span>{credentialKey}</span>
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={credentials[credentialKey] ?? ""}
                  onInput={(event) =>
                    setCredentials((current) => ({
                      ...current,
                      [credentialKey]: event.currentTarget.value,
                    }))
                  }
                />
              </label>
            ))}
          </section>
        )}

        <footer className="permission-review-actions">
          <button
            type="button"
            className="permission-reject"
            disabled={busy}
            onClick={() => onDecision(request.requestId, "reject", {})}
          >
            Cancel
          </button>
          <button
            type="button"
            className="permission-approve"
            disabled={busy}
            onClick={() =>
              onDecision(
                request.requestId,
                "approve",
                Object.fromEntries(
                  request.permissions.credentials.flatMap((credentialKey) => {
                    const value = credentials[credentialKey];
                    return value === undefined || value.length === 0
                      ? []
                      : [[credentialKey, value]];
                  }),
                ),
              )
            }
          >
            {busy ? "Applying…" : "Approve permissions"}
          </button>
        </footer>
      </section>
    </div>
  );
}
