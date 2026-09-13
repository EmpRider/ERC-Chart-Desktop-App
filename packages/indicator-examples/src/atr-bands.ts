import {
  defineIndicator,
  input,
  plot,
  signal,
  ta,
  type IndicatorModule,
} from "@erc-chart/indicator-sdk";

const indicator: IndicatorModule = defineIndicator(
  {
    id: "erc.indicator.atr-bands.main",
    name: "ATR Bands",
  },
  ({ close, low }) => {
    const length = input.int(14, { title: "Length", min: 1, max: 500 });
    const multiplier = input.float(1.5, { title: "ATR multiplier", min: 0 });
    const color = input.color("#2962ff", {
      title: "Band color",
      effect: "presentation",
    });
    const basis = ta.ema(close, length);
    const width = ta.atr(length) * multiplier;
    const crossed = ta.crossover(close, basis);

    plot.line(basis, { title: "Basis", color, width: 2 });
    plot.line(basis + width, { title: "Upper", color });
    plot.line(basis - width, { title: "Lower", color });
    plot.shape(crossed ? low : null, {
      title: "Cross up",
      direction: "up",
      color: "#089981",
    });
    signal(crossed, "long");
  },
);
export default indicator;
