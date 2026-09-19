export * from "../../packages/indicator-sdk/dist/index.js";

import type {
  IndicatorOptions,
  SeriesNumber,
} from "../../packages/indicator-sdk/dist/index.js";

interface CompilerIndicatorBar {
  readonly open: SeriesNumber;
  readonly high: SeriesNumber;
  readonly low: SeriesNumber;
  readonly close: SeriesNumber;
  readonly volume: SeriesNumber;
  readonly hl2: SeriesNumber;
  readonly hlc3: SeriesNumber;
  readonly ohlc4: SeriesNumber;
  readonly index: number;
  readonly openTimeMs: number;
  readonly isConfirmed: boolean;
}

/** Compiler-only declaration for the hidden lowered runtime seam. */
export declare function defineIndicator(
  options: IndicatorOptions,
  calculate: (bar: CompilerIndicatorBar) => void,
): unknown;
