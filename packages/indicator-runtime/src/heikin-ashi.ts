import type { Candle } from "@erc-chart/contracts";

function transformCandle(raw: Candle, previous: Candle | undefined): Candle {
  const close = (raw.open + raw.high + raw.low + raw.close) / 4;
  const open =
    previous === undefined
      ? (raw.open + raw.close) / 2
      : (previous.open + previous.close) / 2;
  return Object.freeze({
    ...raw,
    open,
    high: Math.max(raw.high, open, close),
    low: Math.min(raw.low, open, close),
    close,
  });
}

/**
 * Transforms a chronological standard-OHLC series into Heikin Ashi candles.
 * Duplicate tail timestamps are recalculated from the last finalized HA state,
 * so provisional updates never compound previous provisional output.
 */
export function toHeikinAshiCandles(
  candles: readonly Candle[],
): readonly Candle[] {
  const transformed: Candle[] = [];
  let previousBeforeTimestamp: Candle | undefined;
  let activeTimestamp: number | undefined;

  for (const raw of candles) {
    if (activeTimestamp === raw.openTimeMs) {
      transformed[transformed.length - 1] = transformCandle(
        raw,
        previousBeforeTimestamp,
      );
      continue;
    }
    previousBeforeTimestamp = transformed.at(-1);
    activeTimestamp = raw.openTimeMs;
    transformed.push(transformCandle(raw, previousBeforeTimestamp));
  }

  return Object.freeze(transformed);
}
