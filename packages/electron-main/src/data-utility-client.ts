import {
  dataUtilityProviderCommandTimeoutMs,
  ipcContractVersion,
  isDataUtilityEvent,
  isDataUtilityResult,
  isDataUtilityUpstreamRequest,
  type Candle,
  type DataUtilityInitMessage,
  type DataUtilityOperation,
  type DataUtilityUpstreamRequest,
  type PersistedWorkspace,
  type ProviderSeriesChange,
} from "@erc-chart/contracts";
import type {
  ProviderCapabilities,
  ProviderDataSink,
  ProviderHistoryRequest,
  ProviderInstrument,
  ProviderSubscription,
  ProviderSubscriptionRequest,
} from "@erc-chart/provider-sdk";
import type { UtilityScheduler } from "./utility-supervisor.js";

export interface DataUtilityClientTransport {
  readonly start: (
    entryPath: string,
    args?: readonly string[],
    initialMessages?: readonly unknown[],
  ) => Promise<void>;
  readonly postMessage: (message: unknown) => void;
  readonly onMessage: (listener: (message: unknown) => void) => () => void;
  readonly shutdown: () => Promise<void>;
}

export interface DataUtilityUpstreamBridge {
  readonly getCapabilities: (
    providerProfileId: string,
  ) => Promise<ProviderCapabilities>;
  readonly getInstruments: (
    providerProfileId: string,
  ) => Promise<readonly ProviderInstrument[]>;
  readonly requestHistory: (
    providerProfileId: string,
    request: ProviderHistoryRequest,
  ) => Promise<readonly Candle[]>;
  readonly subscribe: (
    providerProfileId: string,
    request: ProviderSubscriptionRequest,
    sink: ProviderDataSink,
  ) => Promise<ProviderSubscription>;
}

export interface DataUtilityClientOptions {
  readonly transport: DataUtilityClientTransport;
  readonly upstream: DataUtilityUpstreamBridge;
  readonly scheduler: UtilityScheduler;
  readonly requestTimeoutMs: number;
  readonly databasePath: string;
  readonly instanceId: string;
  readonly legacyWorkspaceId: string;
  readonly maximumPendingRequests?: number;
}

export interface DataUtilityLiveSink extends Omit<
  ProviderDataSink,
  "onCandles"
> {
  readonly onCandles: (
    candles: readonly Candle[],
    series: ProviderSeriesChange,
  ) => void;
}

export interface DataUtilityClient {
  readonly start: (
    entryPath: string,
    args?: readonly string[],
  ) => Promise<void>;
  readonly request: <T>(
    operation: DataUtilityOperation,
    payload: unknown,
  ) => Promise<T>;
  readonly getCapabilities: (
    providerProfileId: string,
  ) => Promise<ProviderCapabilities>;
  readonly getInstruments: (
    providerProfileId: string,
  ) => Promise<readonly ProviderInstrument[]>;
  readonly requestHistory: (
    providerProfileId: string,
    request: ProviderHistoryRequest,
  ) => Promise<readonly Candle[]>;
  readonly subscribe: (
    providerProfileId: string,
    request: ProviderSubscriptionRequest,
    sink: DataUtilityLiveSink,
  ) => Promise<ProviderSubscription>;
  readonly loadWorkspace: () => Promise<PersistedWorkspace | null>;
  readonly saveWorkspace: (workspace: PersistedWorkspace) => Promise<void>;
  readonly processInfo: () => Promise<{ readonly pid: number }>;
  readonly markUnavailable: () => void;
  readonly shutdown: () => Promise<void>;
}

interface PendingCommand {
  readonly generation: number;
  readonly resolve: (payload: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: unknown;
}

interface LiveSubscription {
  readonly generation: number;
  readonly sink: DataUtilityLiveSink;
}

interface UpstreamSubscription {
  readonly generation: number;
  subscription?: ProviderSubscription;
}

const validId = /^[A-Za-z0-9._:-]+$/u;

function requireId(value: string, label: string, maximum = 128): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    !validId.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requirePositiveBoundedInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000)
    throw new Error(`${label} is invalid.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function upstreamFailure(
  request: DataUtilityUpstreamRequest,
  code = "UPSTREAM_FAILED",
): Record<string, unknown> {
  return {
    type: "data-upstream-result",
    contractVersion: ipcContractVersion,
    requestId: request.requestId,
    generation: request.generation,
    ok: false,
    code,
  };
}

export function createDataUtilityClient(
  options: DataUtilityClientOptions,
): DataUtilityClient {
  const requestTimeoutMs = requirePositiveBoundedInteger(
    options.requestTimeoutMs,
    "Data utility request timeout",
  );
  const maximumPendingRequests = requirePositiveBoundedInteger(
    options.maximumPendingRequests ?? 256,
    "Data utility request capacity",
  );
  if (
    typeof options.databasePath !== "string" ||
    options.databasePath.length === 0
  )
    throw new Error("Data utility database path is invalid.");
  requireId(options.instanceId, "Data utility instance ID");
  requireId(options.legacyWorkspaceId, "Legacy workspace ID");

  let generation = 0;
  let requestSequence = 0;
  let subscriptionSequence = 0;
  let available = false;
  let draining = false;
  const pending = new Map<string, PendingCommand>();
  const liveSubscriptions = new Map<string, LiveSubscription>();
  const upstreamSubscriptions = new Map<string, UpstreamSubscription>();

  const rejectPending = (error: Error): void => {
    for (const item of pending.values()) {
      options.scheduler.clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };

  const reportUnavailableToLive = (): void => {
    for (const item of liveSubscriptions.values()) {
      if (item.generation !== generation) continue;
      try {
        item.sink.onError("DATA_UTILITY_UNAVAILABLE");
      } catch {
        // One consumer cannot prevent cleanup of the remaining subscriptions.
      }
    }
    liveSubscriptions.clear();
  };

  const cleanupUpstream = (): void => {
    const active = [...upstreamSubscriptions.values()];
    upstreamSubscriptions.clear();
    void Promise.allSettled(
      active.map(({ subscription }) => subscription?.unsubscribe()),
    );
  };

  const markUnavailable = (): void => {
    if (!available && pending.size === 0 && liveSubscriptions.size === 0)
      return;
    available = false;
    draining = true;
    rejectPending(new Error("Data utility unavailable."));
    reportUnavailableToLive();
    cleanupUpstream();
  };

  const postUpstreamResult = (
    request: DataUtilityUpstreamRequest,
    payload: unknown,
  ): void => {
    if (!available || request.generation !== generation) return;
    options.transport.postMessage({
      type: "data-upstream-result",
      contractVersion: ipcContractVersion,
      requestId: request.requestId,
      generation: request.generation,
      ok: true,
      payload: payload ?? null,
    });
  };

  const postUpstreamEvent = (
    requestGeneration: number,
    subscriptionId: string,
    event: "candles" | "ticks" | "error",
    payload: unknown,
  ): void => {
    if (
      !available ||
      requestGeneration !== generation ||
      !upstreamSubscriptions.has(subscriptionId)
    )
      return;
    options.transport.postMessage({
      type: "data-upstream-event",
      contractVersion: ipcContractVersion,
      generation: requestGeneration,
      subscriptionId,
      event,
      payload,
    });
  };

  const handleUpstreamRequest = async (
    request: DataUtilityUpstreamRequest,
  ): Promise<void> => {
    if (!available || request.generation !== generation) return;
    try {
      switch (request.operation) {
        case "get-capabilities":
          postUpstreamResult(
            request,
            await options.upstream.getCapabilities(request.providerProfileId),
          );
          return;
        case "get-instruments":
          postUpstreamResult(
            request,
            await options.upstream.getInstruments(request.providerProfileId),
          );
          return;
        case "request-history":
          if (!isRecord(request.payload)) throw new Error("invalid request");
          postUpstreamResult(
            request,
            await options.upstream.requestHistory(
              request.providerProfileId,
              request.payload as unknown as ProviderHistoryRequest,
            ),
          );
          return;
        case "subscribe": {
          if (
            !isRecord(request.payload) ||
            typeof request.payload.subscriptionId !== "string" ||
            !isRecord(request.payload.request)
          ) {
            throw new Error("invalid request");
          }
          const subscriptionId = requireId(
            request.payload.subscriptionId,
            "Upstream subscription ID",
            256,
          );
          if (upstreamSubscriptions.has(subscriptionId))
            throw new Error("duplicate subscription");
          const requestGeneration = request.generation;
          const pendingSubscription: UpstreamSubscription = {
            generation: requestGeneration,
          };
          upstreamSubscriptions.set(subscriptionId, pendingSubscription);
          const subscription = await options.upstream
            .subscribe(
              request.providerProfileId,
              request.payload.request as unknown as ProviderSubscriptionRequest,
              {
                onCandles: (candles): void =>
                  postUpstreamEvent(
                    requestGeneration,
                    subscriptionId,
                    "candles",
                    candles,
                  ),
                onTicks: (ticks): void =>
                  postUpstreamEvent(
                    requestGeneration,
                    subscriptionId,
                    "ticks",
                    ticks,
                  ),
                onError: (code): void =>
                  postUpstreamEvent(
                    requestGeneration,
                    subscriptionId,
                    "error",
                    code,
                  ),
              },
            )
            .catch((error: unknown) => {
              if (
                upstreamSubscriptions.get(subscriptionId) ===
                pendingSubscription
              )
                upstreamSubscriptions.delete(subscriptionId);
              throw error;
            });
          if (
            !available ||
            requestGeneration !== generation ||
            upstreamSubscriptions.get(subscriptionId) !== pendingSubscription
          ) {
            await subscription.unsubscribe().catch(() => undefined);
            return;
          }
          pendingSubscription.subscription = subscription;
          postUpstreamResult(request, true);
          return;
        }
        case "unsubscribe": {
          if (
            !isRecord(request.payload) ||
            typeof request.payload.subscriptionId !== "string"
          ) {
            throw new Error("invalid request");
          }
          const subscriptionId = requireId(
            request.payload.subscriptionId,
            "Upstream subscription ID",
            256,
          );
          const active = upstreamSubscriptions.get(subscriptionId);
          if (active === undefined || active.generation !== request.generation)
            throw new Error("unknown subscription");
          upstreamSubscriptions.delete(subscriptionId);
          await active.subscription?.unsubscribe();
          postUpstreamResult(request, true);
          return;
        }
      }
    } catch {
      if (!available || request.generation !== generation) return;
      options.transport.postMessage(upstreamFailure(request));
    }
  };

  const removeMessageListener = options.transport.onMessage((message) => {
    if (isDataUtilityResult(message)) {
      if (message.generation !== generation) return;
      const item = pending.get(message.requestId);
      if (item === undefined || item.generation !== message.generation) return;
      pending.delete(message.requestId);
      options.scheduler.clearTimeout(item.timer);
      if (message.ok) item.resolve(message.payload);
      else item.reject(new Error(message.code ?? "DATA_OPERATION_FAILED"));
      return;
    }
    if (isDataUtilityEvent(message)) {
      if (message.generation !== generation) return;
      const live = liveSubscriptions.get(message.subscriptionId);
      if (live === undefined || live.generation !== message.generation) return;
      try {
        if (message.event === "candles" && isRecord(message.payload)) {
          const candles = Array.isArray(message.payload.candles)
            ? (message.payload.candles as readonly Candle[])
            : [];
          const series = message.payload.series as ProviderSeriesChange;
          live.sink.onCandles(candles, series);
        } else if (
          message.event === "ticks" &&
          Array.isArray(message.payload)
        ) {
          live.sink.onTicks(message.payload as never);
        } else if (
          message.event === "error" &&
          typeof message.payload === "string"
        ) {
          live.sink.onError(message.payload);
        }
      } catch {
        // A failing renderer-facing sink must not break transport bookkeeping.
      }
      return;
    }
    if (isDataUtilityUpstreamRequest(message)) {
      void handleUpstreamRequest(message);
    }
  });

  const request = <T>(
    operation: DataUtilityOperation,
    payload: unknown,
  ): Promise<T> => {
    if (!available || draining)
      return Promise.reject(new Error("Data utility unavailable."));
    if (pending.size >= maximumPendingRequests)
      return Promise.reject(
        new Error("Data utility request capacity exceeded."),
      );
    requestSequence += 1;
    const requestId = `command:${generation}:${requestSequence}`;
    const timeoutMs = operation.startsWith("provider-")
      ? Math.max(requestTimeoutMs, dataUtilityProviderCommandTimeoutMs)
      : requestTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      const timer = options.scheduler.setTimeout(() => {
        const item = pending.get(requestId);
        if (item === undefined) return;
        pending.delete(requestId);
        item.reject(
          new Error(`Data utility request timed out (${operation}).`),
        );
      }, timeoutMs);
      pending.set(requestId, {
        generation,
        resolve: (value): void => resolve(value as T),
        reject,
        timer,
      });
      try {
        options.transport.postMessage({
          type: "data-command",
          contractVersion: ipcContractVersion,
          requestId,
          generation,
          operation,
          payload,
        });
      } catch {
        pending.delete(requestId);
        options.scheduler.clearTimeout(timer);
        reject(new Error("Data utility unavailable."));
      }
    });
  };

  const start = async (
    entryPath: string,
    args: readonly string[] = [],
  ): Promise<void> => {
    if (available) throw new Error("Data utility client is already started.");
    generation += 1;
    draining = false;
    const init: DataUtilityInitMessage = {
      type: "data-init",
      contractVersion: ipcContractVersion,
      generation,
      databasePath: options.databasePath,
      instanceId: options.instanceId,
      legacyWorkspaceId: options.legacyWorkspaceId,
    };
    try {
      await options.transport.start(entryPath, args, [init]);
      available = true;
    } catch {
      available = false;
      draining = true;
      throw new Error("Data utility failed to start.");
    }
  };

  return {
    start,
    request,
    getCapabilities: (providerProfileId): Promise<ProviderCapabilities> =>
      request("provider-capabilities", {
        profileId: requireId(providerProfileId, "Provider profile ID"),
      }),
    getInstruments: (
      providerProfileId,
    ): Promise<readonly ProviderInstrument[]> =>
      request("provider-instruments", {
        profileId: requireId(providerProfileId, "Provider profile ID"),
      }),
    requestHistory: (
      providerProfileId,
      historyRequest,
    ): Promise<readonly Candle[]> =>
      request("provider-history", {
        profileId: requireId(providerProfileId, "Provider profile ID"),
        ...historyRequest,
      }),
    subscribe: async (
      providerProfileId,
      subscriptionRequest,
      sink,
    ): Promise<ProviderSubscription> => {
      if (!available || draining) throw new Error("Data utility unavailable.");
      subscriptionSequence += 1;
      const subscriptionId = `client-sub:${generation}:${subscriptionSequence}`;
      liveSubscriptions.set(subscriptionId, { generation, sink });
      try {
        await request("provider-subscribe", {
          profileId: requireId(providerProfileId, "Provider profile ID"),
          subscriptionId,
          ...subscriptionRequest,
        });
      } catch (error) {
        liveSubscriptions.delete(subscriptionId);
        if (available && !draining)
          void request("provider-unsubscribe", { subscriptionId }).catch(
            () => undefined,
          );
        throw error;
      }
      let disposed = false;
      return {
        unsubscribe: async (): Promise<void> => {
          if (disposed) return;
          disposed = true;
          liveSubscriptions.delete(subscriptionId);
          if (!available || draining) return;
          await request("provider-unsubscribe", { subscriptionId });
        },
      };
    },
    loadWorkspace: (): Promise<PersistedWorkspace | null> =>
      request("workspace-load", null),
    saveWorkspace: async (workspace): Promise<void> => {
      await request("workspace-save", workspace);
    },
    processInfo: (): Promise<{ readonly pid: number }> =>
      request("process-info", null),
    markUnavailable,
    shutdown: async (): Promise<void> => {
      draining = true;
      rejectPending(new Error("Data utility unavailable."));
      reportUnavailableToLive();
      const active = [...upstreamSubscriptions.values()];
      upstreamSubscriptions.clear();
      await Promise.allSettled(
        active.map(({ subscription }) => subscription?.unsubscribe()),
      );
      try {
        await options.transport.shutdown();
      } finally {
        available = false;
        removeMessageListener();
      }
    },
  };
}
