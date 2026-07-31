import type { InstrumentId, TimeframeId } from "./identifiers.js";

export interface Candle {
  readonly instrumentId: InstrumentId;
  readonly timeframeId: TimeframeId;
  readonly openTimeMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
}

export interface Tick {
  readonly instrumentId: InstrumentId;
  readonly timestampMs: number;
  readonly price: number;
  readonly volume?: number;
}
