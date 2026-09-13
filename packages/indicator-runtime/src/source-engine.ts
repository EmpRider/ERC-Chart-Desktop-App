import type { Candle } from "@erc-chart/contracts";

export type IndicatorCandleType = "standard" | "heikin-ashi";

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
  readonly onCandles: (candles: readonly Candle[], series: unknown) => void;
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
  readonly snapshot: IndicatorSourceSnapshot;
  readonly subscription: IndicatorSourceSubscription;
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
  if (candleType !== "standard") {
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

export function createIndicatorSourceEngine(
  dataService: IndicatorSourceDataService,
): IndicatorSourceEngine {
  const sources = new Map<string, Promise<SharedSource>>();
  let disposed = false;

  const closeSource = async (source: SharedSource): Promise<void> => {
    if (source.closed) return;
    source.closed = true;
    await source.subscription.unsubscribe();
  };

  const createSource = async (
    key: IndicatorSourceKey,
  ): Promise<SharedSource> => {
    const candles = Object.freeze([
      ...(await dataService.requestHistory(key.providerProfileId, {
        instrumentId: key.instrumentId,
        timeframeId: key.timeframeId,
        limit: maximumIndicatorSourceBars,
      })),
    ]);
    const subscription = await dataService.subscribe(
      key.providerProfileId,
      {
        instrumentId: key.instrumentId,
        timeframeId: key.timeframeId,
      },
      {
        onCandles: () => undefined,
        onTicks: () => undefined,
        onError: () => undefined,
      },
    );
    return {
      key,
      snapshot: Object.freeze({ key, candles }),
      subscription,
      references: 0,
      closed: false,
    };
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
      const pending = sourceFor(key);
      const source = await pending;
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
