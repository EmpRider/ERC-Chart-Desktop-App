let currentSnapshot = { points: [], overlays: [], signals: [] };

export default {
  definition: {
    id: "erc.indicator.oversized-output.main",
    name: "Oversized output fixture",
    placement: "overlay",
    inputs: [],
    outputs: [],
    plots: [],
    requiresLiveTicks: false,
  },
  createInstance() {
    return {
      onHistory(candles) {
        currentSnapshot = {
          points: candles.map((candle) => ({
            openTimeMs: candle.openTimeMs,
            values: {},
          })),
          overlays: Array.from({ length: 10_001 }, (_, index) => ({
            id: `segment-${index}`,
            kind: "line-segment",
            startTimeMs: 0,
            endTimeMs: 60_000,
            startValue: 1,
            endValue: 2,
            color: "#111111",
            width: 1,
            style: "solid",
          })),
          signals: [],
        };
      },
      onBuildingBar() {
        void 0;
      },
      onFinalizedBar() {
        void 0;
      },
      dispose() {
        void 0;
      },
      snapshot() {
        return currentSnapshot;
      },
    };
  },
};
