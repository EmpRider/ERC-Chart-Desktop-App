import {
  hostApiVersion,
  indicatorContractVersion,
  type Candle,
  type CompatibilityRange,
  type ContractVersion,
  type InstrumentId,
  type Tick,
  type TimeframeId,
} from "@erc-chart/contracts";

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
export type IndicatorInputKind = "boolean" | "number" | "string";
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
        readonly editor?: "text" | "color" | "timeframe";
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

export interface IndicatorSnapshot {
  readonly points: readonly IndicatorResultPoint[];
  readonly overlays: readonly IndicatorOverlay[];
  readonly signals?: readonly SignalCandidate[];
}

export interface IndicatorInstanceContext {
  readonly instrumentId: InstrumentId;
  readonly timeframeId: TimeframeId;
}

export interface RuntimeIndicatorInstance extends IndicatorInstance {
  readonly snapshot: () => IndicatorSnapshot;
}

export interface IndicatorPluginModule {
  readonly definition: IndicatorDefinition;
  readonly createInstance: (
    parameters: Readonly<Record<string, IndicatorInputValue>>,
    context: IndicatorInstanceContext,
  ) => RuntimeIndicatorInstance;
}

export interface IndicatorInstance {
  readonly onHistory: (candles: readonly Candle[]) => void;
  readonly onBuildingBar: (candle: Candle) => void;
  readonly onFinalizedBar: (candle: Candle) => void;
  readonly onTick?: (tick: Tick) => void;
  readonly dispose: () => void;
}

export interface SignalCandidate {
  readonly signalContractVersion: ContractVersion;
  readonly id: string;
  readonly indicatorId: string;
  readonly instrumentId: InstrumentId;
  readonly timeframeId: TimeframeId;
  readonly occurredAtMs: number;
  readonly direction: "long" | "neutral" | "short";
  readonly confidence?: number;
  readonly finalized: boolean;
}
export {
  candlesWithPriceSource,
  inputOptions,
  priceSeries,
  priceSources,
  priceValue,
  type PriceSource,
} from "./series.js";
export {
  atr,
  createAtrKernel,
  createDmiKernel,
  createRsiKernel,
  createHighestKernel,
  createLowestKernel,
  createCrossoverKernel,
  createCrossunderKernel,
  crossover,
  crossunder,
  createMovingAverageKernel,
  dmi,
  highest,
  lowest,
  movingAverage,
  movingAverageTypes,
  rsi,
  ta,
  trueRange,
  type CandleTaKernel,
  type CrossKernel,
  type DmiPoint,
  type DmiSeries,
  type MovingAverageType,
  type NumericTaKernel,
  type TaUpdatePhase,
  type TechnicalAnalysisApi,
} from "./ta.js";
