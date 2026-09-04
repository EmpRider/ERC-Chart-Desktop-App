import type {
  Candle,
  ImportedProviderSession,
  ProviderLiveEvent,
  ProviderLiveRequest,
} from "@erc-chart/contracts";
import { useEffect, useRef, type JSX } from "react";
import type { KLineData, Period } from "klinecharts";

export type ProviderDataSubscriber = (
  request: ProviderLiveRequest,
  listener: (event: ProviderLiveEvent) => void,
) => Promise<() => Promise<void>>;

export interface ProviderChartProps {
  readonly session: ImportedProviderSession;
  readonly subscribeProviderData?: ProviderDataSubscriber | undefined;
  readonly selectedTimeframeId?: string | undefined;
  readonly availableTimeframeIds?: readonly string[] | undefined;
  readonly timeframeLoading?: boolean | undefined;
  readonly onTimeframeChange?: ((timeframeId: string) => void) | undefined;
}

function periodForTimeframe(timeframeId: string): Period {
  const match = /^(\d+)(s|m|h|d)$/u.exec(timeframeId);
  if (match === null) return { type: "minute", span: 1 };
  const span = Number(match[1]);
  const unit = match[2];
  return {
    type:
      unit === "s"
        ? "second"
        : unit === "m"
          ? "minute"
          : unit === "h"
            ? "hour"
            : "day",
    span,
  };
}

function toKLineCandle(candle: Candle): KLineData {
  return {
    timestamp: candle.openTimeMs,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    ...(candle.volume === undefined ? {} : { volume: candle.volume }),
  };
}

export function updateChartData(
  updateData: (data: KLineData) => void,
  candles: readonly Candle[],
): void {
  for (const candle of candles) updateData(toKLineCandle(candle));
}

function toKLineData(session: ImportedProviderSession): KLineData[] {
  return session.candles.map(toKLineCandle);
}

export function ProviderChart({
  session,
  subscribeProviderData,
  selectedTimeframeId = session.timeframeId,
  availableTimeframeIds = [session.timeframeId],
  timeframeLoading = false,
  onTimeframeChange,
}: ProviderChartProps): JSX.Element {
  const chartRoot = useRef<HTMLDivElement>(null);
  const timeframeOptions = availableTimeframeIds.includes(selectedTimeframeId)
    ? availableTimeframeIds
    : [...availableTimeframeIds, selectedTimeframeId];

  useEffect(() => {
    const element = chartRoot.current;
    if (element === null) return;
    let disposed = false;
    let destroy: (() => void) | undefined;
    let unsubscribeProviderData: (() => Promise<void>) | undefined;
    let updateData: ((data: KLineData) => void) | undefined;
    void import("klinecharts").then((module) => {
      if (disposed) return;
      const chart = module.init(element);
      if (chart === null) return;
      destroy = (): void => module.dispose(chart);
      chart.setStyles({
        grid: {
          horizontal: {
            color: "rgba(120, 139, 160, 0.16)",
          },
          vertical: {
            color: "rgba(120, 139, 160, 0.16)",
          },
        },
      });
      const data = toKLineData(session);
      chart.setDataLoader({
        getBars: ({ callback }): void => {
          callback(data);
        },
        subscribeBar: ({ callback }): void => {
          updateData = callback;
        },
        unsubscribeBar: (): void => {
          updateData = undefined;
        },
      });
      chart.setSymbol({
        ticker: session.instrument.symbol,
        pricePrecision: 8,
        volumePrecision: 2,
      });
      chart.setPeriod(periodForTimeframe(session.timeframeId));
      if (subscribeProviderData !== undefined) {
        void subscribeProviderData(
          {
            profileId: session.profileId,
            instrumentId: session.instrument.id,
            timeframeId: session.timeframeId,
          },
          (event): void => {
            if (disposed || event.type !== "candles") return;
            const incrementalUpdate = updateData;
            if (incrementalUpdate !== undefined) {
              updateChartData(incrementalUpdate, event.candles);
            }
          },
        )
          .then((unsubscribe) => {
            if (disposed) {
              void unsubscribe().catch(() => undefined);
              return;
            }
            unsubscribeProviderData = unsubscribe;
          })
          .catch(() => undefined);
      }
    });
    return (): void => {
      disposed = true;
      void unsubscribeProviderData?.().catch(() => undefined);
      destroy?.();
    };
  }, [session, subscribeProviderData]);

  return (
    <section className="provider-chart" aria-label="Provider market data">
      <header className="provider-chart-heading">
        <div>
          <p className="eyebrow">{session.providerName}</p>
          <h2>{session.instrument.symbol}</h2>
        </div>
        <div className="provider-chart-controls">
          {onTimeframeChange === undefined ||
          timeframeOptions.length < 2 ? null : (
            <select
              className="provider-timeframe-select"
              aria-label={`Timeframe for ${session.instrument.symbol}`}
              value={selectedTimeframeId}
              onChange={(event) => onTimeframeChange(event.currentTarget.value)}
            >
              {timeframeOptions.map((timeframeId) => (
                <option value={timeframeId} key={timeframeId}>
                  {timeframeId}
                </option>
              ))}
            </select>
          )}
          <span className="provider-chart-meta">
            {timeframeLoading
              ? `${selectedTimeframeId} · loading`
              : `${session.timeframeId} · ${session.candles.length} candles`}
          </span>
        </div>
      </header>
      <div
        ref={chartRoot}
        className="provider-chart-canvas"
        data-provider-chart
        aria-label={`${session.instrument.symbol} ${session.timeframeId} candlestick chart`}
      />
    </section>
  );
}
