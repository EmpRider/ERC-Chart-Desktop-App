import type {
  ProviderCapabilities,
  ProviderInstrument,
  ProviderTimeframeCapability,
} from "@erc-chart/provider-sdk";
import { timeframeCapabilities } from "./timeframes.js";

export interface ProviderSelectorData {
  readonly instruments: readonly ProviderInstrument[];
  readonly timeframes: readonly ProviderTimeframeCapability[];
}

export function createProviderSelectorData(
  capabilities: ProviderCapabilities,
  instruments: readonly ProviderInstrument[],
): ProviderSelectorData {
  const uniqueInstruments = new Map<string, ProviderInstrument>();
  for (const instrument of instruments) {
    if (!uniqueInstruments.has(instrument.id))
      uniqueInstruments.set(instrument.id, Object.freeze({ ...instrument }));
  }

  const uniqueTimeframes = new Map<string, ProviderTimeframeCapability>();
  for (const timeframe of timeframeCapabilities(capabilities)) {
    if (!timeframe.historical || uniqueTimeframes.has(timeframe.id)) continue;
    uniqueTimeframes.set(
      timeframe.id,
      Object.freeze({
        ...timeframe,
        alignment: Object.freeze({ ...timeframe.alignment }),
      }),
    );
  }

  return Object.freeze({
    instruments: Object.freeze([...uniqueInstruments.values()]),
    timeframes: Object.freeze(
      [...uniqueTimeframes.values()].sort(
        (left, right) =>
          left.seconds - right.seconds || left.id.localeCompare(right.id),
      ),
    ),
  });
}
