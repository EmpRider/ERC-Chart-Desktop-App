import type { Candle, ProviderSeriesChange } from "@erc-chart/contracts";
import {
  sourceProvenanceForCandleType,
  transformIndicatorCandles,
  type IndicatorCandleType,
  type IndicatorSourceProvenance,
} from "./candle-transform.js";

export type {
  IndicatorCandleType,
  IndicatorSourceProvenance,
} from "./candle-transform.js";

export interface IndicatorSourceKey {
  readonly providerProfileId: string;
  readonly instrumentId: string;
  readonly timeframeId: string;
  readonly candleType: IndicatorCandleType;
}

export interface IndicatorSourceHistoryRequest {
  readonly instrumentId: string;
  readonly timeframeId: string;
  readonly limit: number;
}

export interface IndicatorSourceLiveRequest {
  readonly instrumentId: string;
  readonly timeframeId: string;
}

export interface IndicatorSourceLiveSink {
  readonly onCandles: (
    candles: readonly Candle[],
    series: ProviderSeriesChange,
  ) => void;
  readonly onTicks: (ticks: readonly unknown[]) => void;
  readonly onError: (code: string) => void;
}

export interface IndicatorSourceSubscription {
  readonly unsubscribe: () => Promise<void>;
}

export interface IndicatorSourceDataService {
  readonly requestHistory: (
    providerProfileId: string,
    request: IndicatorSourceHistoryRequest,
  ) => Promise<readonly Candle[]>;
  readonly subscribe: (
    providerProfileId: string,
    request: IndicatorSourceLiveRequest,
    sink: IndicatorSourceLiveSink,
  ) => Promise<IndicatorSourceSubscription>;
}

export interface IndicatorSourceSnapshot {
  readonly key: IndicatorSourceKey;
  readonly candles: readonly Candle[];
  readonly provenance: IndicatorSourceProvenance;
  readonly generation: number;
  readonly revision: number;
}

export interface IndicatorSourceLease {
  readonly key: IndicatorSourceKey;
  readonly snapshot: () => IndicatorSourceSnapshot;
  readonly release: () => Promise<void>;
}

export interface IndicatorSourceEngine {
  readonly acquire: (key: IndicatorSourceKey) => Promise<IndicatorSourceLease>;
  readonly dispose: () => Promise<void>;
}

interface SharedSource {
  readonly key: IndicatorSourceKey;
  rawCandles: readonly Candle[];
  snapshot: IndicatorSourceSnapshot;
  subscription: IndicatorSourceSubscription | undefined;
  references: number;
  closed: boolean;
}

const maximumIndicatorSourceBars = 100_000;

function requireIdentifier(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 256
  ) {
    throw new RangeError(`${label} is invalid.`);
  }
  return value;
}

function normalizeKey(key: IndicatorSourceKey): IndicatorSourceKey {
  const candleType = key.candleType;
  if (candleType !== "standard" && candleType !== "heikin-ashi") {
    throw new RangeError("Indicator candle transform is not available.");
  }
  return Object.freeze({
    providerProfileId: requireIdentifier(
      key.providerProfileId,
      "Provider profile ID",
    ),
    instrumentId: requireIdentifier(key.instrumentId, "Instrument ID"),
    timeframeId: requireIdentifier(key.timeframeId, "Timeframe ID"),
    candleType,
  });
}

function sourceIdentity(key: IndicatorSourceKey): string {
  return JSON.stringify([
    key.providerProfileId,
    key.instrumentId,
    key.timeframeId,
    key.candleType,
  ]);
}

function candlesMatchSource(
  key: IndicatorSourceKey,
  candles: readonly Candle[],
): boolean {
  return candles.every(
    (candle) =>
      candle.instrumentId === key.instrumentId &&
      candle.timeframeId === key.timeframeId &&
      Number.isSafeInteger(candle.openTimeMs) &&
      candle.openTimeMs >= 0,
  );
}

function boundedCandles(candles: readonly Candle[]): readonly Candle[] {
  return Object.freeze(
    [...candles]
      .sort((left, right) => left.openTimeMs - right.openTimeMs)
      .slice(-maximumIndicatorSourceBars),
  );
}

function mergeIncrementalCandles(
  current: readonly Candle[],
  incoming: readonly Candle[],
): readonly Candle[] {
  const byOpenTime = new Map<number, Candle>();
  for (const candle of current) byOpenTime.set(candle.openTimeMs, candle);
  for (const candle of incoming) byOpenTime.set(candle.openTimeMs, candle);
  return boundedCandles([...byOpenTime.values()]);
}

function acceptSeriesChange(
  current: IndicatorSourceSnapshot,
  series: ProviderSeriesChange,
): boolean {
  if (series.generation < current.generation) return false;
  if (series.generation > current.generation) return true;
  if (series.revision <= current.revision) return false;
  return series.previousRevision === current.revision;
}

export function createIndicatorSourceEngine(
  dataService: IndicatorSourceDataService,
): IndicatorSourceEngine {
  const sources = new Map<string, Promise<SharedSource>>();
  let disposed = false;

  const closeSource = async (source: SharedSource): Promise<void> => {
    if (source.closed) return;
    source.closed = true;
    const subscription = source.subscription;
    source.subscription = undefined;
    await subscription?.unsubscribe();
  };

  const createSource = async (
    key: IndicatorSourceKey,
  ): Promise<SharedSource> => {
    const history = await dataService.requestHistory(key.providerProfileId, {
      instrumentId: key.instrumentId,
      timeframeId: key.timeframeId,
      limit: maximumIndicatorSourceBars,
    });
    if (!candlesMatchSource(key, history)) {
      throw new Error(
        "Indicator source history does not match its source key.",
      );
    }
    const rawHistory = boundedCandles(history);
    const source: SharedSource = {
      key,
      rawCandles: rawHistory,
      snapshot: Object.freeze({
        key,
        candles: transformIndicatorCandles(key.candleType, rawHistory),
        provenance: sourceProvenanceForCandleType(key.candleType),
        generation: 0,
        revision: 0,
      }),
      subscription: undefined,
      references: 0,
      closed: false,
    };
    const subscription = await dataService.subscribe(
      key.providerProfileId,
      {
        instrumentId: key.instrumentId,
        timeframeId: key.timeframeId,
      },
      {
        onCandles: (candles, series): void => {
          if (
            source.closed ||
            !candlesMatchSource(source.key, candles) ||
            !acceptSeriesChange(source.snapshot, series)
          ) {
            return;
          }
          const nextRawCandles =
            series.kind === "rebuild"
              ? boundedCandles(candles)
              : mergeIncrementalCandles(source.rawCandles, candles);
          source.rawCandles = nextRawCandles;
          source.snapshot = Object.freeze({
            key: source.key,
            candles: transformIndicatorCandles(
              source.key.candleType,
              nextRawCandles,
            ),
            provenance: sourceProvenanceForCandleType(source.key.candleType),
            generation: series.generation,
            revision: series.revision,
          });
        },
        onTicks: () => undefined,
        onError: () => undefined,
      },
    );
    source.subscription = subscription;
    return source;
  };

  const sourceFor = (key: IndicatorSourceKey): Promise<SharedSource> => {
    const identity = sourceIdentity(key);
    const existing = sources.get(identity);
    if (existing !== undefined) return existing;
    const pending = createSource(key);
    sources.set(identity, pending);
    void pending.catch(() => {
      if (sources.get(identity) === pending) sources.delete(identity);
    });
    return pending;
  };

  return {
    acquire: async (keyValue): Promise<IndicatorSourceLease> => {
      if (disposed) throw new Error("Indicator source engine is disposed.");
      const key = normalizeKey(keyValue);
      const identity = sourceIdentity(key);
      let pending = sourceFor(key);
      let source = await pending;
      if (!disposed && source.closed) {
        if (sources.get(identity) === pending) sources.delete(identity);
        pending = sourceFor(key);
        source = await pending;
      }
      if (disposed || source.closed) {
        if (sources.get(identity) === pending) sources.delete(identity);
        await closeSource(source);
        throw new Error("Indicator source engine is disposed.");
      }
      source.references += 1;
      let released = false;
      return Object.freeze({
        key: source.key,
        snapshot: () => source.snapshot,
        release: async (): Promise<void> => {
          if (released) return;
          released = true;
          source.references = Math.max(0, source.references - 1);
          if (source.references !== 0 || source.closed) return;
          if (sources.get(identity) === pending) sources.delete(identity);
          await closeSource(source);
        },
      });
    },
    dispose: async (): Promise<void> => {
      if (disposed) return;
      disposed = true;
      const pendingSources = [...new Set(sources.values())];
      sources.clear();
      const loaded = await Promise.allSettled(pendingSources);
      const cleanup = await Promise.allSettled(
        loaded.flatMap((result) =>
          result.status === "fulfilled" ? [closeSource(result.value)] : [],
        ),
      );
      if (cleanup.some(({ status }) => status === "rejected")) {
        throw new Error("Indicator source cleanup failed.");
      }
    },
  };
}
