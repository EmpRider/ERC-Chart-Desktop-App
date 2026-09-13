let currentSnapshot = { points: [], overlays: [], signals: [] };

export default {
  definition: {
    id: "erc.indicator.worker-source.main",
    name: "Worker source fixture",
    placement: "overlay",
    inputs: [],
    outputs: [],
    plots: [],
    requiresLiveTicks: false,
  },
  createInstance(_parameters, context) {
    currentSnapshot = { points: [], overlays: [], signals: [] };
    return {
      onHistory(candles) {
        const sourceMetadata = context.sourceMetadata?.["1h"];
        const sourceCandle = context.sourceCandles?.["1h"]?.[0];
        currentSnapshot = {
          points: candles.map((candle) => ({
            openTimeMs: candle.openTimeMs,
            values: {},
          })),
          overlays: [],
          signals:
            sourceMetadata === undefined || sourceCandle === undefined
              ? []
              : [
                  {
                    id: "source-aware",
                    occurredAtMs: sourceCandle.openTimeMs,
                    direction: "long",
                    finalized: true,
                    sources: [
                      {
                        timeframeId: "1h",
                        activeTimeframeId: sourceMetadata.activeTimeframeId,
                        openTimeMs: sourceCandle.openTimeMs,
                        generation: sourceMetadata.generation,
                        revision: sourceMetadata.revision,
                        provenance: sourceMetadata.provenance,
                      },
                    ],
                  },
                ],
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
