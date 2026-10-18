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
    const dependencyByOpenTime = new Map(
      (context.dependencyInputs?.source?.points ?? []).map((point) => [
        point.openTimeMs,
        point.values[context.dependencyInputs.source.outputKey],
      ]),
    );
    const pointFor = (candle) => ({
      openTimeMs: candle.openTimeMs,
      values: {
        line:
          typeof dependencyByOpenTime.get(candle.openTimeMs) === "number"
            ? dependencyByOpenTime.get(candle.openTimeMs) + 1
            : null,
      },
    });
    currentSnapshot = { points: [], overlays: [], signals: [] };
    return {
      updateDependencyInputs(updates) {
        const dependency = updates.source;
        for (const point of dependency?.points ?? [])
          dependencyByOpenTime.set(
            point.openTimeMs,
            point.values[dependency.outputKey],
          );
      },
      onHistory(candles) {
        currentSnapshot = {
          points: candles.map(pointFor),
          overlays: [],
          signals: [],
        };
      },
      onBuildingBar(candle) {
        currentSnapshot = {
          ...currentSnapshot,
          points: [
            ...currentSnapshot.points.filter(
              (point) => point.openTimeMs !== candle.openTimeMs,
            ),
            pointFor(candle),
          ].sort((left, right) => left.openTimeMs - right.openTimeMs),
        };
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
