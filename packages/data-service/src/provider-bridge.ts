import type { Candle, ProviderSeriesChange, Tick } from "@erc-chart/contracts";
import type {
  ProviderCapabilities,
  ProviderDataSink,
  ProviderHistoryRequest,
  ProviderInstrument,
  ProviderSubscription,
  ProviderSubscriptionRequest,
  ProviderTimeframeCapability,
} from "@erc-chart/provider-sdk";
import { normalizeCandles, normalizeTicks } from "./market-data-validation.js";
import {
  createCanonicalCandleState,
  type CanonicalCandleState,
} from "./candle-state.js";
import type {
  CanonicalCacheIdentity,
  CanonicalSeriesKey,
  CanonicalSeriesSnapshot,
} from "./canonical-series.js";
import { createBoundedTickBuffer } from "./tick-buffer.js";
import { findCandleGaps, type HistoricalCandleCache } from "./history-cache.js";
import {
  aggregateTimeframeCandles,
  alignedOpenTime,
  resolveTimeframePlan,
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
  readonly subscribe: (
    providerProfileId: string,
    request: ProviderSubscriptionRequest,
    sink: ProviderDataServiceSink,
  ) => Promise<ProviderSubscription>;
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

export interface ProviderDataServiceSink {
  readonly onCandles: (
    candles: readonly Candle[],
    series: ProviderSeriesChange,
  ) => void;
  readonly onTicks: ProviderDataSink["onTicks"];
  readonly onError: ProviderDataSink["onError"];
}

export interface ProviderDataServiceOptions {
  readonly now?: () => number;
  readonly maximumFinalizedBars?: number;
  readonly tickBufferCapacity?: number;
  readonly candleState?: CanonicalCandleState;
  readonly historyCache?: HistoricalCandleCache;
  readonly cacheFingerprintForProfile?: (providerProfileId: string) => string;
  readonly onCacheError?: (operation: "read" | "write", error: unknown) => void;
}

interface LogicalDemand {
  readonly key: string;
  readonly providerProfileId: string;
  readonly request: ProviderSubscriptionRequest;
  seriesKey: CanonicalSeriesKey;
  plan: TimeframePlan;
  source: NativeSource;
  readonly sinks: Map<number, ProviderDataServiceSink>;
  invalidated: boolean;
}

interface NativeSource {
  readonly key: string;
  readonly providerProfileId: string;
  readonly instrumentId: ProviderSubscriptionRequest["instrumentId"];
  readonly providerFingerprint: string;
  capability: ProviderTimeframeCapability;
  request: ProviderSubscriptionRequest;
  readonly candles: Map<number, Candle>;
  readonly candleVersions: Map<number, number>;
  readonly targets: Set<LogicalDemand>;
  mutationSequence: number;
  generation: number;
  profileEpoch: number;
  invalidated: boolean;
  upstreamSubscription: ProviderSubscription | undefined;
  connectPromise: Promise<void> | undefined;
}

interface CapabilityLoad {
  readonly epoch: number;
  readonly promise: Promise<ProviderCapabilities>;
}

interface NormalizedHistoryResult {
  readonly candles: readonly Candle[];
  readonly plan: TimeframePlan;
  readonly seriesKey: CanonicalSeriesKey;
  readonly source: NativeSource;
}

const maximumSourceBars = 100_000;

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

function sourceKey(
  providerProfileId: string,
  instrumentId: string,
  capability: ProviderTimeframeCapability,
  providerFingerprint = "",
): string {
  return JSON.stringify([
    providerProfileId,
    instrumentId,
    providerFingerprint,
    capability.id,
    capability.seconds,
    capability.alignment.mode,
    capability.alignment.originMs,
    capability.alignment.timeZone,
  ]);
}

function cacheIdentityForPlan(
  providerFingerprint: string,
  plan: TimeframePlan,
): CanonicalCacheIdentity {
  return Object.freeze({
    version: 1,
    providerFingerprint,
    targetTimeframeId: plan.target.id,
    targetTimeframeSeconds: plan.target.seconds,
    targetAlignmentMode: plan.target.alignment.mode,
    targetAlignmentOriginMs: plan.target.alignment.originMs,
    targetAlignmentTimeZone: plan.target.alignment.timeZone,
    sourceTimeframeId: plan.source.id,
    sourceTimeframeSeconds: plan.source.seconds,
    sourceAlignmentMode: plan.source.alignment.mode,
    sourceAlignmentOriginMs: plan.source.alignment.originMs,
    sourceAlignmentTimeZone: plan.source.alignment.timeZone,
  });
}

function sourceCacheIdentity(
  providerFingerprint: string,
  source: ProviderTimeframeCapability,
): CanonicalCacheIdentity {
  return Object.freeze({
    version: 1,
    providerFingerprint,
    targetTimeframeId: source.id,
    targetTimeframeSeconds: source.seconds,
    targetAlignmentMode: source.alignment.mode,
    targetAlignmentOriginMs: source.alignment.originMs,
    targetAlignmentTimeZone: source.alignment.timeZone,
    sourceTimeframeId: source.id,
    sourceTimeframeSeconds: source.seconds,
    sourceAlignmentMode: source.alignment.mode,
    sourceAlignmentOriginMs: source.alignment.originMs,
    sourceAlignmentTimeZone: source.alignment.timeZone,
  });
}

function seriesKeyForPlan(
  providerProfileId: string,
  request: ProviderSubscriptionRequest,
  plan: TimeframePlan,
  providerFingerprint = "",
): CanonicalSeriesKey {
  return Object.freeze({
    providerProfileId,
    instrumentId: request.instrumentId,
    timeframeId: request.timeframeId,
    timeframeSeconds: plan.target.seconds,
    ...(providerFingerprint.length === 0
      ? {}
      : { cacheIdentity: cacheIdentityForPlan(providerFingerprint, plan) }),
  });
}

function sourceCacheKey(source: NativeSource): CanonicalSeriesKey {
  return Object.freeze({
    providerProfileId: source.providerProfileId,
    instrumentId: source.instrumentId,
    timeframeId: source.capability.id,
    timeframeSeconds: source.capability.seconds,
    cacheIdentity: sourceCacheIdentity(
      source.providerFingerprint,
      source.capability,
    ),
  });
}

function sourceRequestFor(
  request: ProviderSubscriptionRequest,
  plan: TimeframePlan,
): ProviderSubscriptionRequest {
  return Object.freeze({
    instrumentId: request.instrumentId,
    timeframeId: plan.source.id,
  });
}

function notify(
  demand: LogicalDemand,
  callback: (sink: ProviderDataServiceSink) => void,
): void {
  for (const sink of [...demand.sinks.values()]) {
    try {
      callback(sink);
    } catch {
      // One logical consumer cannot block delivery to other consumers.
    }
  }
}

function seriesChangeFor(
  deltas: readonly import("./canonical-series.js").CanonicalSeriesDelta[],
): ProviderSeriesChange | undefined {
  const latest = deltas.at(-1);
  if (latest === undefined) return undefined;
  const dirtyFromOpenTimeMs = deltas.reduce<number | undefined>(
    (current, delta) => {
      if (delta.dirtyFromOpenTimeMs === undefined) return current;
      return current === undefined
        ? delta.dirtyFromOpenTimeMs
        : Math.min(current, delta.dirtyFromOpenTimeMs);
    },
    undefined,
  );
  const rebuild =
    dirtyFromOpenTimeMs !== undefined ||
    deltas.some(
      ({ kind }) =>
        kind === "history-replaced" ||
        kind === "bar-revised" ||
        kind === "retention-trimmed",
    );
  return Object.freeze({
    generation: latest.generation,
    revision: latest.revision,
    previousRevision: (deltas[0]?.revision ?? latest.revision) - 1,
    kind: rebuild ? "rebuild" : "incremental",
    ...(dirtyFromOpenTimeMs === undefined ? {} : { dirtyFromOpenTimeMs }),
  });
}

function plainCandle(candle: Candle): Candle {
  return Object.freeze({
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

function deliveredCandlesForChange(
  candleState: CanonicalCandleState,
  key: CanonicalSeriesKey,
  change: ProviderSeriesChange,
  incremental: readonly Candle[],
): readonly Candle[] {
  if (change.kind !== "rebuild") return incremental;
  const snapshot = candleState.snapshot(key);
  return Object.freeze([
    ...candleState.finalizedCandles(key).map(plainCandle),
    ...(snapshot.building === undefined
      ? []
      : [plainCandle(snapshot.building)]),
  ]);
}

function sourceCandleFromTick(source: NativeSource, tick: Tick): Candle {
  const openTimeMs = alignedOpenTime(
    tick.timestampMs,
    source.capability.seconds,
    source.capability.alignment,
  );
  const current = source.candles.get(openTimeMs);
  if (current === undefined) {
    return Object.freeze({
      instrumentId: source.instrumentId,
      timeframeId: source.capability.id,
      openTimeMs,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      ...(tick.volume === undefined ? {} : { volume: tick.volume }),
    });
  }
  return Object.freeze({
    instrumentId: source.instrumentId,
    timeframeId: source.capability.id,
    openTimeMs,
    open: current.open,
    high: Math.max(current.high, tick.price),
    low: Math.min(current.low, tick.price),
    close: tick.price,
    ...(current.volume === undefined && tick.volume === undefined
      ? {}
      : { volume: (current.volume ?? 0) + (tick.volume ?? 0) }),
  });
}

function retainSourceTail(source: NativeSource): void {
  if (source.candles.size <= maximumSourceBars) return;
  const ordered = [...source.candles.keys()].sort(
    (left, right) => left - right,
  );
  const removeCount = ordered.length - maximumSourceBars;
  for (let index = 0; index < removeCount; index += 1) {
    const openTimeMs = ordered[index];
    if (openTimeMs === undefined) continue;
    source.candles.delete(openTimeMs);
    source.candleVersions.delete(openTimeMs);
  }
}

export function createProviderDataService(
  upstream: ProviderDataUpstream,
  options: ProviderDataServiceOptions = {},
): ProviderDataService {
  const demands = new Map<string, LogicalDemand>();
  const sources = new Map<string, NativeSource>();
  const capabilities = new Map<string, ProviderCapabilities>();
  const capabilityLoads = new Map<string, CapabilityLoad>();
  const profileEpochs = new Map<string, number>();
  const invalidatedProfiles = new Set<string>();
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
  const historyCache = options.historyCache;
  const maximumFinalizedBars = options.maximumFinalizedBars ?? 100_000;
  let consumerSequence = 0;
  let closed = false;

  const reportCacheError = (
    operation: "read" | "write",
    error: unknown,
  ): void => {
    try {
      options.onCacheError?.(operation, error);
    } catch {
      // Diagnostics cannot turn recoverable cache failures into data failures.
    }
  };

  const providerFingerprintFor = (providerProfileId: string): string => {
    if (historyCache === undefined) return "";
    const fingerprint = options.cacheFingerprintForProfile?.(providerProfileId);
    if (
      typeof fingerprint !== "string" ||
      fingerprint.length === 0 ||
      fingerprint.length > 8_192
    ) {
      throw new Error("Provider cache fingerprint is unavailable.");
    }
    return fingerprint;
  };

  const persistSourceCandles = (
    source: NativeSource,
    candles: readonly Candle[],
  ): void => {
    if (historyCache === undefined || source.providerFingerprint.length === 0)
      return;
    const finalized = candles
      .filter(
        (candle) =>
          candle.openTimeMs + source.capability.seconds * 1000 <= now(),
      )
      .map((candle) =>
        Object.freeze({
          ...plainCandle(candle),
          closeTimeMs: candle.openTimeMs + source.capability.seconds * 1000,
          isFinal: true,
          revision: 0,
        }),
      );
    if (finalized.length === 0) return;
    try {
      const key = sourceCacheKey(source);
      historyCache.upsert(key, finalized);
      historyCache.retain(key, maximumFinalizedBars);
    } catch (error) {
      reportCacheError("write", error);
    }
  };

  const epochFor = (providerProfileId: string): number =>
    profileEpochs.get(providerProfileId) ?? 0;

  const assertEpoch = (
    providerProfileId: string,
    epoch: number,
    message = "Provider operation was invalidated.",
  ): void => {
    if (closed) throw new Error("Provider data service is shut down.");
    if (epoch !== epochFor(providerProfileId)) throw new Error(message);
  };

  const capabilitiesFor = (
    providerProfileId: string,
    epoch = epochFor(providerProfileId),
  ): Promise<ProviderCapabilities> => {
    try {
      assertEpoch(providerProfileId, epoch);
    } catch (error) {
      return Promise.reject(error);
    }
    const cached = capabilities.get(providerProfileId);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = capabilityLoads.get(providerProfileId);
    if (pending !== undefined && pending.epoch === epoch)
      return pending.promise;

    const promise = upstream
      .getCapabilities(providerProfileId)
      .then((loaded) => {
        assertEpoch(providerProfileId, epoch);
        capabilities.set(providerProfileId, loaded);
        return loaded;
      })
      .finally(() => {
        if (capabilityLoads.get(providerProfileId)?.promise === promise)
          capabilityLoads.delete(providerProfileId);
      });
    capabilityLoads.set(providerProfileId, { epoch, promise });
    return promise;
  };

  const planFor = async (
    providerProfileId: string,
    timeframeId: string,
    epoch = epochFor(providerProfileId),
  ): Promise<TimeframePlan> => {
    const plan = resolveTimeframePlan(
      await capabilitiesFor(providerProfileId, epoch),
      timeframeId,
    );
    assertEpoch(providerProfileId, epoch);
    return plan;
  };

  const ensureSource = (
    providerProfileId: string,
    request: ProviderSubscriptionRequest,
    plan: TimeframePlan,
    epoch: number,
  ): NativeSource => {
    assertEpoch(providerProfileId, epoch);
    const providerFingerprint = providerFingerprintFor(providerProfileId);
    const key = sourceKey(
      providerProfileId,
      request.instrumentId,
      plan.source,
      providerFingerprint,
    );
    const existing = sources.get(key);
    if (existing !== undefined) return existing;
    const source: NativeSource = {
      key,
      providerProfileId,
      instrumentId: request.instrumentId,
      providerFingerprint,
      capability: plan.source,
      request: sourceRequestFor(request, plan),
      candles: new Map(),
      candleVersions: new Map(),
      targets: new Set(),
      mutationSequence: 0,
      generation: 0,
      profileEpoch: epoch,
      invalidated: invalidatedProfiles.has(providerProfileId),
      upstreamSubscription: undefined,
      connectPromise: undefined,
    };
    sources.set(key, source);
    return source;
  };

  const sourceIsCurrent = (source: NativeSource, generation: number): boolean =>
    !closed &&
    !source.invalidated &&
    source.generation === generation &&
    source.profileEpoch === epochFor(source.providerProfileId) &&
    sources.get(source.key) === source;

  const targetIsCurrent = (target: LogicalDemand): boolean =>
    !closed &&
    !target.invalidated &&
    demands.get(target.key) === target &&
    target.source.targets.has(target);

  const projectSourceCandles = (
    target: LogicalDemand,
    changedSource: readonly Candle[],
  ): readonly Candle[] => {
    if (changedSource.length === 0) return [];
    if (target.plan.target.native) {
      return normalizeCandles(changedSource, target.request);
    }
    const touched = new Set(
      changedSource.map((candle) =>
        alignedOpenTime(
          candle.openTimeMs,
          target.plan.target.seconds,
          target.plan.target.alignment,
        ),
      ),
    );
    const constituents: Candle[] = [];
    // Visit only the fixed source slots in each touched bucket, never the history tail.
    const sourceDurationMs = target.plan.source.seconds * 1000;
    const targetDurationMs = target.plan.target.seconds * 1000;
    for (const openTimeMs of touched) {
      for (
        let time = openTimeMs;
        time < openTimeMs + targetDurationMs;
        time += sourceDurationMs
      ) {
        const candle = target.source.candles.get(time);
        if (candle !== undefined) constituents.push(candle);
      }
    }
    return normalizeCandles(
      aggregateTimeframeCandles(constituents, target.plan.target).filter(
        (candle) => touched.has(candle.openTimeMs),
      ),
      target.request,
    );
  };

  const deliverSourceCandles = (
    source: NativeSource,
    changedSource: readonly Candle[],
  ): void => {
    for (const target of [...source.targets]) {
      if (!targetIsCurrent(target)) continue;
      try {
        const projected = projectSourceCandles(target, changedSource);
        if (projected.length === 0) continue;
        const deltas = candleState.applyCandles(
          target.seriesKey,
          projected,
          now(),
        );
        const series = seriesChangeFor(deltas);
        if (series === undefined) continue;
        const delivered = deliveredCandlesForChange(
          candleState,
          target.seriesKey,
          series,
          projected,
        );
        notify(target, (sink) => sink.onCandles(delivered, series));
      } catch {
        notify(target, (sink) => sink.onError("PROVIDER_INVALID_CANDLE"));
      }
    }
  };

  const mergeSourceCandles = (
    source: NativeSource,
    candles: readonly Candle[],
    startedMutationSequence?: number,
  ): readonly Candle[] => {
    const changed: Candle[] = [];
    for (const candle of candles) {
      const observedAt = source.candleVersions.get(candle.openTimeMs) ?? 0;
      if (
        startedMutationSequence !== undefined &&
        observedAt > startedMutationSequence
      ) {
        continue;
      }
      source.mutationSequence += 1;
      source.candles.set(candle.openTimeMs, candle);
      source.candleVersions.set(candle.openTimeMs, source.mutationSequence);
      changed.push(candle);
    }
    retainSourceTail(source);
    return Object.freeze(changed);
  };

  const applyAcceptedTicksToSource = (
    source: NativeSource,
    ticks: readonly Tick[],
  ): void => {
    for (const tick of ticks) {
      const candle = sourceCandleFromTick(source, tick);
      source.mutationSequence += 1;
      source.candles.set(candle.openTimeMs, candle);
      source.candleVersions.set(candle.openTimeMs, source.mutationSequence);
      retainSourceTail(source);
      for (const target of [...source.targets]) {
        if (!targetIsCurrent(target)) continue;
        try {
          if (target.plan.target.native) {
            const deltas = candleState.applyTicks(
              target.seriesKey,
              [tick],
              target.plan.target.alignment,
            );
            const generated = deltas.flatMap(({ candle: changed }) =>
              changed === undefined ? [] : [plainCandle(changed)],
            );
            const series = seriesChangeFor(deltas);
            if (generated.length > 0 && series !== undefined) {
              const delivered = deliveredCandlesForChange(
                candleState,
                target.seriesKey,
                series,
                generated,
              );
              notify(target, (sink) => sink.onCandles(delivered, series));
            }
            continue;
          }
          const projected = projectSourceCandles(target, [candle]);
          const latestFinalized = candleState.latestFinalized(target.seriesKey);
          const live = projected.filter(
            ({ openTimeMs }) =>
              latestFinalized === undefined ||
              openTimeMs > latestFinalized.openTimeMs,
          );
          if (live.length === 0) continue;
          const deltas = candleState.applyCandles(
            target.seriesKey,
            live,
            now(),
          );
          const series = seriesChangeFor(deltas);
          if (series === undefined) continue;
          const delivered = deliveredCandlesForChange(
            candleState,
            target.seriesKey,
            series,
            live,
          );
          notify(target, (sink) => sink.onCandles(delivered, series));
        } catch {
          notify(target, (sink) => sink.onError("PROVIDER_INVALID_TICK"));
        }
      }
    }
    if (ticks.length > 0) {
      for (const target of [...source.targets]) {
        if (targetIsCurrent(target))
          notify(target, (sink) => sink.onTicks(ticks));
      }
    }
  };

  const fanoutAcceptedTicks = (
    providerProfileId: string,
    instrumentId: string,
    ticks: readonly Tick[],
  ): void => {
    if (ticks.length === 0) return;
    for (const source of [...sources.values()]) {
      if (
        source.providerProfileId !== providerProfileId ||
        source.instrumentId !== instrumentId ||
        source.invalidated ||
        source.targets.size === 0
      ) {
        continue;
      }
      applyAcceptedTicksToSource(source, ticks);
    }
  };

  const connectSource = (source: NativeSource): Promise<void> => {
    if (closed)
      return Promise.reject(new Error("Provider data service is shut down."));
    if (
      source.invalidated ||
      source.targets.size === 0 ||
      source.upstreamSubscription !== undefined
    ) {
      return Promise.resolve();
    }
    if (source.connectPromise !== undefined) return source.connectPromise;

    const generation = source.generation;
    const epoch = source.profileEpoch;
    const connection = upstream
      .subscribe(source.providerProfileId, source.request, {
        onCandles: (candles): void => {
          if (!sourceIsCurrent(source, generation)) return;
          try {
            const normalized = normalizeCandles(candles, source.request);
            const changed = mergeSourceCandles(source, normalized);
            deliverSourceCandles(source, changed);
          } catch {
            for (const target of [...source.targets]) {
              if (targetIsCurrent(target))
                notify(target, (sink) =>
                  sink.onError("PROVIDER_INVALID_CANDLE"),
                );
            }
          }
        },
        onTicks: (ticks): void => {
          if (!sourceIsCurrent(source, generation)) return;
          try {
            const normalized = normalizeTicks(ticks, source.request);
            const accepted = tickBuffer.append(
              {
                providerProfileId: source.providerProfileId,
                instrumentId: source.instrumentId,
              },
              normalized,
            );
            fanoutAcceptedTicks(
              source.providerProfileId,
              source.instrumentId,
              accepted,
            );
          } catch {
            for (const target of [...source.targets]) {
              if (targetIsCurrent(target))
                notify(target, (sink) => sink.onError("PROVIDER_INVALID_TICK"));
            }
          }
        },
        onError: (code): void => {
          if (!sourceIsCurrent(source, generation)) return;
          for (const target of [...source.targets]) {
            if (targetIsCurrent(target))
              notify(target, (sink) => sink.onError(code));
          }
        },
      })
      .then(async (subscription) => {
        if (
          closed ||
          source.generation !== generation ||
          source.invalidated ||
          source.targets.size === 0 ||
          source.profileEpoch !== epochFor(source.providerProfileId) ||
          sources.get(source.key) !== source ||
          epoch !== source.profileEpoch
        ) {
          await subscription.unsubscribe();
          throw new Error("Provider demand acquisition was invalidated.");
        }
        source.upstreamSubscription = subscription;
      })
      .finally(() => {
        if (source.connectPromise === connection)
          source.connectPromise = undefined;
      });
    source.connectPromise = connection;
    return connection;
  };

  const stopSource = async (
    source: NativeSource,
    removeFromRegistry: boolean,
  ): Promise<void> => {
    source.generation += 1;
    if (removeFromRegistry && sources.get(source.key) === source)
      sources.delete(source.key);
    await source.connectPromise?.catch(() => undefined);
    const subscription = source.upstreamSubscription;
    source.upstreamSubscription = undefined;
    await subscription?.unsubscribe();
  };

  const detachTargetIfUnused = async (target: LogicalDemand): Promise<void> => {
    if (target.sinks.size !== 0) return;
    if (demands.get(target.key) === target) demands.delete(target.key);
    const source = target.source;
    source.targets.delete(target);
    if (source.targets.size === 0) await stopSource(source, true);
  };

  const removeConsumer = async (
    target: LogicalDemand,
    consumerId: number,
  ): Promise<void> => {
    target.sinks.delete(consumerId);
    await detachTargetIfUnused(target);
  };

  const requestNormalizedHistory = async (
    providerProfileId: string,
    request: ProviderHistoryRequest,
    allowInvalidated = false,
  ): Promise<NormalizedHistoryResult> => {
    if (!allowInvalidated && invalidatedProfiles.has(providerProfileId))
      throw new Error("Provider profile is invalidated.");
    const epoch = epochFor(providerProfileId);
    const plan = await planFor(providerProfileId, request.timeframeId, epoch);
    assertEpoch(providerProfileId, epoch);
    const source = ensureSource(providerProfileId, request, plan, epoch);
    const seriesKey = seriesKeyForPlan(
      providerProfileId,
      request,
      plan,
      source.providerFingerprint,
    );
    const sourceGeneration = source.generation;
    const ratio = Math.max(
      1,
      Math.ceil(plan.target.seconds / plan.source.seconds),
    );
    if (!Number.isSafeInteger(ratio) || ratio > maximumSourceBars)
      throw new RangeError(
        "Derived timeframe ratio exceeds the supported source tail.",
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

    const assertSourceCurrent = (): void => {
      assertEpoch(
        providerProfileId,
        epoch,
        "Provider history request was invalidated.",
      );
      if (
        source.generation !== sourceGeneration ||
        source.profileEpoch !== epoch ||
        sources.get(source.key) !== source
      ) {
        throw new Error("Provider history request was invalidated.");
      }
    };

    const fetchProvider = async (
      providerRequest: ProviderHistoryRequest,
      startedMutationSequence: number,
    ): Promise<readonly Candle[]> => {
      const normalized = normalizeCandles(
        await upstream.requestHistory(providerProfileId, providerRequest),
        providerRequest,
      );
      assertSourceCurrent();
      mergeSourceCandles(source, normalized, startedMutationSequence);
      persistSourceCandles(source, normalized);
      return normalized;
    };

    const cache = historyCache;
    let cacheUsable =
      cache !== undefined && source.providerFingerprint.length > 0;
    let cached: readonly Candle[] = [];
    if (cacheUsable && cache !== undefined) {
      try {
        const key = sourceCacheKey(source);
        const sourceLimit = Math.min(
          maximumSourceBars,
          sourceRequest.limit ?? request.limit ?? maximumSourceBars,
        );
        const rows =
          sourceRequest.fromMs !== undefined && sourceRequest.toMs !== undefined
            ? cache.range(
                key,
                sourceRequest.fromMs,
                sourceRequest.toMs,
                sourceLimit,
              )
            : cache.newest(key, sourceLimit);
        cached = Object.freeze(rows.map(plainCandle));
        const absent = cached.filter(
          ({ openTimeMs }) => !source.candles.has(openTimeMs),
        );
        mergeSourceCandles(source, absent);
      } catch (error) {
        cacheUsable = false;
        cached = [];
        reportCacheError("read", error);
      }
    }

    if (!cacheUsable) {
      await fetchProvider(sourceRequest, source.mutationSequence);
    } else if (
      sourceRequest.fromMs !== undefined &&
      sourceRequest.toMs !== undefined
    ) {
      const { fromMs, toMs } = sourceRequest;
      const inRange = [...source.candles.values()].filter(
        ({ openTimeMs }) => openTimeMs >= fromMs && openTimeMs <= toMs,
      );
      const gaps = findCandleGaps(inRange, plan.source.seconds, {
        fromOpenTimeMs: sourceRequest.fromMs,
        toOpenTimeMs: sourceRequest.toMs,
      });
      for (const gap of gaps) {
        const count =
          Math.floor(
            (gap.toOpenTimeMs - gap.fromOpenTimeMs) /
              (plan.source.seconds * 1000),
          ) + 1;
        await fetchProvider(
          {
            instrumentId: request.instrumentId,
            timeframeId: plan.source.id,
            fromMs: gap.fromOpenTimeMs,
            toMs: gap.toOpenTimeMs,
            limit: Math.min(maximumSourceBars, count),
          },
          source.mutationSequence,
        );
      }
    } else {
      const sourceLimit = Math.min(
        maximumSourceBars,
        sourceRequest.limit ?? request.limit ?? maximumSourceBars,
      );
      const latestCached = cached.at(-1);
      if (latestCached === undefined) {
        await fetchProvider(sourceRequest, source.mutationSequence);
      } else {
        const stepMs = plan.source.seconds * 1000;
        const currentOpenTimeMs = alignedOpenTime(
          now(),
          plan.source.seconds,
          plan.source.alignment,
        );
        const latestCachedOpenTimeMs = latestCached.openTimeMs;
        const newestWindowStart =
          currentOpenTimeMs - Math.max(0, sourceLimit - 1) * stepMs;
        const refreshFromMs = Math.max(
          latestCachedOpenTimeMs,
          newestWindowStart,
        );
        await fetchProvider(
          {
            instrumentId: request.instrumentId,
            timeframeId: plan.source.id,
            fromMs: refreshFromMs,
            toMs: currentOpenTimeMs,
            limit: sourceLimit,
          },
          source.mutationSequence,
        );
      }
    }

    assertSourceCurrent();
    const allSource = [...source.candles.values()].sort(
      (left, right) => left.openTimeMs - right.openTimeMs,
    );
    const projected = plan.target.native
      ? allSource
      : aggregateTimeframeCandles(allSource, plan.target);
    const filtered = projected
      .filter(
        (candle) =>
          (request.fromMs === undefined ||
            candle.openTimeMs >= request.fromMs) &&
          (request.toMs === undefined || candle.openTimeMs <= request.toMs),
      )
      .slice(-(request.limit ?? Number.MAX_SAFE_INTEGER));
    return {
      candles: normalizeCandles(filtered, request),
      plan,
      seriesKey,
      source,
    };
  };

  const applyHistoryToTarget = (
    key: CanonicalSeriesKey,
    candles: readonly Candle[],
  ): readonly import("./canonical-series.js").CanonicalSeriesDelta[] => {
    const snapshot = candleState.snapshot(key);
    if (snapshot.timeMs.length === 0 && snapshot.building === undefined)
      return candleState.loadHistory(key, candles, now());
    return candleState.applyCandles(key, candles, now());
  };

  const subscribe = async (
    providerProfileIdValue: string,
    request: ProviderSubscriptionRequest,
    sink: ProviderDataServiceSink,
  ): Promise<ProviderSubscription> => {
    const providerProfileId = requireProviderProfileId(providerProfileIdValue);
    if (invalidatedProfiles.has(providerProfileId))
      throw new Error("Provider profile is invalidated.");
    const epoch = epochFor(providerProfileId);
    const plan = await planFor(providerProfileId, request.timeframeId, epoch);
    assertEpoch(
      providerProfileId,
      epoch,
      "Provider demand acquisition was invalidated.",
    );
    const key = demandKey(providerProfileId, request);
    let target = demands.get(key);
    if (target === undefined) {
      const source = ensureSource(providerProfileId, request, plan, epoch);
      target = {
        key,
        providerProfileId,
        request: Object.freeze({ ...request }),
        seriesKey: seriesKeyForPlan(providerProfileId, request, plan),
        plan,
        source,
        sinks: new Map(),
        invalidated: false,
      };
      demands.set(key, target);
      source.targets.add(target);
    }

    consumerSequence += 1;
    const consumerId = consumerSequence;
    target.sinks.set(consumerId, sink);
    try {
      await connectSource(target.source);
      assertEpoch(
        providerProfileId,
        epoch,
        "Provider demand acquisition was invalidated.",
      );
      if (!targetIsCurrent(target))
        throw new Error("Provider demand acquisition was invalidated.");
    } catch (error) {
      target.sinks.delete(consumerId);
      await detachTargetIfUnused(target).catch(() => undefined);
      throw error;
    }

    let disposed = false;
    return {
      unsubscribe: async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        await removeConsumer(target, consumerId);
      },
    };
  };

  const invalidateProfile = async (
    providerProfileIdValue: string,
  ): Promise<void> => {
    const providerProfileId = requireProviderProfileId(providerProfileIdValue);
    const nextEpoch = epochFor(providerProfileId) + 1;
    profileEpochs.set(providerProfileId, nextEpoch);
    invalidatedProfiles.add(providerProfileId);
    capabilities.delete(providerProfileId);
    capabilityLoads.delete(providerProfileId);

    const matchingTargets = [...demands.values()].filter(
      (target) => target.providerProfileId === providerProfileId,
    );
    for (const target of matchingTargets) target.invalidated = true;
    const matchingSources = [...sources.values()].filter(
      (source) => source.providerProfileId === providerProfileId,
    );
    for (const source of matchingSources) {
      source.invalidated = true;
      source.profileEpoch = nextEpoch;
    }
    const results = await Promise.allSettled(
      matchingSources.map((source) => stopSource(source, false)),
    );
    if (results.some(({ status }) => status === "rejected"))
      throw new Error("Provider invalidation cleanup failed.");
  };

  const hydrateDerivedCurrentBucket = async (
    target: LogicalDemand,
  ): Promise<void> => {
    if (target.plan.target.native) return;
    const targetOpenTimeMs = alignedOpenTime(
      now(),
      target.plan.target.seconds,
      target.plan.target.alignment,
    );
    const sourceCurrentOpenTimeMs = alignedOpenTime(
      now(),
      target.plan.source.seconds,
      target.plan.source.alignment,
    );
    const ratio = Math.ceil(
      target.plan.target.seconds / target.plan.source.seconds,
    );
    const source = target.source;
    const startedMutationSequence = source.mutationSequence;
    const generation = source.generation;
    const epoch = source.profileEpoch;
    const sourceRequest: ProviderHistoryRequest = {
      instrumentId: target.request.instrumentId,
      timeframeId: target.plan.source.id,
      fromMs: targetOpenTimeMs,
      toMs: sourceCurrentOpenTimeMs,
      limit: Math.min(100_000, ratio + 2),
    };
    const normalized = normalizeCandles(
      await upstream.requestHistory(target.providerProfileId, sourceRequest),
      sourceRequest,
    );
    assertEpoch(
      target.providerProfileId,
      epoch,
      "Provider restore hydration was invalidated.",
    );
    if (source.generation !== generation || sources.get(source.key) !== source)
      throw new Error("Provider restore hydration was invalidated.");
    const changed = mergeSourceCandles(
      source,
      normalized,
      startedMutationSequence,
    );
    const currentBucketConstituents = [...source.candles.values()].filter(
      (candle) =>
        alignedOpenTime(
          candle.openTimeMs,
          target.plan.target.seconds,
          target.plan.target.alignment,
        ) === targetOpenTimeMs,
    );
    const projected = normalizeCandles(
      aggregateTimeframeCandles(
        currentBucketConstituents,
        target.plan.target,
      ).filter((candle) => candle.openTimeMs === targetOpenTimeMs),
      target.request,
    );
    if (projected.length === 0 && changed.length > 0)
      throw new Error("Provider restore hydration was incomplete.");
    if (projected.length === 0) return;
    const deltas = candleState.applyCandles(target.seriesKey, projected, now());
    const series = seriesChangeFor(deltas);
    if (series === undefined) return;
    const delivered = deliveredCandlesForChange(
      candleState,
      target.seriesKey,
      series,
      projected,
    );
    notify(target, (sink) => sink.onCandles(delivered, series));
  };

  const restoreProfile = async (
    providerProfileIdValue: string,
  ): Promise<void> => {
    const providerProfileId = requireProviderProfileId(providerProfileIdValue);
    const epoch = epochFor(providerProfileId);
    const providerCapabilities = await capabilitiesFor(
      providerProfileId,
      epoch,
    );
    assertEpoch(providerProfileId, epoch);
    const matching = [...demands.values()].filter(
      (target) => target.providerProfileId === providerProfileId,
    );

    for (const target of matching) {
      const plan = resolveTimeframePlan(
        providerCapabilities,
        target.request.timeframeId,
      );
      const nextSource = ensureSource(
        providerProfileId,
        target.request,
        plan,
        epoch,
      );
      if (target.source !== nextSource) {
        target.source.targets.delete(target);
        target.source = nextSource;
        nextSource.targets.add(target);
      }
      target.plan = plan;
      target.seriesKey = seriesKeyForPlan(
        providerProfileId,
        target.request,
        plan,
      );
      target.invalidated = true;
      nextSource.capability = plan.source;
      nextSource.request = sourceRequestFor(target.request, plan);
      nextSource.profileEpoch = epoch;
      nextSource.invalidated = true;
    }

    try {
      for (const target of matching) {
        const snapshot = candleState.snapshot(target.seriesKey);
        const known = [
          ...candleState.finalizedCandles(target.seriesKey),
          ...(snapshot.building === undefined ? [] : [snapshot.building]),
        ];
        const firstOpenTimeMs = known[0]?.openTimeMs;
        if (firstOpenTimeMs !== undefined) {
          const currentOpenTimeMs = alignedOpenTime(
            now(),
            target.plan.target.seconds,
            target.plan.target.alignment,
          );
          const gaps = findCandleGaps(known, target.plan.target.seconds, {
            fromOpenTimeMs: firstOpenTimeMs,
            toOpenTimeMs: currentOpenTimeMs,
          });
          const repairedCandles: Candle[] = [];
          for (const gap of gaps) {
            const count =
              Math.floor(
                (gap.toOpenTimeMs - gap.fromOpenTimeMs) /
                  (target.plan.target.seconds * 1000),
              ) + 1;
            const repaired = await requestNormalizedHistory(
              providerProfileId,
              {
                instrumentId: target.request.instrumentId,
                timeframeId: target.request.timeframeId,
                fromMs: gap.fromOpenTimeMs,
                toMs: gap.toOpenTimeMs,
                limit: Math.min(100_000, count),
              },
              true,
            );
            repairedCandles.push(...repaired.candles);
          }
          if (repairedCandles.length > 0) {
            const deliveredRepair = Object.freeze(
              [...repairedCandles].sort(
                (left, right) => left.openTimeMs - right.openTimeMs,
              ),
            );
            const deltas = candleState.applyCandles(
              target.seriesKey,
              deliveredRepair,
              now(),
            );
            const series = seriesChangeFor(deltas);
            if (series !== undefined) {
              const delivered = deliveredCandlesForChange(
                candleState,
                target.seriesKey,
                series,
                deliveredRepair,
              );
              notify(target, (sink) => sink.onCandles(delivered, series));
            }
          }
        }
        await hydrateDerivedCurrentBucket(target);
      }

      invalidatedProfiles.delete(providerProfileId);
      const uniqueSources = new Set(matching.map(({ source }) => source));
      for (const source of uniqueSources) source.invalidated = false;
      for (const target of matching) target.invalidated = false;
      await Promise.all(
        [...uniqueSources].map((source) => connectSource(source)),
      );

      for (const source of [...sources.values()]) {
        if (
          source.providerProfileId === providerProfileId &&
          source.targets.size === 0
        ) {
          await stopSource(source, true);
        }
      }
    } catch (error) {
      for (const target of matching) {
        target.invalidated = true;
        target.source.invalidated = true;
        notify(target, (sink) =>
          sink.onError("PROVIDER_SUBSCRIPTION_RESTORE_FAILED"),
        );
      }
      throw error;
    }
  };

  return {
    getCapabilities: (providerProfileIdValue) => {
      const providerProfileId = requireProviderProfileId(
        providerProfileIdValue,
      );
      return capabilitiesFor(providerProfileId);
    },
    getInstruments: async (providerProfileIdValue) => {
      const providerProfileId = requireProviderProfileId(
        providerProfileIdValue,
      );
      const epoch = epochFor(providerProfileId);
      assertEpoch(providerProfileId, epoch);
      const result = await upstream.getInstruments(providerProfileId);
      assertEpoch(
        providerProfileId,
        epoch,
        "Provider instrument request was invalidated.",
      );
      return result;
    },
    requestHistory: async (providerProfileIdValue, request) => {
      const providerProfileId = requireProviderProfileId(
        providerProfileIdValue,
      );
      const result = await requestNormalizedHistory(providerProfileId, request);
      const before = candleState.snapshot(result.seriesKey);
      const firstOpenTimeMs = before.timeMs[0] ?? before.building?.openTimeMs;
      const deltas = applyHistoryToTarget(result.seriesKey, result.candles);
      const change = seriesChangeFor(deltas);
      const target = demands.get(demandKey(providerProfileId, request));
      if (
        change !== undefined &&
        target !== undefined &&
        targetIsCurrent(target)
      ) {
        const onlyOlder =
          firstOpenTimeMs !== undefined &&
          result.candles.every(
            (candle) => candle.openTimeMs < firstOpenTimeMs,
          ) &&
          !deltas.some(
            (delta) =>
              delta.kind === "retention-trimmed" ||
              delta.kind === "history-replaced",
          );
        if (onlyOlder) {
          // Pagination owns the prepend. Publish its revision with the unchanged
          // live tail so the next tick is not mistaken for a missed update.
          const tail =
            candleState.snapshot(result.seriesKey).building ??
            candleState.latestFinalized(result.seriesKey);
          if (tail !== undefined) {
            const series: ProviderSeriesChange = {
              generation: change.generation,
              revision: change.revision,
              ...(change.previousRevision === undefined
                ? {}
                : { previousRevision: change.previousRevision }),
              kind: "incremental",
            };
            notify(target, (sink) =>
              sink.onCandles([plainCandle(tail)], series),
            );
          }
        } else {
          // An overlapping correction or retention change must still replace
          // the authoritative history for every consumer of this series.
          const delivered = deliveredCandlesForChange(
            candleState,
            result.seriesKey,
            change,
            result.candles,
          );
          notify(target, (sink) => sink.onCandles(delivered, change));
        }
      }
      return result.candles;
    },
    subscribe,
    seriesSnapshot: async (providerProfileIdValue, request) => {
      const providerProfileId = requireProviderProfileId(
        providerProfileIdValue,
      );
      const existing = demands.get(demandKey(providerProfileId, request));
      if (existing !== undefined)
        return candleState.snapshot(existing.seriesKey);
      const epoch = epochFor(providerProfileId);
      const plan = await planFor(providerProfileId, request.timeframeId, epoch);
      return candleState.snapshot(
        seriesKeyForPlan(providerProfileId, request, plan),
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
      if (closed) return;
      closed = true;
      const profileIds = new Set([
        ...profileEpochs.keys(),
        ...[...sources.values()].map(
          ({ providerProfileId }) => providerProfileId,
        ),
        ...[...demands.values()].map(
          ({ providerProfileId }) => providerProfileId,
        ),
      ]);
      for (const providerProfileId of profileIds)
        profileEpochs.set(providerProfileId, epochFor(providerProfileId) + 1);
      capabilities.clear();
      capabilityLoads.clear();
      invalidatedProfiles.clear();
      const activeSources = [...sources.values()];
      for (const target of demands.values()) {
        target.invalidated = true;
        target.sinks.clear();
      }
      demands.clear();
      for (const source of activeSources) source.invalidated = true;
      const results = await Promise.allSettled(
        activeSources.map((source) => stopSource(source, true)),
      );
      sources.clear();
      if (results.some(({ status }) => status === "rejected"))
        throw new Error("Provider data shutdown cleanup failed.");
    },
  };
}
