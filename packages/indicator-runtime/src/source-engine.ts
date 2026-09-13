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

export function createIndicatorSourceEngine(
  dataService: IndicatorSourceDataService,
): IndicatorSourceEngine {
  const subscriptions = new Set<IndicatorSourceSubscription>();
  let disposed = false;

  return {
    acquire: async (keyValue): Promise<IndicatorSourceLease> => {
      if (disposed) throw new Error("Indicator source engine is disposed.");
      const key = normalizeKey(keyValue);
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
      if (disposed) {
        await subscription.unsubscribe();
        throw new Error("Indicator source engine is disposed.");
      }
      subscriptions.add(subscription);
      let released = false;
      const snapshot = Object.freeze({ key, candles });
      return Object.freeze({
        key,
        snapshot: () => snapshot,
        release: async (): Promise<void> => {
          if (released) return;
          released = true;
          subscriptions.delete(subscription);
          await subscription.unsubscribe();
        },
      });
    },
    dispose: async (): Promise<void> => {
      if (disposed) return;
      disposed = true;
      const active = [...subscriptions];
      subscriptions.clear();
      const results = await Promise.allSettled(
        active.map((subscription) => subscription.unsubscribe()),
      );
      if (results.some(({ status }) => status === "rejected")) {
        throw new Error("Indicator source cleanup failed.");
      }
    },
  };
}
