import type { DatabaseSync } from "node:sqlite";
import type { Candle } from "@erc-chart/contracts";
import {
  getCandlesInRange,
  getNewestCandles,
  retainNewestCandles,
  upsertCandles,
  type CandleSeriesKey,
  type StoredCandle,
} from "@erc-chart/storage";
import type {
  CanonicalCandle,
  CanonicalSeriesKey,
} from "./canonical-series.js";

export interface CandleGap {
  readonly fromOpenTimeMs: number;
  readonly toOpenTimeMs: number;
}

export interface HistoricalCandleCache {
  readonly newest: (
    key: CanonicalSeriesKey,
    limit: number,
  ) => readonly CanonicalCandle[];
  readonly range: (
    key: CanonicalSeriesKey,
    fromOpenTimeMs: number,
    toOpenTimeMs: number,
    limit?: number,
  ) => readonly CanonicalCandle[];
  readonly upsert: (
    key: CanonicalSeriesKey,
    candles: readonly CanonicalCandle[],
  ) => number;
  readonly retain: (key: CanonicalSeriesKey, maximumBars: number) => number;
}

function storageKey(key: CanonicalSeriesKey): CandleSeriesKey {
  const identity = key.cacheIdentity;
  if (identity === undefined || identity.version !== 1) {
    throw new Error("Canonical cache identity is required.");
  }
  const cacheKey = JSON.stringify([
    key.providerProfileId,
    key.instrumentId,
    identity.providerFingerprint,
    identity.targetTimeframeId,
    identity.targetTimeframeSeconds,
    identity.targetAlignmentMode,
    identity.targetAlignmentOriginMs,
    identity.targetAlignmentTimeZone,
    identity.sourceTimeframeId,
    identity.sourceTimeframeSeconds,
    identity.sourceAlignmentMode,
    identity.sourceAlignmentOriginMs,
    identity.sourceAlignmentTimeZone,
  ]);
  return {
    cacheKeyVersion: identity.version,
    cacheKey,
    feedId: key.providerProfileId,
    instrumentId: key.instrumentId,
    timeframeSec: key.timeframeSeconds,
  };
}

function fromStored(
  key: CanonicalSeriesKey,
  candle: StoredCandle,
): CanonicalCandle {
  return Object.freeze({
    instrumentId: key.instrumentId,
    timeframeId: key.timeframeId,
    openTimeMs: candle.openTimeMs,
    closeTimeMs: candle.openTimeMs + key.timeframeSeconds * 1000,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    ...(candle.volume === undefined ? {} : { volume: candle.volume }),
    isFinal: true,
    revision: candle.revision,
  });
}

export function createHistoricalCandleCache(
  database: DatabaseSync,
): HistoricalCandleCache {
  return {
    newest: (key, limit) =>
      Object.freeze(
        getNewestCandles(database, storageKey(key), limit).map((candle) =>
          fromStored(key, candle),
        ),
      ),
    range: (key, fromOpenTimeMs, toOpenTimeMs, limit = 100_000) =>
      Object.freeze(
        getCandlesInRange(
          database,
          storageKey(key),
          fromOpenTimeMs,
          toOpenTimeMs,
          limit,
        ).map((candle) => fromStored(key, candle)),
      ),
    upsert: (key, candles) =>
      upsertCandles(
        database,
        candles.map((candle) => ({
          ...storageKey(key),
          openTimeMs: candle.openTimeMs,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          ...(candle.volume === undefined ? {} : { volume: candle.volume }),
          revision: candle.revision,
        })),
      ),
    retain: (key, maximumBars) =>
      retainNewestCandles(database, storageKey(key), maximumBars),
  };
}

export function findCandleGaps(
  candles: readonly Pick<Candle, "openTimeMs">[],
  timeframeSeconds: number,
  bounds?: {
    readonly fromOpenTimeMs?: number;
    readonly toOpenTimeMs?: number;
  },
): readonly CandleGap[] {
  if (!Number.isSafeInteger(timeframeSeconds) || timeframeSeconds <= 0) {
    throw new RangeError("Timeframe seconds must be a positive safe integer.");
  }
  const stepMs = timeframeSeconds * 1000;
  const times = [...new Set(candles.map(({ openTimeMs }) => openTimeMs))].sort(
    (left, right) => left - right,
  );
  const first = bounds?.fromOpenTimeMs ?? times[0];
  const last = bounds?.toOpenTimeMs ?? times.at(-1);
  if (first === undefined || last === undefined || last < first) return [];
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) {
    throw new RangeError("Gap bounds must be safe integer timestamps.");
  }
  const present = new Set(times);
  const gaps: CandleGap[] = [];
  let gapStart: number | undefined;
  for (let timestamp = first; timestamp <= last; timestamp += stepMs) {
    if (!present.has(timestamp)) {
      gapStart ??= timestamp;
      continue;
    }
    if (gapStart !== undefined) {
      gaps.push({ fromOpenTimeMs: gapStart, toOpenTimeMs: timestamp - stepMs });
      gapStart = undefined;
    }
  }
  if (gapStart !== undefined) {
    gaps.push({ fromOpenTimeMs: gapStart, toOpenTimeMs: last });
  }
  return Object.freeze(gaps.map((gap) => Object.freeze(gap)));
}
