import type { Candle, Tick } from "@erc-chart/contracts";
import type {
  ProviderCapabilities,
  ProviderDataSink,
  ProviderHistoryRequest,
  ProviderInstrument,
  ProviderSubscription,
  ProviderSubscriptionRequest,
} from "@erc-chart/provider-sdk";
import { normalizeCandles, normalizeTicks } from "./market-data-validation.js";
import {
  createCanonicalCandleState,
  type CanonicalCandleState,
} from "./candle-state.js";
import type {
  CanonicalSeriesKey,
  CanonicalSeriesSnapshot,
} from "./canonical-series.js";
import { createBoundedTickBuffer } from "./tick-buffer.js";
import { timeframeCapabilities } from "./timeframes.js";

export interface ProviderDataUpstream {
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

export interface ProviderDataService {
  readonly getCapabilities: ProviderDataUpstream["getCapabilities"];
  readonly getInstruments: ProviderDataUpstream["getInstruments"];
  readonly requestHistory: ProviderDataUpstream["requestHistory"];
  readonly subscribe: ProviderDataUpstream["subscribe"];
  readonly seriesSnapshot: (
    providerProfileId: string,
    request: ProviderSubscriptionRequest,
  ) => Promise<CanonicalSeriesSnapshot>;
  readonly tickSnapshot: (
    providerProfileId: string,
    instrumentId: string,
  ) => readonly Tick[];
  readonly invalidateProfile: (providerProfileId: string) => Promise<void>;
  readonly restoreProfile: (providerProfileId: string) => Promise<void>;
  readonly shutdown: () => Promise<void>;
}

export interface ProviderDataServiceOptions {
  readonly now?: () => number;
  readonly maximumFinalizedBars?: number;
  readonly tickBufferCapacity?: number;
  readonly candleState?: CanonicalCandleState;
}

interface LogicalDemand {
  readonly providerProfileId: string;
  readonly request: ProviderSubscriptionRequest;
  seriesKey: CanonicalSeriesKey;
  readonly sinks: Map<number, ProviderDataSink>;
  generation: number;
  invalidated: boolean;
  upstreamSubscription: ProviderSubscription | undefined;
  connectPromise: Promise<void> | undefined;
}

function requireProviderProfileId(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0
  ) {
    throw new RangeError("Provider profile ID is required.");
  }
  return value;
}

function demandKey(
  providerProfileId: string,
  request: ProviderSubscriptionRequest,
): string {
  return JSON.stringify([
    providerProfileId,
    request.instrumentId,
    request.timeframeId,
  ]);
}

function notify(
  demand: LogicalDemand,
  callback: (sink: ProviderDataSink) => void,
): void {
  for (const sink of [...demand.sinks.values()]) {
    try {
      callback(sink);
    } catch {
      // One logical consumer cannot block delivery to other consumers.
    }
  }
}

export function createProviderDataService(
  upstream: ProviderDataUpstream,
  options: ProviderDataServiceOptions = {},
): ProviderDataService {
  const demands = new Map<string, LogicalDemand>();
  const capabilities = new Map<string, ProviderCapabilities>();
  const candleState =
    options.candleState ??
    createCanonicalCandleState({
      ...(options.maximumFinalizedBars === undefined
        ? {}
        : { maximumFinalizedBars: options.maximumFinalizedBars }),
    });
  const tickBuffer = createBoundedTickBuffer(
    options.tickBufferCapacity ?? 4096,
  );
  const now = options.now ?? Date.now;
  let consumerSequence = 0;

  const capabilitiesFor = async (
    providerProfileId: string,
  ): Promise<ProviderCapabilities> => {
    const cached = capabilities.get(providerProfileId);
    if (cached !== undefined) return cached;
    const loaded = await upstream.getCapabilities(providerProfileId);
    capabilities.set(providerProfileId, loaded);
    return loaded;
  };

  const seriesKeyFor = async (
    providerProfileId: string,
    request: ProviderSubscriptionRequest,
  ): Promise<CanonicalSeriesKey> => {
    const capability = timeframeCapabilities(
      await capabilitiesFor(providerProfileId),
    ).find(({ id }) => id === request.timeframeId);
    if (capability === undefined) {
      throw new RangeError("Provider timeframe is unavailable.");
    }
    return Object.freeze({
      providerProfileId,
      instrumentId: request.instrumentId,
      timeframeId: request.timeframeId,
      timeframeSeconds: capability.seconds,
    });
  };

  const connectDemand = (demand: LogicalDemand): Promise<void> => {
    if (
      demand.invalidated ||
      demand.sinks.size === 0 ||
      demand.upstreamSubscription !== undefined
    ) {
      return Promise.resolve();
    }
    if (demand.connectPromise !== undefined) return demand.connectPromise;

    const generation = demand.generation;
    const connection = upstream
      .subscribe(demand.providerProfileId, demand.request, {
        onCandles: (candles): void => {
          if (demand.generation !== generation || demand.invalidated) return;
          try {
            const normalized = normalizeCandles(candles, demand.request);
            candleState.applyCandles(demand.seriesKey, normalized, now());
            notify(demand, (sink) => sink.onCandles(normalized));
          } catch {
            notify(demand, (sink) => sink.onError("PROVIDER_INVALID_CANDLE"));
          }
        },
        onTicks: (ticks): void => {
          if (demand.generation !== generation || demand.invalidated) return;
          try {
            const normalized = normalizeTicks(ticks, demand.request);
            const accepted = tickBuffer.append(
              {
                providerProfileId: demand.providerProfileId,
                instrumentId: demand.request.instrumentId,
              },
              normalized,
            );
            candleState.applyTicks(demand.seriesKey, accepted);
            if (accepted.length > 0)
              notify(demand, (sink) => sink.onTicks(accepted));
          } catch {
            notify(demand, (sink) => sink.onError("PROVIDER_INVALID_TICK"));
          }
        },
        onError: (code): void => {
          if (demand.generation !== generation || demand.invalidated) return;
          notify(demand, (sink) => sink.onError(code));
        },
      })
      .then(async (subscription) => {
        if (
          demand.generation !== generation ||
          demand.invalidated ||
          demand.sinks.size === 0
        ) {
          await subscription.unsubscribe();
          return;
        }
        demand.upstreamSubscription = subscription;
      })
      .finally(() => {
        if (demand.connectPromise === connection)
          demand.connectPromise = undefined;
      });
    demand.connectPromise = connection;
    return connection;
  };

  const releaseDemand = async (
    key: string,
    demand: LogicalDemand,
    consumerId: number,
  ): Promise<void> => {
    demand.sinks.delete(consumerId);
    if (demand.sinks.size !== 0) return;
    demands.delete(key);
    demand.generation += 1;
    await demand.connectPromise?.catch(() => undefined);
    const subscription = demand.upstreamSubscription;
    demand.upstreamSubscription = undefined;
    await subscription?.unsubscribe();
  };

  const subscribe = async (
    providerProfileIdValue: string,
    request: ProviderSubscriptionRequest,
    sink: ProviderDataSink,
  ): Promise<ProviderSubscription> => {
    const providerProfileId = requireProviderProfileId(providerProfileIdValue);
    const key = demandKey(providerProfileId, request);
    let demand = demands.get(key);
    if (demand === undefined) {
      demand = {
        providerProfileId,
        request: Object.freeze({ ...request }),
        seriesKey: await seriesKeyFor(providerProfileId, request),
        sinks: new Map(),
        generation: 0,
        invalidated: false,
        upstreamSubscription: undefined,
        connectPromise: undefined,
      };
      demands.set(key, demand);
    }
    consumerSequence += 1;
    const consumerId = consumerSequence;
    demand.sinks.set(consumerId, sink);
    try {
      await connectDemand(demand);
    } catch (error) {
      demand.sinks.delete(consumerId);
      if (demand.sinks.size === 0) demands.delete(key);
      throw error;
    }

    let disposed = false;
    return {
      unsubscribe: async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        await releaseDemand(key, demand, consumerId);
      },
    };
  };

  const invalidateProfile = async (
    providerProfileIdValue: string,
  ): Promise<void> => {
    const providerProfileId = requireProviderProfileId(providerProfileIdValue);
    capabilities.delete(providerProfileId);
    const matching = [...demands.values()].filter(
      (demand) => demand.providerProfileId === providerProfileId,
    );
    await Promise.all(
      matching.map(async (demand) => {
        demand.invalidated = true;
        demand.generation += 1;
        await demand.connectPromise?.catch(() => undefined);
        const subscription = demand.upstreamSubscription;
        demand.upstreamSubscription = undefined;
        await subscription?.unsubscribe();
      }),
    );
  };

  const restoreProfile = async (
    providerProfileIdValue: string,
  ): Promise<void> => {
    const providerProfileId = requireProviderProfileId(providerProfileIdValue);
    const matching = [...demands.values()].filter(
      (demand) => demand.providerProfileId === providerProfileId,
    );
    for (const demand of matching) {
      demand.seriesKey = await seriesKeyFor(providerProfileId, demand.request);
      demand.invalidated = false;
    }
    try {
      await Promise.all(matching.map((demand) => connectDemand(demand)));
    } catch (error) {
      for (const demand of matching) {
        notify(demand, (sink) =>
          sink.onError("PROVIDER_SUBSCRIPTION_RESTORE_FAILED"),
        );
      }
      throw error;
    }
  };

  return {
    getCapabilities: (providerProfileId) =>
      capabilitiesFor(requireProviderProfileId(providerProfileId)),
    getInstruments: (providerProfileId) =>
      upstream.getInstruments(requireProviderProfileId(providerProfileId)),
    requestHistory: async (providerProfileIdValue, request) => {
      const providerProfileId = requireProviderProfileId(
        providerProfileIdValue,
      );
      const normalized = normalizeCandles(
        await upstream.requestHistory(providerProfileId, request),
        request,
      );
      candleState.loadHistory(
        await seriesKeyFor(providerProfileId, request),
        normalized,
        now(),
      );
      return normalized;
    },
    subscribe,
    seriesSnapshot: async (providerProfileIdValue, request) => {
      const providerProfileId = requireProviderProfileId(
        providerProfileIdValue,
      );
      return candleState.snapshot(
        await seriesKeyFor(providerProfileId, request),
      );
    },
    tickSnapshot: (providerProfileIdValue, instrumentId) =>
      tickBuffer.snapshot({
        providerProfileId: requireProviderProfileId(providerProfileIdValue),
        instrumentId,
      }),
    invalidateProfile,
    restoreProfile,
    shutdown: async (): Promise<void> => {
      const active = [...demands.values()];
      demands.clear();
      capabilities.clear();
      await Promise.all(
        active.map(async (demand) => {
          demand.invalidated = true;
          demand.generation += 1;
          await demand.connectPromise?.catch(() => undefined);
          const subscription = demand.upstreamSubscription;
          demand.upstreamSubscription = undefined;
          demand.sinks.clear();
          await subscription?.unsubscribe();
        }),
      );
    },
  };
}
