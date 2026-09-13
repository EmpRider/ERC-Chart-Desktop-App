export type {
  IndicatorInstance,
  IndicatorInstanceContext,
  IndicatorPluginModule,
  IndicatorSnapshot,
  RuntimeIndicatorInstance,
  SignalCandidate,
} from "./runtime-contracts.js";

export {
  normalizeIndicatorInputValue,
  normalizeIndicatorParameters,
} from "../input.js";
export type {
  IndicatorInputDefinition,
  IndicatorInputValue,
} from "../index.js";

export {
  appendSeries,
  candlesWithPriceSource,
  laggedValue,
  maxSeriesCollectionItems,
  priceSeries,
} from "../series.js";

export {
  atr,
  createAtrKernel,
  createCrossoverKernel,
  createCrossunderKernel,
  createDmiKernel,
  createHighestKernel,
  createLowestKernel,
  createMovingAverageKernel,
  createRsiKernel,
  crossover,
  crossunder,
  dmi,
  ema,
  highest,
  lowest,
  movingAverage,
  rsi,
  sma,
  trueRange,
} from "../ta.js";
export type {
  CandleTaKernel,
  CrossKernel,
  DmiSeries,
  NumericTaKernel,
  TaUpdatePhase,
} from "../ta.js";
