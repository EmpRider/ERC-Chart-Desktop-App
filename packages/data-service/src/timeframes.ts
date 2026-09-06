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
    target.alignment.originMs !== source.alignment.originMs
  ) {
    throw new RangeError("Provider-derived timeframe declaration is invalid.");
  }
  return Object.freeze({ target, source });
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
  if (!Number.isSafeInteger(alignment.originMs))
    throw new RangeError("Alignment origin must be a safe integer.");
  const durationMs = timeframeSeconds * 1000;
  return (
    alignment.originMs +
    Math.floor((timestampMs - alignment.originMs) / durationMs) * durationMs
  );
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
