import type { ImportedProviderSession } from "@erc-chart/contracts";
import { useEffect, useRef, type JSX } from "react";
import type { KLineData, Period } from "klinecharts";

export interface ProviderChartProps {
  readonly session: ImportedProviderSession;
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

function toKLineData(session: ImportedProviderSession): KLineData[] {
  return session.candles.map((candle) => ({
    timestamp: candle.openTimeMs,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    ...(candle.volume === undefined ? {} : { volume: candle.volume }),
  }));
}

export function ProviderChart({ session }: ProviderChartProps): JSX.Element {
  const chartRoot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = chartRoot.current;
    if (element === null) return;
    let disposed = false;
    let destroy: (() => void) | undefined;
    void import("klinecharts").then((module) => {
      if (disposed) return;
      const chart = module.init(element);
      if (chart === null) return;
      destroy = (): void => module.dispose(chart);
      const data = toKLineData(session);
      chart.setDataLoader({
        getBars: ({ callback }): void => {
          callback(data);
        },
      });
      chart.setSymbol({
        ticker: session.instrument.symbol,
        pricePrecision: 8,
        volumePrecision: 2,
      });
      chart.setPeriod(periodForTimeframe(session.timeframeId));
    });
    return (): void => {
      disposed = true;
      destroy?.();
    };
  }, [session]);

  return (
    <section className="provider-chart" aria-label="Provider market data">
      <header className="provider-chart-heading">
        <div>
          <p className="eyebrow">{session.providerName}</p>
          <h2>{session.instrument.symbol}</h2>
        </div>
        <span className="provider-chart-meta">
          {session.timeframeId} · {session.candles.length} candles
        </span>
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
