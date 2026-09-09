import type { Candle } from "@erc-chart/contracts";
import type {
  IndicatorInputDefinition,
  IndicatorInputValue,
  IndicatorOverlay,
  IndicatorPlotDefinition,
  IndicatorResultPoint,
} from "./index.js";

export interface KernelSlot {
  readonly signature: string;
  readonly value: unknown;
}
export interface AuthoringFrame {
  readonly candle: Candle;
  readonly phase: "building" | "finalized";
  readonly historyReplay: boolean;
  readonly historyFinalizedTail: boolean;
  readonly discovery: boolean;
  readonly kernels: KernelSlot[];
  kernelIndex: number;
  readonly inputs: IndicatorInputDefinition[];
  inputIndex: number;
  readonly parameters: Readonly<Record<string, IndicatorInputValue>>;
  readonly plots: IndicatorPlotDefinition[];
  plotIndex: number;
  readonly point: {
    openTimeMs: number;
    values: Record<string, number | null>;
    colors: Record<string, string>;
    sizes: Record<string, number>;
  };
  readonly overlayUpdates: Map<string, IndicatorOverlay | null>;
  readonly signals: {
    readonly key: string;
    readonly direction: "long" | "short" | "neutral";
    readonly confidence?: number;
  }[];
  signalIndex: number;
}

let active: AuthoringFrame | undefined;

export function authoringFrame(): AuthoringFrame {
  if (active === undefined)
    throw new Error(
      "Per-bar input, ta and plot calls require a defineIndicator callback.",
    );
  return active;
}

export function withAuthoringFrame<T>(frame: AuthoringFrame, run: () => T): T {
  const previous = active;
  active = frame;
  try {
    return run();
  } finally {
    active = previous;
  }
}

export function useKernel<T>(signature: string, create: () => T): T {
  const frame = authoringFrame();
  const index = frame.kernelIndex++;
  if (index >= 256)
    throw new RangeError("An indicator may use at most 256 TA calls.");
  const existing = frame.kernels[index];
  if (existing === undefined) {
    const value = create();
    frame.kernels.push({ signature, value });
    return value;
  }
  if (existing.signature !== signature)
    throw new Error(
      "TA calls and lengths must remain in the same order on every bar; change inputs to rebuild.",
    );
  return existing.value as T;
}

export function newPoint(
  openTimeMs: number,
): AuthoringFrame["point"] & IndicatorResultPoint {
  return { openTimeMs, values: {}, colors: {}, sizes: {} };
}
