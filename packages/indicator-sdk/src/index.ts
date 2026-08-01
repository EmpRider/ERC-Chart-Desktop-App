import {
  indicatorContractVersion,
  type Candle,
  type CompatibilityRange,
  type ContractVersion,
  type InstrumentId,
  type Tick,
  type TimeframeId,
} from "@erc-chart/contracts";

export { indicatorContractVersion } from "@erc-chart/contracts";

export const indicatorSdkVersion: ContractVersion = indicatorContractVersion;

export type IndicatorInputValue = boolean | number | string;
export type IndicatorInputKind = "boolean" | "number" | "string";

export interface IndicatorInputDefinition {
  readonly key: string;
  readonly label: string;
  readonly type: IndicatorInputKind;
  readonly defaultValue: IndicatorInputValue;
}

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
}

export interface IndicatorDefinition {
  readonly id: string;
  readonly name: string;
  readonly indicatorContractVersion: ContractVersion;
  readonly hostCompatibility: CompatibilityRange;
  readonly inputs: readonly IndicatorInputDefinition[];
  readonly outputs: readonly IndicatorOutputDefinition[];
  readonly plots: readonly IndicatorPlotDefinition[];
  readonly requiresLiveTicks: boolean;
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
