import { authoringFrame, type AuthoringFrame } from "./authoring-context.js";
import {
  readCompilerCallsite,
  type CompilerSeriesSource,
} from "./internal/callsite.js";
import {
  resolveSignalDependencies,
  signalAlreadyCommitted,
  signalEventKey,
  sourceSignalDependency,
} from "./internal/signals.js";

export interface SignalOptions {
  readonly confidence?: number;
}

const frameSignalIdentities = new WeakMap<AuthoringFrame, Set<string>>();

function signalIdentities(frame: AuthoringFrame): Set<string> {
  let identities = frameSignalIdentities.get(frame);
  if (identities === undefined) {
    identities = new Set();
    frameSignalIdentities.set(frame, identities);
  }
  return identities;
}

function chartSeriesValue(
  frame: AuthoringFrame,
  source: CompilerSeriesSource,
): number {
  switch (source) {
    case "open":
    case "high":
    case "low":
    case "close":
      return frame.candle[source];
    case "volume":
      return frame.candle.volume ?? Number.NaN;
    case "hl2":
      return (frame.candle.high + frame.candle.low) / 2;
    case "hlc3":
      return (frame.candle.high + frame.candle.low + frame.candle.close) / 3;
    case "ohlc4":
      return (
        (frame.candle.open +
          frame.candle.high +
          frame.candle.low +
          frame.candle.close) /
        4
      );
  }
}

/** Signals commit only when every compiler-traced dependency is ready and confirmed. */
export function signal(
  condition: boolean,
  direction: "long" | "short" | "neutral",
  options: SignalOptions = {},
  hiddenCallsite?: unknown,
): void {
  const frame = authoringFrame();
  const callsite = readCompilerCallsite(hiddenCallsite, "signal", "signal");
  const index = frame.signalIndex;
  if (index >= 128)
    throw new RangeError("At most 128 signal conditions are allowed per bar.");
  if ("id" in options)
    throw new TypeError("Signal persistence identity is owned by the SDK.");
  if (
    options.confidence !== undefined &&
    (!Number.isFinite(options.confidence) ||
      options.confidence < 0 ||
      options.confidence > 1)
  )
    throw new RangeError("Signal confidence must be between 0 and 1.");
  if (
    callsite !== undefined &&
    !frame.discovery &&
    frame.phase === "finalized"
  ) {
    const identities = signalIdentities(frame);
    if (identities.has(callsite.id))
      throw new Error(
        `Compiler call-site identity ${callsite.id} for signal executed more than once in one finalized bar.`,
      );
    identities.add(callsite.id);
  }
  frame.signalIndex = index + 1;
  if (!condition || frame.discovery || frame.phase !== "finalized") return;

  const resolved = resolveSignalDependencies(
    frame.signalDependencies,
    callsite,
  );
  if (!resolved.ready) return;
  const dependencyIdentities = [...resolved.identities];
  const sources = [...resolved.sources];
  let occurredAtMs = resolved.occurredAtMs;
  if ((callsite?.chartSeries?.length ?? 0) > 0) {
    const chartSeries = callsite?.chartSeries ?? [];
    const chartDependency = sourceSignalDependency(
      frame.candle.timeframeId,
      frame.candle.openTimeMs,
      chartSeries.every((source) =>
        Number.isFinite(chartSeriesValue(frame, source)),
      ),
      frame.sourceMetadata[frame.candle.timeframeId],
    );
    if (!chartDependency.ready) return;
    dependencyIdentities.push(...chartDependency.identities);
    for (const source of chartDependency.sources) {
      if (
        !sources.some(
          (candidate) =>
            candidate.timeframeId === source.timeframeId &&
            candidate.activeTimeframeId === source.activeTimeframeId &&
            candidate.openTimeMs === source.openTimeMs,
        )
      )
        sources.push(source);
    }
    occurredAtMs = frame.candle.openTimeMs;
  }
  const key = callsite?.id ?? `signal_${index}`;
  const eventKey = signalEventKey(
    key,
    [...new Set(dependencyIdentities)],
    frame.candle.openTimeMs,
  );
  if (signalAlreadyCommitted(frame.signalState, key, eventKey)) return;
  frame.signals.push({
    key,
    eventKey,
    occurredAtMs: occurredAtMs ?? frame.candle.openTimeMs,
    sources,
    direction,
    ...(options.confidence === undefined
      ? {}
      : { confidence: options.confidence }),
  });
}
