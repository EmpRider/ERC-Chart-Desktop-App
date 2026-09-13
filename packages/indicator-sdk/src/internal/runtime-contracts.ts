import type {
  Candle,
  ContractVersion,
  IndicatorRuntimeSignalSource,
  IndicatorRuntimeSignalSourceProvenance,
  InstrumentId,
  Tick,
  TimeframeId,
} from "@erc-chart/contracts";
import type {
  IndicatorDefinition,
  IndicatorInputValue,
  IndicatorOverlay,
  IndicatorResultPoint,
} from "../index.js";

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
  readonly sources?: readonly IndicatorRuntimeSignalSource[];
}

export interface IndicatorSnapshot {
  readonly points: readonly IndicatorResultPoint[];
  readonly overlays: readonly IndicatorOverlay[];
  readonly signals?: readonly SignalCandidate[];
  /** Optional opt-in: increment whenever overlays or signals change, including provisional rollback. */
  readonly visualRevision?: number;
}

export interface IndicatorSourceMetadata {
  readonly activeTimeframeId: string;
  readonly generation: number;
  readonly revision: number;
  readonly finalizedCount: number;
  readonly provenance: IndicatorRuntimeSignalSourceProvenance;
}

export interface IndicatorInstanceContext {
  readonly instrumentId: InstrumentId;
  readonly timeframeId: TimeframeId;
  readonly sourceCandles?: Readonly<Record<string, readonly Candle[]>>;
  readonly sourceMetadata?: Readonly<Record<string, IndicatorSourceMetadata>>;
}

export interface IndicatorInstance {
  readonly onHistory: (candles: readonly Candle[]) => void;
  readonly onBuildingBar: (candle: Candle) => void;
  readonly onFinalizedBar: (candle: Candle) => void;
  readonly onTick?: (tick: Tick) => void;
  readonly dispose: () => void;
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
