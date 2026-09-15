import {
  hostApiVersion,
  indicatorContractVersion,
  type CompatibilityRange,
  type ContractVersion,
} from "@erc-chart/contracts";
import {
  defineIndicator as runtimeDefineIndicator,
  type IndicatorBar as RuntimeIndicatorBar,
  type IndicatorOptions,
} from "./indicator.js";
import { input as runtimeInput } from "./input.js";
import {
  plot as runtimePlot,
  type BoxDrawing,
  type BoxHandle,
  type SegmentDrawing,
  type SegmentHandle,
} from "./plot.js";
import { ta as runtimeTa } from "./ta.js";
import type { DmiPoint, MovingAverageType } from "./ta.js";
import type { ShapeKind, ShapeLocation, TextSize } from "./constants.js";

export {
  hostApiVersion as indicatorHostApiVersion,
  indicatorContractVersion,
} from "@erc-chart/contracts";
export type {
  Candle,
  InstrumentId,
  Tick,
  TimeframeId,
} from "@erc-chart/contracts";

export const indicatorSdkVersion: ContractVersion = indicatorContractVersion;
export const indicatorHostVersion: ContractVersion = hostApiVersion;

export type IndicatorInputValue = boolean | number | string;
export type IndicatorInputKind = "boolean" | "number" | "source" | "string";
export type IndicatorInputEffect = "calculation" | "presentation";

export interface IndicatorInputOption {
  readonly value: string;
  readonly label: string;
}

interface IndicatorInputMetadata {
  readonly key: string;
  readonly label: string;
  readonly group?: string;
  readonly description?: string;
  readonly effect?: IndicatorInputEffect;
}

export type IndicatorInputDefinition = IndicatorInputMetadata &
  (
    | { readonly type: "boolean"; readonly defaultValue: boolean }
    | {
        readonly type: "number";
        readonly defaultValue: number;
        readonly min?: number;
        readonly max?: number;
        readonly step?: number;
      }
    | {
        readonly type: "string";
        readonly defaultValue: string;
        readonly options?: readonly IndicatorInputOption[];
        readonly editor?: "text" | "color" | "timeframe" | "candle-type";
      }
    | {
        readonly type: "source";
        readonly defaultValue: import("./series.js").PriceSource;
      }
  );

export interface IndicatorOutputDefinition {
  readonly key: string;
  readonly label: string;
}

export type IndicatorPlotKind =
  | "line"
  | "hline"
  | "histogram"
  | "band"
  | "fill"
  | "shape"
  | "line-segment"
  | "box"
  | "text";

export interface IndicatorPlotDefinition {
  readonly key: string;
  readonly kind: IndicatorPlotKind;
  readonly outputKey?: string;
  readonly label?: string;
  readonly color?: string;
  readonly width?: number;
  readonly style?: "solid" | "dashed" | "dotted";
  readonly direction?: "up" | "down";
  readonly shape?: ShapeKind;
  readonly location?: ShapeLocation;
  readonly text?: string;
  readonly textColor?: string;
  readonly textSize?: TextSize;
}

export type IndicatorPlacement = "overlay" | "pane";

export interface IndicatorDefinition {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly indicatorContractVersion: ContractVersion;
  readonly hostCompatibility: CompatibilityRange;
  readonly placement?: IndicatorPlacement;
  readonly inputs: readonly IndicatorInputDefinition[];
  readonly outputs: readonly IndicatorOutputDefinition[];
  readonly plots: readonly IndicatorPlotDefinition[];
  readonly requiresLiveTicks: boolean;
  readonly source?: IndicatorSourceDefinition;
}

export interface IndicatorSourceDefinition {
  readonly timeframe?: {
    readonly requestedTimeframeId: string;
    readonly inputKey?: string;
  };
  readonly candleType?: {
    readonly requestedCandleType: "standard" | "heikin-ashi";
    readonly inputKey?: string;
  };
  readonly taTimeframeIds: readonly string[];
}

/** Author-facing result of defineIndicator(). Runtime lifecycle ports remain host-private. */
export interface IndicatorModule {
  readonly definition: IndicatorDefinition;
}

export interface IndicatorResultPoint {
  readonly openTimeMs: number;
  readonly values: Readonly<Record<string, number | null>>;
  readonly colors?: Readonly<Record<string, string>>;
  readonly sizes?: Readonly<Record<string, number>>;
}

export interface IndicatorLineSegment {
  readonly id: string;
  readonly kind: "line-segment";
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly startValue: number;
  readonly endValue: number;
  readonly color: string;
  readonly width: number;
  readonly style: "solid" | "dashed" | "dotted";
}

export interface IndicatorBox {
  readonly id: string;
  readonly kind: "box";
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly top: number;
  readonly bottom: number;
  readonly color: string;
  readonly borderColor?: string;
}

export type IndicatorOverlay = IndicatorLineSegment | IndicatorBox;

export {
  history,
  inputOptions,
  priceSources,
  priceValue,
  series,
  type PriceSource,
  type SeriesNumber,
} from "./series.js";

export { movingAverageTypes } from "./ta.js";
export type { DmiPoint, MovingAverageType } from "./ta.js";

export interface TechnicalAnalysisApi {
  readonly sma: (
    valueOrLength: number,
    periodOrTimeframe?: number | string,
    timeframeId?: string,
  ) => number;
  readonly ema: (
    valueOrLength: number,
    periodOrTimeframe?: number | string,
    timeframeId?: string,
  ) => number;
  readonly movingAverage: (
    value: number,
    type: MovingAverageType,
    period: number,
  ) => number;
  readonly atr: (period: number) => number;
  readonly dmi: (period: number) => DmiPoint;
  readonly rsi: (valueOrLength: number, period?: number) => number;
  readonly highest: (valueOrLength: number, period?: number) => number;
  readonly lowest: (valueOrLength: number, period?: number) => number;
  readonly crossover: (left: number, right: number) => boolean;
  readonly crossunder: (left: number, right: number) => boolean;
}

export const ta: TechnicalAnalysisApi = runtimeTa as TechnicalAnalysisApi;

export type IndicatorBar = Omit<
  RuntimeIndicatorBar,
  "isHistory" | "isHistoryFinalizedTail"
>;
export type IndicatorCalculation = (bar: IndicatorBar) => void;
export type { IndicatorOptions } from "./indicator.js";
export type DefineIndicator = (
  options: IndicatorOptions,
  calculate?: IndicatorCalculation,
) => IndicatorModule;
export const defineIndicator: DefineIndicator =
  runtimeDefineIndicator as unknown as DefineIndicator;

export interface InputOptions {
  readonly title?: string;
  readonly group?: string;
  readonly description?: string;
  readonly effect?: "calculation" | "presentation";
}
export interface NumberInputOptions extends InputOptions {
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}
export interface StringInputOptions extends InputOptions {
  readonly options?: readonly (string | IndicatorInputOption)[];
}
type StringOptionValue<T> = T extends string
  ? T
  : T extends IndicatorInputOption
    ? T["value"]
    : never;
export interface InputApi {
  readonly float: (
    defaultValue: number,
    options?: string | NumberInputOptions,
  ) => number;
  readonly int: (
    defaultValue: number,
    options?: string | NumberInputOptions,
  ) => number;
  readonly bool: (
    defaultValue: boolean,
    options?: string | InputOptions,
  ) => boolean;
  readonly string: {
    <const O extends readonly (string | IndicatorInputOption)[]>(
      defaultValue: StringOptionValue<O[number]>,
      options: StringInputOptions & { readonly options: O },
    ): StringOptionValue<O[number]>;
    (defaultValue: string, options?: string | StringInputOptions): string;
  };
  readonly color: (
    defaultValue: string,
    options?: string | InputOptions,
  ) => string;
  readonly source: (
    defaultValue: import("./series.js").PriceSource | number,
    titleOrOptions?: string | InputOptions,
  ) => number;
  readonly timeframe: (
    defaultValue: string,
    titleOrOptions?: string | InputOptions,
  ) => string;
  readonly candleType: (
    defaultValue: import("./constants.js").CandleTypeSelection,
    titleOrOptions?: string | InputOptions,
  ) => import("./constants.js").CandleTypeSelection;
}
export const input: InputApi = runtimeInput as InputApi;

export interface PlotOptions {
  readonly title?: string;
  readonly color?: string;
  readonly width?: number;
  readonly style?: "solid" | "dashed" | "dotted";
}
export interface ShapeOptions extends PlotOptions {
  readonly direction?: "up" | "down";
  readonly shape?: ShapeKind;
  readonly location?: ShapeLocation;
  readonly text?: string;
  readonly textColor?: string;
  readonly textSize?: TextSize;
}
export interface ShapePlot {
  (value: boolean | number | null, options?: ShapeOptions): void;
  (value: boolean | number | null, text: string): void;
  (value: boolean | number | null, shape: ShapeKind, text: string): void;
}
export interface PlotApi {
  readonly line: (value: number | null, options?: PlotOptions) => void;
  readonly hline: (value: number | null, options?: PlotOptions) => void;
  readonly histogram: (value: number | null, options?: PlotOptions) => void;
  readonly shape: ShapePlot;
  readonly box: (value: BoxDrawing) => BoxHandle;
  readonly segment: (value: SegmentDrawing) => SegmentHandle;
}
export type {
  BoxDrawing,
  BoxHandle,
  SegmentDrawing,
  SegmentHandle,
} from "./plot.js";
export const plot: PlotApi = runtimePlot as PlotApi;

export {
  candle,
  location,
  shape,
  textSize,
  timeframe,
  type ShapeKind,
  type CandleTypeSelection,
  type ShapeLocation,
  type TextSize,
  type TimeframeSelection,
} from "./constants.js";

export { indicator, type IndicatorApi } from "./indicator-controls.js";

export { signal, type SignalOptions } from "./signal.js";
