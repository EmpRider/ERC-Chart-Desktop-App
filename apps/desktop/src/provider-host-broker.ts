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
export const maximumProviderNetworkResponseBytes: number = 8 * 1024 * 1024;

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
  signal?: AbortSignal,
): Promise<ProviderNetworkResponse> {
  const controller = new AbortController();
  const abortFromCaller = (): void => controller.abort();
  if (signal?.aborted === true) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
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
      cache: "no-store",
      redirect: "error",
    });
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > maximumProviderNetworkResponseBytes
    ) {
      throw new Error("Provider network response exceeds the allowed size.");
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    if (reader !== undefined) {
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          byteLength += result.value.byteLength;
          if (byteLength > maximumProviderNetworkResponseBytes) {
            await reader.cancel().catch(() => undefined);
            throw new Error(
              "Provider network response exceeds the allowed size.",
            );
          }
          chunks.push(result.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const responseBody = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      responseBody.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseBody,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
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
    requestNetwork: (providerProfileId, request, signal) => {
      const launch = requireLaunch(options.launches, providerProfileId);
      if (
        !isProviderNetworkRequestAllowed(
          request.url,
          launch.permissions.network,
        )
      ) {
        throw new Error("Provider network request is not permitted.");
      }
      if (new URL(request.url).protocol !== "https:") {
        throw new Error("Provider network request protocol is not supported.");
      }
      return fetchProviderNetwork(options.fetch, request, signal);
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
