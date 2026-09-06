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
import { findCandleGaps } from "./history-cache.js";
import {
  aggregateTimeframeCandles,
  alignedOpenTime,
  resolveTimeframePlan,
  timeframeCapabilities,
  type TimeframePlan,
} from "./timeframes.js";

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
  plan: TimeframePlan;
  sourceRequest: ProviderSubscriptionRequest;
  readonly sourceCandles: Map<number, Candle>;
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

  const planFor = async (
    providerProfileId: string,
    timeframeId: string,
  ): Promise<TimeframePlan> =>
    resolveTimeframePlan(await capabilitiesFor(providerProfileId), timeframeId);

  const sourceRequestFor = (
    request: ProviderSubscriptionRequest,
    plan: TimeframePlan,
  ): ProviderSubscriptionRequest =>
    Object.freeze({
      instrumentId: request.instrumentId,
      timeframeId: plan.source.id,
    });

  const requestNormalizedHistory = async (
    providerProfileId: string,
    request: ProviderHistoryRequest,
  ): Promise<readonly Candle[]> => {
    const plan = await planFor(providerProfileId, request.timeframeId);
    const ratio = Math.max(
      1,
      Math.ceil(plan.target.seconds / plan.source.seconds),
    );
    const sourceRequest: ProviderHistoryRequest = plan.target.native
      ? request
      : {
          instrumentId: request.instrumentId,
          timeframeId: plan.source.id,
          ...(request.fromMs === undefined
            ? {}
            : {
                fromMs: alignedOpenTime(
                  request.fromMs,
                  plan.target.seconds,
                  plan.target.alignment,
                ),
              }),
          ...(request.toMs === undefined ? {} : { toMs: request.toMs }),
          ...(request.limit === undefined
            ? {}
            : { limit: Math.min(100_000, request.limit * ratio + ratio) }),
        };
    const source = normalizeCandles(
      await upstream.requestHistory(providerProfileId, sourceRequest),
      sourceRequest,
    );
    return normalizeCandles(
      plan.target.native
        ? source
        : aggregateTimeframeCandles(source, plan.target)
            .filter(
              (candle) =>
                (request.fromMs === undefined ||
                  candle.openTimeMs >= request.fromMs) &&
                (request.toMs === undefined ||
                  candle.openTimeMs <= request.toMs),
            )
            .slice(-(request.limit ?? Number.MAX_SAFE_INTEGER)),
      request,
    );
  };

  const derivedCandlesForLiveBatch = (
    demand: LogicalDemand,
    sourceCandles: readonly Candle[],
  ): readonly Candle[] => {
    if (demand.plan.target.native) return sourceCandles;
    for (const candle of sourceCandles)
      demand.sourceCandles.set(candle.openTimeMs, candle);
    while (demand.sourceCandles.size > 10_000) {
      const oldest = Math.min(...demand.sourceCandles.keys());
      demand.sourceCandles.delete(oldest);
    }
    const touched = new Set(
      sourceCandles.map((candle) =>
        alignedOpenTime(
          candle.openTimeMs,
          demand.plan.target.seconds,
          demand.plan.target.alignment,
        ),
      ),
    );
    return aggregateTimeframeCandles(
      [...demand.sourceCandles.values()],
      demand.plan.target,
    ).filter((candle) => touched.has(candle.openTimeMs));
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
      .subscribe(demand.providerProfileId, demand.sourceRequest, {
        onCandles: (candles): void => {
          if (demand.generation !== generation || demand.invalidated) return;
          try {
            const normalizedSource = normalizeCandles(
              candles,
              demand.sourceRequest,
            );
            const normalized = normalizeCandles(
              derivedCandlesForLiveBatch(demand, normalizedSource),
              demand.request,
            );
            if (normalized.length > 0) {
              candleState.applyCandles(demand.seriesKey, normalized, now());
              notify(demand, (sink) => sink.onCandles(normalized));
            }
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
            const deltas = candleState.applyTicks(demand.seriesKey, accepted);
            const generatedCandles = deltas.flatMap(({ candle }) =>
              candle === undefined
                ? []
                : [
                    Object.freeze({
                      instrumentId: candle.instrumentId,
                      timeframeId: candle.timeframeId,
                      openTimeMs: candle.openTimeMs,
                      open: candle.open,
                      high: candle.high,
                      low: candle.low,
                      close: candle.close,
                      ...(candle.volume === undefined
                        ? {}
                        : { volume: candle.volume }),
                    }),
                  ],
            );
            if (generatedCandles.length > 0)
              notify(demand, (sink) => sink.onCandles(generatedCandles));
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
      const plan = await planFor(providerProfileId, request.timeframeId);
      demand = {
        providerProfileId,
        request: Object.freeze({ ...request }),
        seriesKey: await seriesKeyFor(providerProfileId, request),
        plan,
        sourceRequest: sourceRequestFor(request, plan),
        sourceCandles: new Map(),
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
      demand.plan = await planFor(
        providerProfileId,
        demand.request.timeframeId,
      );
      demand.seriesKey = await seriesKeyFor(providerProfileId, demand.request);
      demand.sourceRequest = sourceRequestFor(demand.request, demand.plan);
      demand.sourceCandles.clear();
      demand.invalidated = false;
    }
    try {
      for (const demand of matching) {
        const snapshot = candleState.snapshot(demand.seriesKey);
        const known = [
          ...candleState.finalizedCandles(demand.seriesKey),
          ...(snapshot.building === undefined ? [] : [snapshot.building]),
        ];
        const firstOpenTimeMs = known[0]?.openTimeMs;
        if (firstOpenTimeMs === undefined) continue;

        const currentOpenTimeMs = alignedOpenTime(
          now(),
          demand.plan.target.seconds,
          demand.plan.target.alignment,
        );
        const gaps = findCandleGaps(known, demand.plan.target.seconds, {
          fromOpenTimeMs: firstOpenTimeMs,
          toOpenTimeMs: currentOpenTimeMs,
        });
        if (gaps.length === 0) continue;

        const repaired: Candle[] = [];
        for (const gap of gaps) {
          const count =
            Math.floor(
              (gap.toOpenTimeMs - gap.fromOpenTimeMs) /
                (demand.plan.target.seconds * 1000),
            ) + 1;
          repaired.push(
            ...(await requestNormalizedHistory(providerProfileId, {
              instrumentId: demand.request.instrumentId,
              timeframeId: demand.request.timeframeId,
              fromMs: gap.fromOpenTimeMs,
              toMs: gap.toOpenTimeMs,
              limit: Math.min(100_000, count),
            })),
          );
        }
        if (repaired.length === 0) continue;

        const merged = new Map<number, Candle>();
        for (const candle of [...known, ...repaired]) {
          merged.set(candle.openTimeMs, {
            instrumentId: candle.instrumentId,
            timeframeId: candle.timeframeId,
            openTimeMs: candle.openTimeMs,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            ...(candle.volume === undefined ? {} : { volume: candle.volume }),
          });
        }
        candleState.loadHistory(demand.seriesKey, [...merged.values()], now());
        const delivered = Object.freeze(
          [...repaired].sort(
            (left, right) => left.openTimeMs - right.openTimeMs,
          ),
        );
        notify(demand, (sink) => sink.onCandles(delivered));
      }
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
      const normalized = await requestNormalizedHistory(
        providerProfileId,
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
