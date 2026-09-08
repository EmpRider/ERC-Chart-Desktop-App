import type { Candle } from "@erc-chart/contracts";
import { authoringFrame, useKernel } from "./authoring-context.js";

/** Scalar recurrence: every building update starts from the previous committed bar. */
export function series<T extends number | string | boolean>(
  initial: T,
  update: (previous: T) => T,
): T {
  const frame = authoringFrame();
  const state = useKernel(`series-${typeof initial}`, () => ({
    committed: initial,
  }));
  const value = update(state.committed);
  if (typeof value !== typeof initial)
    throw new TypeError("Series state must preserve its primitive type.");
  if (frame.phase === "finalized") state.committed = value;
  return value;
}

export const priceSources = [
  "close",
  "open",
  "high",
  "low",
  "hl2",
  "hlc3",
  "ohlc4",
] as const;

export type PriceSource = (typeof priceSources)[number];

export function priceValue(candle: Candle, source: PriceSource): number {
  switch (source) {
    case "open":
      return candle.open;
    case "high":
      return candle.high;
    case "low":
      return candle.low;
    case "hl2":
      return (candle.high + candle.low) / 2;
    case "hlc3":
      return (candle.high + candle.low + candle.close) / 3;
    case "ohlc4":
      return (candle.open + candle.high + candle.low + candle.close) / 4;
    case "close":
      return candle.close;
  }
}

export function priceSeries(
  candles: readonly Candle[],
  source: PriceSource,
): number[] {
  return candles.map((candle) => priceValue(candle, source));
}

export function candlesWithPriceSource(
  candles: readonly Candle[],
  source: PriceSource,
): readonly Candle[] {
  if (source === "close") return candles;
  return candles.map((candle) => ({
    ...candle,
    close: priceValue(candle, source),
  }));
}
export function inputOptions<T extends string>(
  values: readonly T[],
): readonly { readonly value: T; readonly label: T }[] {
  return values.map((value) => ({ value, label: value }));
}
