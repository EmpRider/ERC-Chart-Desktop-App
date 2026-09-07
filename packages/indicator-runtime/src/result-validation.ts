import type { IndicatorRuntimeSnapshot } from "@erc-chart/contracts";

export function assertDenseSnapshotTimeline(
  snapshot: IndicatorRuntimeSnapshot,
  expectedOpenTimes: readonly number[],
): void {
  if (snapshot.points.length !== expectedOpenTimes.length) {
    throw new Error(
      "Indicator plugin snapshot must contain one timestamp-aligned point per candle; warm-up values must be null.",
    );
  }
  for (let index = 0; index < expectedOpenTimes.length; index += 1) {
    if (snapshot.points[index]?.openTimeMs !== expectedOpenTimes[index]) {
      throw new Error(
        "Indicator plugin snapshot points must match the canonical candle timeline.",
      );
    }
  }
}
