import type {
  ProviderRuntimeHostBroker,
  ProviderUtilityLaunchDescriptor,
} from "@erc-chart/provider-runtime";
import { isProviderNetworkRequestAllowed } from "@erc-chart/provider-runtime";
import type { WindowsGenericCredentialManager } from "@erc-chart/electron-main";
import { windowsCredentialTarget } from "@erc-chart/electron-main";

type ProviderNetworkRequest = Parameters<
  ProviderRuntimeHostBroker["requestNetwork"]
>[1];
type ProviderNetworkResponse = Awaited<
  ReturnType<ProviderRuntimeHostBroker["requestNetwork"]>
>;
type ProviderStatus = Parameters<ProviderRuntimeHostBroker["reportStatus"]>[1];

const defaultProviderNetworkTimeoutMs = 30_000;
const minimumProviderNetworkTimeoutMs = 1;
const maximumProviderNetworkTimeoutMs = 120_000;

export interface ProviderHostBrokerOptions {
  readonly launches: ReadonlyMap<string, ProviderUtilityLaunchDescriptor>;
  readonly credentialManager: WindowsGenericCredentialManager;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly log: (
    providerProfileId: string,
    level: "debug" | "info" | "warn" | "error",
    code: string,
    metadata?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly reportStatus: (
    providerProfileId: string,
    status: ProviderStatus,
  ) => void;
  readonly now: () => number;
}

function requireLaunch(
  launches: ReadonlyMap<string, ProviderUtilityLaunchDescriptor>,
  providerProfileId: string,
): ProviderUtilityLaunchDescriptor {
  const launch = launches.get(providerProfileId);
  if (launch === undefined) throw new Error("Provider profile is not active.");
  return launch;
}

function parseCredentialBundle(
  value: string | undefined,
): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Provider credential bundle is invalid.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Provider credential bundle is invalid.");
  }
  const entries = Object.entries(parsed);
  if (
    !entries.every(([key, item]) => key.length > 0 && typeof item === "string")
  ) {
    throw new Error("Provider credential bundle is invalid.");
  }
  return Object.fromEntries(entries);
}

async function fetchProviderNetwork(
  fetcher: ProviderHostBrokerOptions["fetch"],
  request: ProviderNetworkRequest,
): Promise<ProviderNetworkResponse> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    resolveProviderNetworkTimeoutMs(request.timeoutMs),
  );
  try {
    const body =
      request.body === undefined
        ? undefined
        : typeof request.body === "string"
          ? request.body
          : Uint8Array.from(request.body).buffer;
    const response = await fetcher(request.url, {
      ...(request.method === undefined ? {} : { method: request.method }),
      ...(request.headers === undefined ? {} : { headers: request.headers }),
      ...(body === undefined ? {} : { body }),
      signal: controller.signal,
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: new Uint8Array(await response.arrayBuffer()),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function resolveProviderNetworkTimeoutMs(
  requestedTimeoutMs: number | undefined,
): number {
  if (
    requestedTimeoutMs === undefined ||
    !Number.isFinite(requestedTimeoutMs)
  ) {
    return defaultProviderNetworkTimeoutMs;
  }
  return Math.min(
    maximumProviderNetworkTimeoutMs,
    Math.max(minimumProviderNetworkTimeoutMs, Math.trunc(requestedTimeoutMs)),
  );
}

export function createDesktopProviderHostBroker(
  options: ProviderHostBrokerOptions,
): ProviderRuntimeHostBroker {
  return {
    requestNetwork: (providerProfileId, request) => {
      const launch = requireLaunch(options.launches, providerProfileId);
      if (
        !isProviderNetworkRequestAllowed(
          request.url,
          launch.permissions.network,
        )
      ) {
        throw new Error("Provider network request is not permitted.");
      }
      return fetchProviderNetwork(options.fetch, request);
    },
    getCredential: async (providerProfileId, credentialKey) => {
      const launch = requireLaunch(options.launches, providerProfileId);
      if (!launch.permissions.credentials.includes(credentialKey)) {
        throw new Error("Provider credential access is not permitted.");
      }
      const raw = await options.credentialManager.read(
        windowsCredentialTarget(launch.pluginId, providerProfileId),
      );
      return parseCredentialBundle(raw)[credentialKey] ?? null;
    },
    log: options.log,
    reportStatus: options.reportStatus,
    now: options.now,
  };
}
