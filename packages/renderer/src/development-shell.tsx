import { isRuntimeInfo, type RuntimeInfo } from "@erc-chart/contracts";
import { useEffect, useState, type JSX } from "react";

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
}

export function ApplicationShell({
  connection,
}: ApplicationShellProps): JSX.Element {
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
        <section className="workspace-empty" aria-labelledby="workspace-title">
          <div className="pulse-orbit" aria-hidden="true">
            <span />
          </div>
          <p className="eyebrow">Secure desktop shell</p>
          <h2 id="workspace-title">Workspace ready</h2>
          <p className="workspace-copy">
            Your local charting environment is prepared for the next stage.
          </p>
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

export function RuntimeApplicationShell({
  bridge,
}: RuntimeApplicationShellProps): JSX.Element {
  const [connection, setConnection] = useState(connectingShellState);

  useEffect(() => {
    let active = true;
    void resolveShellState(bridge).then((state) => {
      if (active) setConnection(state);
    });
    return (): void => {
      active = false;
    };
  }, [bridge]);

  return <ApplicationShell connection={connection} />;
}
