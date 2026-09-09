import type { Candle } from "@erc-chart/contracts";
import { authoringFrame, useKernel } from "./authoring-context.js";

/** Recurrence: every building update starts from the previous committed bar. */
export function series<T>(initial: T, update: (previous: Readonly<T>) => T): T {
  const frame = authoringFrame();
  const kind = Array.isArray(initial) ? "array" : typeof initial;
  const state = useKernel(`series-${kind}`, () => ({
    committed: initial,
  }));
  const value = update(structuredClone(state.committed));
  const valueKind = Array.isArray(value) ? "array" : typeof value;
  if (valueKind !== kind)
    throw new TypeError("Series state must preserve its value kind.");
  if (frame.phase === "finalized") state.committed = structuredClone(value);
  return value;
}

/** Append one value while retaining only the newest bounded history. */
export function appendSeries<T>(
  history: readonly T[],
  value: T,
  keep: number,
): readonly T[] {
  const limit = Math.max(1, Math.floor(keep));
  if (limit === 1) return [value];
  if (history.length < limit) return [...history, value];
  return [...history.slice(history.length - limit + 1), value];
}

/** Read a prior retained value, falling back to the current value when unavailable. */
export function laggedValue<T>(
  history: readonly T[],
  current: T,
  lag: number,
): T {
  const offset = Math.floor(lag);
  if (offset <= 0) return current;
  return history.at(-offset) ?? current;
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
