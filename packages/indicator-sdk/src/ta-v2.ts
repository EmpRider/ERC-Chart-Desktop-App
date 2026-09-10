import type { Candle } from "@erc-chart/contracts";
import { withKernelCallsite } from "./authoring-context.js";
import { readCompilerCallsite } from "./internal/callsite.js";
import {
  atr as rawAtr,
  crossover as rawCrossover,
  crossunder as rawCrossunder,
  dmi as rawDmi,
  ema as rawEma,
  highest as rawHighest,
  lowest as rawLowest,
  movingAverage as rawMovingAverage,
  rsi as rawRsi,
  sma as rawSma,
  ta as rawTa,
  type DmiPoint,
  type DmiSeries,
  type MovingAverageType,
  type TechnicalAnalysisApi,
} from "./ta.js";

function withTaIdentity<T>(
  hiddenCallsite: unknown,
  callee: string,
  run: () => T,
): T {
  const callsite = readCompilerCallsite(hiddenCallsite, "ta", callee);
  return callsite === undefined ? run() : withKernelCallsite(callsite, run);
}

function sma(
  valueOrLength: number,
  period?: number,
  hiddenCallsite?: unknown,
): number {
  return withTaIdentity(hiddenCallsite, "ta.sma", () =>
    rawSma(valueOrLength, period),
  );
}

function ema(
  valueOrLength: number,
  period?: number,
  hiddenCallsite?: unknown,
): number {
  return withTaIdentity(hiddenCallsite, "ta.ema", () =>
    rawEma(valueOrLength, period),
  );
}

function movingAverage(
  values: readonly number[],
  type: MovingAverageType,
  period: number,
  hiddenCallsite?: unknown,
): number[];
function movingAverage(
  value: number,
  type: MovingAverageType,
  period: number,
  hiddenCallsite?: unknown,
): number;
function movingAverage(
  values: readonly number[] | number,
  type: MovingAverageType,
  period: number,
  hiddenCallsite?: unknown,
): number[] | number {
  return withTaIdentity(hiddenCallsite, "ta.movingAverage", () =>
    typeof values === "number"
      ? rawMovingAverage(values, type, period)
      : rawMovingAverage(values, type, period),
  );
}

function atr(
  period: number,
  reserved?: undefined,
  hiddenCallsite?: unknown,
): number;
function atr(
  candles: readonly Candle[],
  period: number,
  hiddenCallsite?: unknown,
): number[];
function atr(
  candlesOrPeriod: readonly Candle[] | number,
  period?: number,
  hiddenCallsite?: unknown,
): number[] | number {
  return withTaIdentity(hiddenCallsite, "ta.atr", () =>
    typeof candlesOrPeriod === "number"
      ? rawAtr(candlesOrPeriod)
      : rawAtr(candlesOrPeriod, period as number),
  );
}

function dmi(
  period: number,
  reserved?: undefined,
  hiddenCallsite?: unknown,
): DmiPoint;
function dmi(
  candles: readonly Candle[],
  period: number,
  hiddenCallsite?: unknown,
): DmiSeries;
function dmi(
  candlesOrPeriod: readonly Candle[] | number,
  period?: number,
  hiddenCallsite?: unknown,
): DmiSeries | DmiPoint {
  return withTaIdentity(hiddenCallsite, "ta.dmi", () =>
    typeof candlesOrPeriod === "number"
      ? rawDmi(candlesOrPeriod)
      : rawDmi(candlesOrPeriod, period as number),
  );
}

function rsi(
  valueOrLength: number,
  period?: number,
  hiddenCallsite?: unknown,
): number;
function rsi(
  values: readonly number[],
  period: number,
  hiddenCallsite?: unknown,
): number[];
function rsi(
  values: readonly number[] | number,
  period?: number,
  hiddenCallsite?: unknown,
): number[] | number {
  return withTaIdentity(hiddenCallsite, "ta.rsi", () =>
    typeof values === "number"
      ? rawRsi(values, period)
      : rawRsi(values, period as number),
  );
}

function highest(
  valueOrLength: number,
  period?: number,
  hiddenCallsite?: unknown,
): number;
function highest(
  values: readonly number[],
  period: number,
  hiddenCallsite?: unknown,
): number[];
function highest(
  values: readonly number[] | number,
  period?: number,
  hiddenCallsite?: unknown,
): number[] | number {
  return withTaIdentity(hiddenCallsite, "ta.highest", () =>
    typeof values === "number"
      ? rawHighest(values, period)
      : rawHighest(values, period as number),
  );
}

function lowest(
  valueOrLength: number,
  period?: number,
  hiddenCallsite?: unknown,
): number;
function lowest(
  values: readonly number[],
  period: number,
  hiddenCallsite?: unknown,
): number[];
function lowest(
  values: readonly number[] | number,
  period?: number,
  hiddenCallsite?: unknown,
): number[] | number {
  return withTaIdentity(hiddenCallsite, "ta.lowest", () =>
    typeof values === "number"
      ? rawLowest(values, period)
      : rawLowest(values, period as number),
  );
}

function crossover(
  left: number,
  right: number,
  hiddenCallsite?: unknown,
): boolean;
function crossover(
  left: readonly number[],
  right: readonly number[],
  hiddenCallsite?: unknown,
): boolean[];
function crossover(
  left: readonly number[] | number,
  right: readonly number[] | number,
  hiddenCallsite?: unknown,
): boolean[] | boolean {
  return withTaIdentity(hiddenCallsite, "ta.crossover", () => {
    if (typeof left === "number" && typeof right === "number")
      return rawCrossover(left, right);
    if (Array.isArray(left) && Array.isArray(right))
      return rawCrossover(left, right);
    throw new TypeError("TA crossover inputs must use the same value shape.");
  });
}

function crossunder(
  left: number,
  right: number,
  hiddenCallsite?: unknown,
): boolean;
function crossunder(
  left: readonly number[],
  right: readonly number[],
  hiddenCallsite?: unknown,
): boolean[];
function crossunder(
  left: readonly number[] | number,
  right: readonly number[] | number,
  hiddenCallsite?: unknown,
): boolean[] | boolean {
  return withTaIdentity(hiddenCallsite, "ta.crossunder", () => {
    if (typeof left === "number" && typeof right === "number")
      return rawCrossunder(left, right);
    if (Array.isArray(left) && Array.isArray(right))
      return rawCrossunder(left, right);
    throw new TypeError("TA crossunder inputs must use the same value shape.");
  });
}

export const ta: TechnicalAnalysisApi = Object.freeze({
  ...rawTa,
  sma,
  ema,
  movingAverage,
  atr,
  dmi,
  rsi,
  highest,
  lowest,
  crossover,
  crossunder,
});
