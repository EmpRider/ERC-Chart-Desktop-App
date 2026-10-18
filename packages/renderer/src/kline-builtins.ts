import type { IndicatorTemplate, KLineData } from "klinecharts";

interface AtrResult {
  readonly atr?: number;
}

interface WmaResult {
  readonly wma?: number;
}

export const ercAtrIndicatorTemplate: IndicatorTemplate<AtrResult, number> = {
  name: "ERC_ATR",
  shortName: "ATR",
  calcParams: [14],
  shouldOhlc: true,
  figures: [{ key: "atr", title: "ATR: ", type: "line" }],
  calc: (dataList, indicator) => {
    const length = Math.max(1, Math.round(indicator.calcParams[0] ?? 14));
    let previousClose: number | undefined;
    let runningTrueRange = 0;
    let previousAtr: number | undefined;
    return dataList.map((bar, index): AtrResult => {
      const trueRange = calculateTrueRange(bar, previousClose);
      previousClose = bar.close;
      if (index < length) runningTrueRange += trueRange;
      if (index < length - 1) return {};
      if (index === length - 1) {
        previousAtr = runningTrueRange / length;
        return { atr: previousAtr };
      }
      previousAtr =
        ((previousAtr ?? trueRange) * (length - 1) + trueRange) / length;
      return { atr: previousAtr };
    });
  },
};

function calculateTrueRange(bar: KLineData, previousClose?: number): number {
  if (previousClose === undefined) return bar.high - bar.low;
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - previousClose),
    Math.abs(bar.low - previousClose),
  );
}

export const ercWmaIndicatorTemplate: IndicatorTemplate<WmaResult, number> = {
  name: "ERC_WMA",
  shortName: "WMA",
  series: "price",
  calcParams: [20],
  figures: [{ key: "wma", title: "WMA: ", type: "line" }],
  calc: (dataList, indicator) => {
    const length = Math.max(1, Math.round(indicator.calcParams[0] ?? 20));
    const denominator = (length * (length + 1)) / 2;
    return dataList.map((_, index): WmaResult => {
      if (index < length - 1) return {};
      let weightedTotal = 0;
      for (let offset = 0; offset < length; offset += 1) {
        const bar = dataList[index - length + 1 + offset];
        if (bar === undefined) return {};
        weightedTotal += bar.close * (offset + 1);
      }
      return { wma: weightedTotal / denominator };
    });
  },
};

interface KLineIndicatorRegistry {
  readonly getSupportedIndicators: () => string[];
  readonly registerIndicator: <D = unknown, C = unknown, E = unknown>(
    indicator: IndicatorTemplate<D, C, E>,
  ) => void;
}

export function registerApplicationBuiltInIndicators(
  registry: KLineIndicatorRegistry,
): void {
  const supported = new Set(registry.getSupportedIndicators());
  if (!supported.has(ercAtrIndicatorTemplate.name)) {
    registry.registerIndicator(ercAtrIndicatorTemplate);
  }
  if (!supported.has(ercWmaIndicatorTemplate.name)) {
    registry.registerIndicator(ercWmaIndicatorTemplate);
  }
}
