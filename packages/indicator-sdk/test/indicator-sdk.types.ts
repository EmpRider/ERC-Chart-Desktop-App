import {
  indicatorSdkVersion,
  defineIndicator,
  history,
  input,
  location,
  plot,
  shape,
  ta,
  textSize,
  type IndicatorDefinition,
  type IndicatorInputDefinition,
} from "../src/index.js";
import type { IndicatorBar as CanonicalIndicatorBar } from "../src/indicator.js";
import type { SeriesNumber } from "../src/series.js";

declare const canonicalBar: CanonicalIndicatorBar;
const canonicalClose: SeriesNumber = canonicalBar.close;
const canonicalVolume: SeriesNumber = canonicalBar.volume;
void canonicalClose;
void canonicalVolume;

export const authored = defineIndicator(
  { id: "fixture.authored", name: "Authored" },
  ({ close, volume }) => {
    const length: number = input.int(14, { title: "Length" });
    const value: number = ta.ema(close, length);
    const atr: number = ta.atr(length);
    const rsi: number = ta.rsi(length);
    // Raw TypeScript applies noUncheckedIndexedAccess before the package
    // transform lowers bracket history access to history(close, 1).
    const previousByIndex: number | undefined = close[1];
    const previousByAt: number = close.at(1);
    const previousByFunction: number = history(close, 1);
    const previousDerived: number = history(close * 2, 1);
    const currentVolume: number = volume;
    const previousVolumeByIndex: number | undefined = volume[1];
    const previousVolumeByAt: number = volume.at(1);
    const previousVolumeByFunction: number = history(volume, 1);
    void previousByIndex;
    void previousVolumeByIndex;
    plot.line(
      value +
        atr +
        previousByAt +
        previousByFunction +
        previousDerived +
        currentVolume +
        previousVolumeByAt +
        previousVolumeByFunction,
      { title: "Band", color: "#00ff00" },
    );
    plot.histogram(rsi);
    plot.shape(value > 0, {
      shape: shape.labelUp,
      location: location.belowBar,
      text: "BUY",
      textColor: "#ffffff",
      textSize: textSize.small,
      color: "#00ff00",
    });
    plot.shape(value > 0, "BUY");
    plot.shape(value > 0, shape.labelUp, "BUY");
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
