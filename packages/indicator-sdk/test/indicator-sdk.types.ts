import type { InstrumentId, TimeframeId } from "@erc-chart/contracts";
import {
  indicatorSdkVersion,
  type IndicatorDefinition,
  type IndicatorInputDefinition,
  type IndicatorInstance,
  type SignalCandidate,
} from "../src/index.js";

// @ts-expect-error boolean inputs cannot use string defaults
export const invalidInput: IndicatorInputDefinition = {
  key: "enabled",
  label: "Enabled",
  type: "boolean",
  defaultValue: "yes",
};

export const definition = {
  id: "fixture-indicator",
  name: "Fixture Indicator",
  indicatorContractVersion: indicatorSdkVersion,
  hostCompatibility: {
    minimumHostApiVersion: indicatorSdkVersion,
    maximumHostApiVersion: indicatorSdkVersion,
  },
  inputs: [
    {
      key: "length",
      label: "Length",
      type: "number",
      defaultValue: 14,
    },
  ],
  outputs: [{ key: "value", label: "Value" }],
  plots: [{ key: "value", kind: "line" }],
  requiresLiveTicks: true,
} satisfies IndicatorDefinition;

export const instance: IndicatorInstance = {
  onHistory: () => undefined,
  onBuildingBar: () => undefined,
  onFinalizedBar: () => undefined,
  onTick: () => undefined,
  dispose: () => undefined,
};

export const signalCandidate: SignalCandidate = {
  signalContractVersion: indicatorSdkVersion,
  id: "candidate-1",
  indicatorId: definition.id,
  instrumentId: "fixture-instrument" as InstrumentId,
  timeframeId: "fixture-timeframe" as TimeframeId,
  occurredAtMs: 1_700_000_000_000,
  direction: "long",
  finalized: false,
};
