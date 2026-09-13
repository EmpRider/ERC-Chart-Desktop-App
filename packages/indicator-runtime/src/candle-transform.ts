import type { Candle } from "@erc-chart/contracts";
import { toHeikinAshiCandles } from "./heikin-ashi.js";

export type IndicatorCandleType = "standard" | "heikin-ashi";

export type IndicatorSourceProvenance =
  | Readonly<{ kind: "market"; candleType: "standard" }>
  | Readonly<{ kind: "synthetic"; candleType: "heikin-ashi" }>;

type CandleTransform = (candles: readonly Candle[]) => readonly Candle[];

const transforms: Readonly<Record<IndicatorCandleType, CandleTransform>> =
  Object.freeze({
    standard: (candles) => candles,
    "heikin-ashi": toHeikinAshiCandles,
  });

const provenanceByType: Readonly<
  Record<IndicatorCandleType, IndicatorSourceProvenance>
> = Object.freeze({
  standard: Object.freeze({ kind: "market", candleType: "standard" }),
  "heikin-ashi": Object.freeze({
    kind: "synthetic",
    candleType: "heikin-ashi",
  }),
});

export function sourceProvenanceForCandleType(
  candleType: IndicatorCandleType,
): IndicatorSourceProvenance {
  return provenanceByType[candleType];
}

export function transformIndicatorCandles(
  candleType: IndicatorCandleType,
  candles: readonly Candle[],
): readonly Candle[] {
  return transforms[candleType](candles);
}
