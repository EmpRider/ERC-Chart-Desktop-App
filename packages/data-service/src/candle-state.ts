import type { Candle, Tick } from "@erc-chart/contracts";
import {
  createCanonicalSeriesStore,
  type CanonicalCandle,
  type CanonicalSeriesDelta,
  type CanonicalSeriesKey,
  type CanonicalSeriesSnapshot,
  type CanonicalSeriesStore,
} from "./canonical-series.js";
import type { HistoricalCandleCache } from "./history-cache.js";
import { normalizeCandles, normalizeTicks } from "./market-data-validation.js";

export interface CandleStateOptions {
  readonly store?: CanonicalSeriesStore;
  readonly cache?: HistoricalCandleCache;
  readonly maximumFinalizedBars?: number;
}

export interface CanonicalCandleState {
  readonly loadHistory: (
    key: CanonicalSeriesKey,
    candles: readonly Candle[],
    nowMs: number,
  ) => readonly CanonicalSeriesDelta[];
  readonly applyCandles: (
    key: CanonicalSeriesKey,
    candles: readonly Candle[],
    nowMs: number,
  ) => readonly CanonicalSeriesDelta[];
  readonly applyTicks: (
    key: CanonicalSeriesKey,
    ticks: readonly Tick[],
  ) => readonly CanonicalSeriesDelta[];
  readonly snapshot: (key: CanonicalSeriesKey) => CanonicalSeriesSnapshot;
  readonly finalizedCandles: (
    key: CanonicalSeriesKey,
  ) => readonly CanonicalCandle[];
  readonly clearProfile: (providerProfileId: string) => void;
}

const defaultMaximumFinalizedBars = 100_000;

function requireNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("Current time must be a non-negative safe integer.");
  return value;
}

function bucketOpenTime(timestampMs: number, timeframeSeconds: number): number {
  const durationMs = timeframeSeconds * 1000;
  return Math.floor(timestampMs / durationMs) * durationMs;
}

function candleFromTick(
  key: CanonicalSeriesKey,
  tick: Tick,
  current?: Candle,
): Candle {
  const openTimeMs = bucketOpenTime(tick.timestampMs, key.timeframeSeconds);
  if (current === undefined || current.openTimeMs !== openTimeMs) {
    return Object.freeze({
      instrumentId: key.instrumentId,
      timeframeId: key.timeframeId,
      openTimeMs,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      ...(tick.volume === undefined ? {} : { volume: tick.volume }),
    });
  }
  return Object.freeze({
    instrumentId: key.instrumentId,
    timeframeId: key.timeframeId,
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

export function createCanonicalCandleState(
  options: CandleStateOptions = {},
): CanonicalCandleState {
  const store = options.store ?? createCanonicalSeriesStore();
  const cache = options.cache;
  const maximumFinalizedBars =
    options.maximumFinalizedBars ?? defaultMaximumFinalizedBars;
  if (
    !Number.isSafeInteger(maximumFinalizedBars) ||
    maximumFinalizedBars < 1 ||
    maximumFinalizedBars > 1_000_000
  ) {
    throw new RangeError(
      "Maximum finalized bars must be a positive bounded integer.",
    );
  }

  const persistAndRetain = (
    key: CanonicalSeriesKey,
    finalized: readonly CanonicalCandle[],
  ): void => {
    if (cache !== undefined && finalized.length > 0)
      cache.upsert(key, finalized);
    const trim = store.trimFinalized(key, maximumFinalizedBars);
    if (trim !== undefined) cache?.retain(key, maximumFinalizedBars);
  };

  const changedFinalizedCandles = (
    deltas: readonly CanonicalSeriesDelta[],
  ): readonly CanonicalCandle[] =>
    deltas.flatMap((delta) =>
      (delta.kind === "bar-finalized" || delta.kind === "bar-revised") &&
      delta.candle !== undefined
        ? [delta.candle]
        : [],
    );

  const loadHistory = (
    key: CanonicalSeriesKey,
    input: readonly Candle[],
    nowValue: number,
  ): readonly CanonicalSeriesDelta[] => {
    const nowMs = requireNow(nowValue);
    const candles = [...normalizeCandles(input, key)].sort(
      (left, right) => left.openTimeMs - right.openTimeMs,
    );
    const finalized: Candle[] = [];
    let building: Candle | undefined;
    for (const candle of candles) {
      const closeTimeMs = candle.openTimeMs + key.timeframeSeconds * 1000;
      if (closeTimeMs <= nowMs) {
        finalized.push(candle);
      } else if (
        building === undefined ||
        candle.openTimeMs > building.openTimeMs
      ) {
        building = candle;
      }
    }
    const delta = store.replaceHistory(key, finalized, building);
    persistAndRetain(key, store.finalizedCandles(key));
    return Object.freeze([delta]);
  };

  const applyCandles = (
    key: CanonicalSeriesKey,
    input: readonly Candle[],
    nowValue: number,
  ): readonly CanonicalSeriesDelta[] => {
    const nowMs = requireNow(nowValue);
    const candles = [...normalizeCandles(input, key)].sort(
      (left, right) => left.openTimeMs - right.openTimeMs,
    );
    const deltas: CanonicalSeriesDelta[] = [];
    for (const candle of candles) {
      const latestFinalized = store.latestFinalized(key);
      if (
        latestFinalized !== undefined &&
        candle.openTimeMs <= latestFinalized.openTimeMs
      ) {
        const revised = store.upsertFinalized(key, candle);
        if (revised !== undefined) deltas.push(revised);
        continue;
      }
      const building = store.buildingCandle(key);
      if (building !== undefined && candle.openTimeMs > building.openTimeMs) {
        const finalized = store.finalizeBuilding(key);
        if (finalized !== undefined) deltas.push(finalized);
      }
      const closeTimeMs = candle.openTimeMs + key.timeframeSeconds * 1000;
      if (closeTimeMs <= nowMs) {
        const finalized = store.upsertFinalized(key, candle);
        if (finalized !== undefined) deltas.push(finalized);
      } else {
        const updated = store.updateBuilding(key, candle);
        if (updated !== undefined) deltas.push(updated);
      }
    }
    const changedFinalized = changedFinalizedCandles(deltas);
    if (changedFinalized.length > 0) persistAndRetain(key, changedFinalized);
    return Object.freeze(deltas);
  };

  const applyTicks = (
    key: CanonicalSeriesKey,
    input: readonly Tick[],
  ): readonly CanonicalSeriesDelta[] => {
    const ticks = [
      ...normalizeTicks(input, { instrumentId: key.instrumentId }),
    ].sort((left, right) => left.timestampMs - right.timestampMs);
    const deltas: CanonicalSeriesDelta[] = [];
    for (const tick of ticks) {
      const openTimeMs = bucketOpenTime(tick.timestampMs, key.timeframeSeconds);
      const latestFinalized = store.latestFinalized(key);
      if (
        latestFinalized !== undefined &&
        openTimeMs <= latestFinalized.openTimeMs
      ) {
        continue;
      }
      let building = store.buildingCandle(key);
      if (building !== undefined && openTimeMs < building.openTimeMs) continue;
      if (building !== undefined && openTimeMs > building.openTimeMs) {
        const finalized = store.finalizeBuilding(key);
        if (finalized !== undefined) deltas.push(finalized);
        building = undefined;
      }
      const updated = store.updateBuilding(
        key,
        candleFromTick(key, tick, building),
      );
      if (updated !== undefined) deltas.push(updated);
    }
    const changedFinalized = changedFinalizedCandles(deltas);
    if (changedFinalized.length > 0) persistAndRetain(key, changedFinalized);
    return Object.freeze(deltas);
  };

  return {
    loadHistory,
    applyCandles,
    applyTicks,
    snapshot: (key) => store.snapshot(key),
    finalizedCandles: (key) => store.finalizedCandles(key),
    clearProfile: (providerProfileId) => store.clearProfile(providerProfileId),
  };
}
