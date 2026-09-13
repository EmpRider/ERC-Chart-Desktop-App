import type { Candle } from "@erc-chart/contracts";
import type {
  ProviderBarAlignment,
  ProviderCapabilities,
  ProviderTimeframeCapability,
} from "@erc-chart/provider-sdk";

export interface TimeframePlan {
  readonly target: ProviderTimeframeCapability;
  readonly source: ProviderTimeframeCapability;
}

export interface EffectiveIndicatorTimeframe {
  readonly id: string;
  readonly seconds: number;
  readonly native: boolean;
  readonly historical: boolean;
  readonly live: boolean;
  readonly sourceTimeframeId: string;
}

export interface EffectiveIndicatorTimeframeResolution {
  readonly requestedTimeframeId: string;
  readonly active: EffectiveIndicatorTimeframe;
  readonly usedFallback: boolean;
}

export function parseTimeframeSeconds(timeframeId: string): number | undefined {
  const match = /^(\d+)(s|m|h|d)$/u.exec(timeframeId);
  if (match === null) return undefined;
  const amount = Number(match[1]);
  const multiplier =
    match[2] === "s"
      ? 1
      : match[2] === "m"
        ? 60
        : match[2] === "h"
          ? 3600
          : 86_400;
  const seconds = amount * multiplier;
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined;
}

function fallbackCapabilities(
  capabilities: ProviderCapabilities,
): readonly ProviderTimeframeCapability[] {
  return Object.freeze(
    capabilities.nativeTimeframes.flatMap((id) => {
      const seconds = parseTimeframeSeconds(id);
      return seconds === undefined
        ? []
        : [
            {
              id,
              seconds,
              historical: true,
              live: capabilities.liveData,
              native: true,
              alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
            } satisfies ProviderTimeframeCapability,
          ];
    }),
  );
}

export function timeframeCapabilities(
  capabilities: ProviderCapabilities,
): readonly ProviderTimeframeCapability[] {
  return capabilities.timeframes === undefined
    ? fallbackCapabilities(capabilities)
    : capabilities.timeframes;
}

export function resolveTimeframePlan(
  capabilities: ProviderCapabilities,
  targetTimeframeId: string,
): TimeframePlan {
  const all = timeframeCapabilities(capabilities);
  const target = all.find(({ id }) => id === targetTimeframeId);
  if (target === undefined)
    throw new RangeError("Provider timeframe is unavailable.");
  if (target.native) return Object.freeze({ target, source: target });
  const source = all.find(({ id }) => id === target.derivedFromTimeframeId);
  if (
    source === undefined ||
    !source.native ||
    target.seconds % source.seconds !== 0 ||
    target.alignment.mode !== source.alignment.mode ||
    target.alignment.originMs !== source.alignment.originMs ||
    target.alignment.timeZone !== source.alignment.timeZone
  ) {
    throw new RangeError("Provider-derived timeframe declaration is invalid.");
  }
  return Object.freeze({ target, source });
}

function isDeclaredDerivedTimeframe(
  capabilities: ProviderCapabilities,
  timeframeId: string,
): boolean {
  if (!capabilities.derivedTimeframes) return false;
  return (
    capabilities.derivedTimeframeIds === undefined ||
    capabilities.derivedTimeframeIds.includes(timeframeId)
  );
}

function effectiveTimeframeFromPlan(
  plan: TimeframePlan,
): EffectiveIndicatorTimeframe {
  const historical = plan.target.historical && plan.source.historical;
  const live = plan.target.live && plan.source.live;
  return Object.freeze({
    id: plan.target.id,
    seconds: plan.target.seconds,
    native: plan.target.native,
    historical,
    live,
    sourceTimeframeId: plan.source.id,
  });
}

export function effectiveIndicatorTimeframes(
  capabilities: ProviderCapabilities,
): readonly EffectiveIndicatorTimeframe[] {
  const nativeIds = new Set(capabilities.nativeTimeframes);
  const effective: EffectiveIndicatorTimeframe[] = [];
  for (const timeframe of timeframeCapabilities(capabilities)) {
    if (timeframe.native) {
      if (!nativeIds.has(timeframe.id)) continue;
    } else if (!isDeclaredDerivedTimeframe(capabilities, timeframe.id)) {
      continue;
    }

    try {
      const plan = resolveTimeframePlan(capabilities, timeframe.id);
      if (!nativeIds.has(plan.source.id)) continue;
      effective.push(effectiveTimeframeFromPlan(plan));
    } catch (error) {
      if (error instanceof RangeError) continue;
      throw error;
    }
  }
  return Object.freeze(effective);
}

export function resolveEffectiveIndicatorTimeframe(
  capabilities: ProviderCapabilities,
  requestedTimeframeId: string,
  fallbackTimeframeId: string,
): EffectiveIndicatorTimeframeResolution {
  const effective = effectiveIndicatorTimeframes(capabilities);
  const requested = effective.find(({ id }) => id === requestedTimeframeId);
  if (requested !== undefined) {
    return Object.freeze({
      requestedTimeframeId,
      active: requested,
      usedFallback: false,
    });
  }

  const fallback = effective.find(({ id }) => id === fallbackTimeframeId);
  if (fallback === undefined) {
    throw new RangeError(
      `Requested timeframe ${requestedTimeframeId} is unavailable and fallback ${fallbackTimeframeId} is unavailable.`,
    );
  }
  return Object.freeze({
    requestedTimeframeId,
    active: fallback,
    usedFallback: true,
  });
}

export function alignedOpenTime(
  timestampMs: number,
  timeframeSeconds: number,
  alignment: ProviderBarAlignment,
): number {
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0)
    throw new RangeError("Timestamp must be a non-negative safe integer.");
  if (!Number.isSafeInteger(timeframeSeconds) || timeframeSeconds <= 0)
    throw new RangeError("Timeframe seconds must be a positive safe integer.");
  if (
    (alignment.mode !== "epoch" && alignment.mode !== "session") ||
    !Number.isSafeInteger(alignment.originMs) ||
    typeof alignment.timeZone !== "string" ||
    alignment.timeZone.trim() !== alignment.timeZone ||
    alignment.timeZone.length === 0 ||
    alignment.timeZone.length > 128
  ) {
    throw new RangeError("Provider alignment metadata is invalid.");
  }
  const durationMs = timeframeSeconds * 1000;
  if (!Number.isSafeInteger(durationMs))
    throw new RangeError("Timeframe duration must be a safe integer.");
  const openTimeMs =
    alignment.originMs +
    Math.floor((timestampMs - alignment.originMs) / durationMs) * durationMs;
  if (!Number.isSafeInteger(openTimeMs) || openTimeMs < 0)
    throw new RangeError(
      "Aligned open time must be a non-negative safe integer.",
    );
  return openTimeMs;
}

export function aggregateTimeframeCandles(
  baseCandles: readonly Candle[],
  target: ProviderTimeframeCapability,
): readonly Candle[] {
  if (target.native || target.derivedFromTimeframeId === undefined)
    throw new RangeError("Target timeframe must be declared as derived.");
  const buckets = new Map<number, Candle>();
  for (const candle of [...baseCandles].sort(
    (left, right) => left.openTimeMs - right.openTimeMs,
  )) {
    const openTimeMs = alignedOpenTime(
      candle.openTimeMs,
      target.seconds,
      target.alignment,
    );
    const current = buckets.get(openTimeMs);
    if (current === undefined) {
      buckets.set(openTimeMs, {
        instrumentId: candle.instrumentId,
        timeframeId: target.id,
        openTimeMs,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        ...(candle.volume === undefined ? {} : { volume: candle.volume }),
      });
      continue;
    }
    buckets.set(openTimeMs, {
      ...current,
      high: Math.max(current.high, candle.high),
      low: Math.min(current.low, candle.low),
      close: candle.close,
      ...(current.volume === undefined || candle.volume === undefined
        ? {}
        : { volume: current.volume + candle.volume }),
    });
  }
  return Object.freeze([...buckets.values()]);
}
