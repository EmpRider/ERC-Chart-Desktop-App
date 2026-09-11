import type { Candle } from "@erc-chart/contracts";
import { authoringFrame, useKernel } from "./authoring-context.js";
import { readCompilerCallsite } from "./internal/callsite.js";
import { historyValue } from "./internal/series-history.js";

export const maxSeriesCollectionItems = 4_096;

/**
 * Compile-time authoring view for scalar market values.
 *
 * The runtime value stays a primitive number. The authoring transform lowers
 * bracket and `.at()` history access to `history()` before the code executes.
 */
export type SeriesNumber = number & {
  readonly [barsBack: number]: number;
  readonly at: (barsBack: number) => number;
};

/**
 * Read a prior value from the same scalar source.
 *
 * `barsBack = 0` returns the current value. Missing history returns NaN. The
 * authoring compiler lowers `close[n]` and `close.at(n)` to this operation.
 */
export function history(source: number | undefined, barsBack: number): number {
  return historyValue(source ?? Number.NaN, barsBack);
}

function cloneSeriesState<T>(value: T): T {
  const seen = new Map<object, unknown>();
  const clone = (current: unknown): unknown => {
    if (current === null || typeof current !== "object") return current;
    const existing = seen.get(current);
    if (existing !== undefined) return existing;
    if (Array.isArray(current)) {
      const result = new Array<unknown>(current.length);
      seen.set(current, result);
      for (let index = 0; index < current.length; index += 1)
        result[index] = clone(current[index]);
      return result;
    }
    if (current instanceof Date) {
      const result = new Date(current.getTime());
      seen.set(current, result);
      return result;
    }
    if (current instanceof RegExp) {
      const result = new RegExp(current.source, current.flags);
      seen.set(current, result);
      return result;
    }
    if (current instanceof Map) {
      const result = new Map<unknown, unknown>();
      seen.set(current, result);
      for (const [key, entry] of current) result.set(clone(key), clone(entry));
      return result;
    }
    if (current instanceof Set) {
      const result = new Set<unknown>();
      seen.set(current, result);
      for (const entry of current) result.add(clone(entry));
      return result;
    }
    if (current instanceof ArrayBuffer) {
      const result = current.slice(0);
      seen.set(current, result);
      return result;
    }
    if (ArrayBuffer.isView(current)) {
      const result = structuredClone(current);
      seen.set(current, result);
      return result;
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        "Series state does not support custom class instances.",
      );
    }
    const result = Object.create(prototype) as Record<string, unknown>;
    seen.set(current, result);
    for (const key of Object.keys(current))
      result[key] = clone((current as Record<string, unknown>)[key]);
    return result;
  };
  return clone(value) as T;
}

function assertBoundedSeriesCollections(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  const pending: object[] = [value];
  const visited = new Set<object>();
  let items = 0;
  const addItems = (count: number): void => {
    items += count;
    if (items > maxSeriesCollectionItems)
      throw new RangeError(
        `Series state collections may contain at most ${maxSeriesCollectionItems.toLocaleString("en-US")} items.`,
      );
  };
  const visit = (entry: unknown): void => {
    if (entry !== null && typeof entry === "object") pending.push(entry);
  };

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      addItems(current.length);
      for (const entry of current) visit(entry);
      continue;
    }
    if (current instanceof Map) {
      addItems(current.size);
      for (const [key, entry] of current) {
        visit(key);
        visit(entry);
      }
      continue;
    }
    if (current instanceof Set) {
      addItems(current.size);
      for (const entry of current) visit(entry);
      continue;
    }
    if (ArrayBuffer.isView(current)) {
      addItems(
        "length" in current
          ? Number((current as { readonly length: number }).length)
          : current.byteLength,
      );
      continue;
    }
    if (current instanceof ArrayBuffer) {
      addItems(current.byteLength);
      continue;
    }
    for (const key of Object.keys(current))
      visit((current as Record<string, unknown>)[key]);
  }
}

/** Recurrence: every building update starts from the previous committed bar. */
export function series<T>(
  initial: T,
  update: (previous: Readonly<T>) => T,
  hiddenCallsite?: unknown,
): T {
  const frame = authoringFrame();
  const callsite = readCompilerCallsite(hiddenCallsite, "state", "series");
  const kind = Array.isArray(initial) ? "array" : typeof initial;
  const structured = initial !== null && typeof initial === "object";
  const state = useKernel(
    `series-${kind}`,
    () => {
      assertBoundedSeriesCollections(initial);
      return {
        committed: structured ? cloneSeriesState(initial) : initial,
      };
    },
    callsite,
  );
  const value = update(cloneSeriesState(state.committed));
  const valueKind = Array.isArray(value) ? "array" : typeof value;
  if (valueKind !== kind)
    throw new TypeError("Series state must preserve its value kind.");
  assertBoundedSeriesCollections(value);
  if (frame.phase === "finalized") state.committed = cloneSeriesState(value);
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
