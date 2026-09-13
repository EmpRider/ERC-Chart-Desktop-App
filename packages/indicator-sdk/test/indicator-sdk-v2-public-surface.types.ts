import {
  defineIndicator,
  history,
  input,
  location,
  movingAverageTypes,
  plot,
  priceSources,
  priceValue,
  series,
  shape,
  signal,
  ta,
  textSize,
  type DmiPoint,
  type IndicatorBar,
  type InputOptions,
  type MovingAverageType,
  type PlotOptions,
  type PriceSource,
  type SeriesNumber,
  type SignalOptions,
} from "../src/index.js";

void defineIndicator;
void history;
void input;
void location;
void movingAverageTypes;
void plot;
void priceSources;
void priceValue;
void series;
void shape;
void signal;
void ta;
void textSize;

declare const dmiPoint: DmiPoint;
declare const indicatorBar: IndicatorBar;
declare const movingAverageType: MovingAverageType;
declare const priceSource: PriceSource;
declare const seriesNumber: SeriesNumber;
declare const signalOptions: SignalOptions;
void dmiPoint;
void indicatorBar;
void movingAverageType;
void priceSource;
void seriesNumber;
void signalOptions;

const inputOptions: InputOptions = { title: "Length" };
const plotOptions: PlotOptions = { title: "Average" };
void inputOptions;
void plotOptions;

// Persistence identity belongs to the compiler/SDK in v2.
// @ts-expect-error input persistence keys are not part of the public v2 API
const keyedInput: InputOptions = { key: "legacy-input", title: "Legacy" };
// @ts-expect-error plot persistence keys are not part of the public v2 API
const keyedPlot: PlotOptions = { key: "legacy-plot", title: "Legacy" };
void keyedInput;
void keyedPlot;

// Array-oriented v1 helpers are not exported from the public v2 root.
// @ts-expect-error v1 retained-array helper is not public
import { appendSeries } from "../src/index.js";
// @ts-expect-error v1 retained-array helper is not public
import { laggedValue } from "../src/index.js";
// @ts-expect-error v1 batch price-series helper is not public
import { priceSeries } from "../src/index.js";
// @ts-expect-error v1 batch candle adapter is not public
import { candlesWithPriceSource } from "../src/index.js";
void appendSeries;
void laggedValue;
void priceSeries;
void candlesWithPriceSource;

// Flat TA compatibility aliases and low-level kernels are internal in v2.
// @ts-expect-error authors use ta.ema(), not a root-level compatibility alias
import { ema } from "../src/index.js";
// @ts-expect-error kernel constructors are runtime implementation details
import { createAtrKernel } from "../src/index.js";
// @ts-expect-error kernel interfaces are runtime implementation details
import type { NumericTaKernel } from "../src/index.js";
void ema;
void createAtrKernel;
declare const numericKernel: NumericTaKernel;
void numericKernel;

// Host/runtime contracts and normalization are not authoring-root exports.
// @ts-expect-error host normalization is not public authoring API
import { normalizeIndicatorParameters } from "../src/index.js";
// @ts-expect-error runtime plugin contract is not public authoring API
import type { IndicatorPluginModule } from "../src/index.js";
// @ts-expect-error runtime snapshot contract is not public authoring API
import type { IndicatorSnapshot } from "../src/index.js";
void normalizeIndicatorParameters;
declare const pluginModule: IndicatorPluginModule;
declare const snapshot: IndicatorSnapshot;
void pluginModule;
void snapshot;

// The v2 ta namespace is scalar authoring API only.
// @ts-expect-error historical arrays are not accepted by the public v2 TA facade
ta.ema([1, 2, 3], 2);
// @ts-expect-error kernel constructors are not exposed through the public v2 TA facade
ta.createAtrKernel(14);
