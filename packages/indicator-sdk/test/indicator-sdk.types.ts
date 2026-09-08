import type { InstrumentId, TimeframeId } from "@erc-chart/contracts";
import {
  indicatorSdkVersion,
  defineIndicator,
  input,
  plot,
  ta,
  type IndicatorDefinition,
  type IndicatorInputDefinition,
  type IndicatorInstance,
  type SignalCandidate,
} from "../src/index.js";

export const authored = defineIndicator(
  { id: "fixture.authored", name: "Authored" },
  ({ close }) => {
    const length: number = input.int(14, { title: "Length" });
    const value: number = ta.ema(close, length);
    const atr: number = ta.atr(length);
    const rsi: number = ta.rsi(length);
    plot.line(value + atr, { title: "Band", color: "#00ff00" });
    plot.histogram(rsi);
    // @ts-expect-error the authoring plot API accepts scalars, never historical arrays
    plot.line([value]);
    // @ts-expect-error implicit foreign timeframe acquisition is not implemented
    ta.ema(14, "1h");
  },
);

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
