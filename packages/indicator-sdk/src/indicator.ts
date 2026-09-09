import {
  hostApiVersion,
  indicatorContractVersion,
  isInstalledIndicatorDefinition,
  isIndicatorRuntimeSnapshot,
  type Candle,
} from "@erc-chart/contracts";
import {
  newPoint,
  withAuthoringFrame,
  type AuthoringFrame,
  type KernelSlot,
} from "./authoring-context.js";
import type {
  IndicatorDefinition,
  IndicatorInputDefinition,
  IndicatorInputValue,
  IndicatorInstanceContext,
  IndicatorOverlay,
  IndicatorPlotDefinition,
  IndicatorPluginModule,
  IndicatorResultPoint,
  RuntimeIndicatorInstance,
  SignalCandidate,
} from "./index.js";

export interface IndicatorOptions {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly placement?: "overlay" | "pane";
}

export interface IndicatorBar extends Candle {
  readonly index: number;
  readonly isConfirmed: boolean;
  readonly isHistory: boolean;
  readonly isHistoryFinalizedTail: boolean;
  readonly hl2: number;
  readonly hlc3: number;
  readonly ohlc4: number;
}

export type IndicatorCalculation = (bar: IndicatorBar) => void;

function overlaysEqual(
  left: readonly IndicatorOverlay[],
  right: readonly IndicatorOverlay[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a === undefined ||
      b === undefined ||
      a.kind !== b.kind ||
      a.id !== b.id
    )
      return false;
    if (a.kind === "box" && b.kind === "box") {
      if (
        a.startTimeMs !== b.startTimeMs ||
        a.endTimeMs !== b.endTimeMs ||
        a.top !== b.top ||
        a.bottom !== b.bottom ||
        a.color !== b.color ||
        a.borderColor !== b.borderColor
      )
        return false;
      continue;
    }
    if (a.kind === "line-segment" && b.kind === "line-segment") {
      if (
        a.startTimeMs !== b.startTimeMs ||
        a.endTimeMs !== b.endTimeMs ||
        a.startValue !== b.startValue ||
        a.endValue !== b.endValue ||
        a.color !== b.color ||
        a.width !== b.width ||
        a.style !== b.style
      )
        return false;
      continue;
    }
    return false;
  }
  return true;
}

function barContext(
  candle: Candle,
  index: number,
  confirmed: boolean,
  historyReplay: boolean,
  historyFinalizedTail: boolean,
): IndicatorBar {
  return Object.freeze({
    ...candle,
    index,
    isConfirmed: confirmed,
    isHistory: historyReplay,
    isHistoryFinalizedTail: historyFinalizedTail,
    hl2: (candle.high + candle.low) / 2,
    hlc3: (candle.high + candle.low + candle.close) / 3,
    ohlc4: (candle.open + candle.high + candle.low + candle.close) / 4,
  });
}

/** Declares metadata once; executes one scalar calculation per building/finalized bar. */
export function defineIndicator(
  options: IndicatorOptions,
  calculate: IndicatorCalculation,
): IndicatorPluginModule {
  const inputs: IndicatorInputDefinition[] = [];
  const plots: IndicatorPlotDefinition[] = [];
  const sample: Candle = {
    instrumentId: "metadata" as Candle["instrumentId"],
    timeframeId: "1m" as Candle["timeframeId"],
    openTimeMs: 0,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 0,
  };
  const discovery: AuthoringFrame = {
    candle: sample,
    phase: "building",
    historyReplay: false,
    historyFinalizedTail: false,
    discovery: true,
    kernels: [],
    kernelIndex: 0,
    inputs,
    inputIndex: 0,
    parameters: {},
    plots,
    plotIndex: 0,
    point: newPoint(0),
    overlayUpdates: new Map(),
    signals: [],
    signalIndex: 0,
  };
  const run = (frame: AuthoringFrame, index: number): void => {
    const result: unknown = withAuthoringFrame(frame, () =>
      calculate(
        barContext(
          frame.candle,
          index,
          frame.phase === "finalized",
          frame.historyReplay,
          frame.historyFinalizedTail,
        ),
      ),
    );
    if (result !== undefined) {
      // Surface the contract error synchronously and consume a rejected async callback result.
      if (result instanceof Promise) void result.catch(() => undefined);
      throw new TypeError(
        "Indicator calculations must be synchronous and return no value.",
      );
    }
  };
  run(discovery, 0);
  const definition: IndicatorDefinition = Object.freeze({
    ...options,
    indicatorContractVersion,
    hostCompatibility: {
      minimumHostApiVersion: hostApiVersion,
      maximumHostApiVersion: hostApiVersion,
    },
    placement: options.placement ?? "overlay",
    requiresLiveTicks: false,
    inputs: Object.freeze(inputs.map((value) => Object.freeze(value))),
    outputs: Object.freeze(
      plots.map((value) =>
        Object.freeze({
          key: value.outputKey ?? value.key,
          label: value.label ?? value.key,
        }),
      ),
    ),
    plots: Object.freeze(plots.map((value) => Object.freeze(value))),
  });
  if (!isInstalledIndicatorDefinition(definition))
    throw new TypeError(
      "Generated indicator metadata is invalid; check names, inputs and plot options.",
    );

  return Object.freeze({
    definition,
    createInstance(
      parameters: Readonly<Record<string, IndicatorInputValue>>,
      context: IndicatorInstanceContext,
    ): RuntimeIndicatorInstance {
      let kernels: KernelSlot[] = [];
      let points: IndicatorResultPoint[] = [];
      let committedDrawings = new Map<string, IndicatorOverlay>();
      let committedOverlays: readonly IndicatorOverlay[] = [];
      let overlays: readonly IndicatorOverlay[] = [];
      let signals: SignalCandidate[] = [];
      let visualRevision = 0;
      let finalizedCount = 0;
      let lastFinalized: Candle | undefined;
      let building: Candle | undefined;
      let disposed = false;
      let failed = false;
      const validate = (candle: Candle): void => {
        if (disposed) throw new Error("Indicator instance was disposed.");
        if (failed)
          throw new Error(
            "Indicator calculation failed; reload history before continuing.",
          );
        if (
          candle.instrumentId !== context.instrumentId ||
          candle.timeframeId !== context.timeframeId ||
          !Number.isSafeInteger(candle.openTimeMs) ||
          candle.openTimeMs < 0 ||
          ![candle.open, candle.high, candle.low, candle.close].every(
            Number.isFinite,
          )
        )
          throw new TypeError("Candle does not match the indicator instance.");
      };
      const evaluate = (
        candle: Candle,
        phase: "building" | "finalized",
        historyReplay = false,
        historyFinalizedTail = false,
      ): void => {
        validate(candle);
        const previousOverlays = overlays;
        const frame: AuthoringFrame = {
          candle,
          phase,
          historyReplay,
          historyFinalizedTail,
          discovery: false,
          kernels,
          kernelIndex: 0,
          inputs,
          inputIndex: 0,
          parameters,
          plots,
          plotIndex: 0,
          point: newPoint(candle.openTimeMs),
          overlayUpdates: new Map(),
          signals: [],
          signalIndex: 0,
        };
        try {
          run(frame, finalizedCount);
          if (
            frame.kernelIndex !== discovery.kernelIndex ||
            frame.inputIndex !== inputs.length ||
            frame.plotIndex !== plots.length ||
            kernels.some(
              (slot, index) =>
                slot.signature.split(":")[0] !==
                discovery.kernels[index]?.signature.split(":")[0],
            )
          )
            throw new Error(
              "Input, TA and plot calls must run in the same order on every bar. Use null to hide plots.",
            );
          let nextDrawings = committedDrawings;
          if (frame.overlayUpdates.size > 0) {
            nextDrawings = new Map(committedDrawings);
            for (const [id, value] of frame.overlayUpdates) {
              if (value === null) nextDrawings.delete(id);
              else nextDrawings.set(id, value);
            }
            while (nextDrawings.size > 2_000) {
              const oldest = nextDrawings.keys().next().value;
              if (oldest !== undefined) nextDrawings.delete(oldest);
            }
            const candidateOverlays = [...nextDrawings.values()];
            overlays = overlaysEqual(candidateOverlays, previousOverlays)
              ? previousOverlays
              : candidateOverlays;
          } else overlays = committedOverlays;
          // Validate only this point and changed bounded geometry, never the historical point array.
          const emitted: SignalCandidate[] = frame.signals.map((value) => ({
            signalContractVersion: indicatorContractVersion,
            id: `${value.key}:${candle.openTimeMs}`,
            indicatorId: definition.id,
            instrumentId: context.instrumentId,
            timeframeId: context.timeframeId,
            occurredAtMs: candle.openTimeMs,
            direction: value.direction,
            finalized: true,
            ...(value.confidence === undefined
              ? {}
              : { confidence: value.confidence }),
          }));
          if (
            !isIndicatorRuntimeSnapshot({
              points: [frame.point],
              overlays: frame.overlayUpdates.size > 0 ? overlays : [],
              signals: emitted,
            })
          )
            throw new TypeError(
              "Indicator produced an invalid plot or drawing.",
            );
          if (finalizedCount >= 100_000)
            throw new RangeError(
              "Reload retained history at the 100,000-candle limit.",
            );
          points[finalizedCount] = frame.point;
          if (overlays !== previousOverlays || emitted.length > 0)
            visualRevision += 1;
          if (phase === "finalized") {
            signals.push(...emitted);
            if (signals.length > 10_000)
              signals.splice(0, signals.length - 10_000);
            committedDrawings = nextDrawings;
            committedOverlays = overlays;
            lastFinalized = { ...candle };
            finalizedCount += 1;
            building = undefined;
          } else building = { ...candle };
        } catch (error) {
          failed = true;
          throw error;
        }
      };
      return {
        onHistory(history) {
          if (disposed) throw new Error("Indicator instance was disposed.");
          if (history.length > 100_000)
            throw new RangeError("Indicator history exceeds 100,000 candles.");
          kernels = [];
          points = [];
          signals = [];
          committedDrawings = new Map();
          committedOverlays = [];
          overlays = [];
          finalizedCount = 0;
          lastFinalized = undefined;
          building = undefined;
          failed = false;
          visualRevision = 0;
          let previous = -1;
          const lastFinalizedIndex = history.length - 2;
          for (let index = 0; index < history.length; index += 1) {
            const candle = history[index];
            if (candle === undefined || candle.openTimeMs <= previous) {
              failed = true;
              throw new RangeError(
                "History must be strictly ordered and unique.",
              );
            }
            evaluate(
              candle,
              index === history.length - 1 ? "building" : "finalized",
              true,
              index === lastFinalizedIndex,
            );
            previous = candle.openTimeMs;
          }
        },
        onBuildingBar(candle) {
          validate(candle);
          if (
            (lastFinalized !== undefined &&
              candle.openTimeMs <= lastFinalized.openTimeMs) ||
            (building !== undefined && candle.openTimeMs < building.openTimeMs)
          )
            throw new Error(
              "Building update is older than the current indicator state; reload corrected history.",
            );
          if (building !== undefined && candle.openTimeMs > building.openTimeMs)
            evaluate(building, "finalized");
          evaluate(candle, "building");
        },
        onFinalizedBar(candle) {
          validate(candle);
          if (lastFinalized?.openTimeMs === candle.openTimeMs) {
            if (
              ["open", "high", "low", "close", "volume"].every(
                (key) =>
                  candle[key as keyof Candle] ===
                  lastFinalized?.[key as keyof Candle],
              )
            )
              return;
            throw new Error(
              "A finalized-bar correction requires a history rebuild.",
            );
          }
          if (
            (lastFinalized !== undefined &&
              candle.openTimeMs < lastFinalized.openTimeMs) ||
            (building !== undefined &&
              candle.openTimeMs !== building.openTimeMs)
          )
            throw new Error("Finalized update does not match the current bar.");
          evaluate(candle, "finalized");
        },
        snapshot: () => ({ points, overlays, signals, visualRevision }),
        dispose() {
          disposed = true;
          kernels = [];
          points = [];
          signals = [];
          committedDrawings.clear();
          overlays = [];
          committedOverlays = [];
        },
      };
    },
  });
}
