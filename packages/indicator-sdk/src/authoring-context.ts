import type { Candle } from "@erc-chart/contracts";
import type {
  IndicatorInputDefinition,
  IndicatorInputValue,
  IndicatorOverlay,
  IndicatorPlotDefinition,
  IndicatorResultPoint,
} from "./index.js";
import type { CompilerCallsite } from "./internal/callsite.js";
import type { IndicatorSourceMetadata } from "./internal/runtime-contracts.js";
import type { SignalDependency, SignalState } from "./internal/signals.js";

export interface KernelSlot {
  readonly signature: string;
  readonly value: unknown;
}
export interface AuthoringFrame {
  readonly candle: Candle;
  readonly sourceCandles: Readonly<Record<string, readonly Candle[]>>;
  readonly sourceMetadata: Readonly<Record<string, IndicatorSourceMetadata>>;
  readonly dependencyInputs: Readonly<
    Record<string, readonly IndicatorResultPoint[]>
  >;
  readonly phase: "building" | "finalized";
  readonly historyReplay: boolean;
  readonly historyFinalizedTail: boolean;
  readonly discovery: boolean;
  readonly kernels: KernelSlot[];
  kernelIndex: number;
  readonly inputs: IndicatorInputDefinition[];
  inputIndex: number;
  readonly timeframeInputs: {
    readonly key: string;
    readonly value: string;
  }[];
  readonly candleTypeInputs: {
    readonly key: string;
    readonly value: "standard" | "heikin-ashi";
  }[];
  indicatorTimeframeId?: string;
  indicatorTimeframeInputKey?: string;
  indicatorCandleType?: "standard" | "heikin-ashi";
  indicatorCandleTypeInputKey?: string;
  readonly taTimeframeIds: Set<string>;
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
  readonly signalDependencies: Map<string, SignalDependency>;
  readonly signalState: SignalState;
  readonly signals: {
    readonly key: string;
    readonly eventKey: string;
    readonly occurredAtMs: number;
    readonly sources: readonly import("@erc-chart/contracts").IndicatorRuntimeSignalSource[];
    readonly direction: "long" | "short" | "neutral";
    readonly confidence?: number;
  }[];
  signalIndex: number;
}

interface FrameKernelUsage {
  positionalIndex: number;
  readonly identities: Set<string>;
}

let active: AuthoringFrame | undefined;
const frameKernelUsage = new WeakMap<AuthoringFrame, FrameKernelUsage>();
const identityKernelStores = new WeakMap<
  KernelSlot[],
  Map<string, KernelSlot>
>();

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

function kernelUsage(frame: AuthoringFrame): FrameKernelUsage {
  let usage = frameKernelUsage.get(frame);
  if (usage === undefined) {
    usage = { positionalIndex: 0, identities: new Set() };
    frameKernelUsage.set(frame, usage);
  }
  return usage;
}

function identityKernelStore(kernels: KernelSlot[]): Map<string, KernelSlot> {
  let store = identityKernelStores.get(kernels);
  if (store === undefined) {
    store = new Map();
    identityKernelStores.set(kernels, store);
  }
  return store;
}

export function useKernel<T>(
  signature: string,
  create: () => T,
  callsite?: CompilerCallsite,
): T {
  const frame = authoringFrame();
  const usage = kernelUsage(frame);
  const store = identityKernelStore(frame.kernels);

  if (callsite !== undefined) {
    if (usage.identities.has(callsite.id))
      throw new Error(
        `Compiler call-site identity ${callsite.id} for ${callsite.callee} executed more than once in one bar.`,
      );
    const existing = store.get(callsite.id);
    if (existing !== undefined) {
      usage.identities.add(callsite.id);
      if (existing.signature !== signature)
        throw new Error(
          `Runtime state for ${callsite.callee} at compiler call-site ${callsite.id} changed shape; change inputs to rebuild.`,
        );
      return existing.value as T;
    }
    if (frame.kernels.length + store.size >= 256)
      throw new RangeError("An indicator may use at most 256 TA calls.");
    const value = create();
    usage.identities.add(callsite.id);
    store.set(callsite.id, { signature, value });
    return value;
  }

  const positionalIndex = usage.positionalIndex++;
  const existing = frame.kernels[positionalIndex];
  frame.kernelIndex += 1;
  if (existing !== undefined) {
    if (existing.signature !== signature)
      throw new Error(
        "TA calls and lengths must remain in the same order on every bar; change inputs to rebuild.",
      );
    return existing.value as T;
  }
  if (frame.kernels.length + store.size >= 256)
    throw new RangeError("An indicator may use at most 256 TA calls.");
  const value = create();
  frame.kernels.push({ signature, value });
  return value;
}

export function newPoint(
  openTimeMs: number,
): AuthoringFrame["point"] & IndicatorResultPoint {
  return { openTimeMs, values: {}, colors: {}, sizes: {} };
}
