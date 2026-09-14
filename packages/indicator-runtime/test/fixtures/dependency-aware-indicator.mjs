let currentSnapshot = { points: [], overlays: [], signals: [] };

export default {
  definition: {
    id: "erc.indicator.worker-dependency.main",
    name: "Worker dependency fixture",
    placement: "overlay",
    inputs: [],
    outputs: [{ key: "line", label: "Line" }],
    plots: [{ key: "line", kind: "line", outputKey: "line" }],
    requiresLiveTicks: false,
  },
  createInstance(_parameters, context) {
    currentSnapshot = { points: [], overlays: [], signals: [] };
    return {
      onHistory(candles) {
        const bound = context.dependencyInputs?.source ?? [];
        const byOpenTime = new Map(
          bound.map((point) => [point.openTimeMs, point.values.line]),
        );
        currentSnapshot = {
          points: candles.map((candle) => ({
            openTimeMs: candle.openTimeMs,
            values: {
              line:
                typeof byOpenTime.get(candle.openTimeMs) === "number"
                  ? byOpenTime.get(candle.openTimeMs) + 1
                  : null,
            },
          })),
          overlays: [],
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
