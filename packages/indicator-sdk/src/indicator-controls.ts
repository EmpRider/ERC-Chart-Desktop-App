import { authoringFrame } from "./authoring-context.js";

function requireTimeframeId(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 64 ||
    value.trim() !== value
  ) {
    throw new RangeError(
      "Indicator timeframe must be a non-empty timeframe ID.",
    );
  }
  return value;
}

export interface IndicatorApi {
  readonly timeframe: (timeframeId: string) => void;
}

export const indicator: IndicatorApi = Object.freeze({
  timeframe(timeframeId: string, hiddenInputKey?: unknown): void {
    const frame = authoringFrame();
    const value = requireTimeframeId(timeframeId);
    if (
      frame.indicatorTimeframeId !== undefined &&
      frame.indicatorTimeframeId !== value
    ) {
      throw new Error("Indicator timeframe must remain stable within one bar.");
    }
    if (hiddenInputKey !== undefined) {
      if (
        typeof hiddenInputKey !== "string" ||
        !frame.timeframeInputs.some(({ key }) => key === hiddenInputKey)
      )
        throw new TypeError(
          "Indicator timeframe input identity does not match a declared timeframe input.",
        );
      if (
        frame.indicatorTimeframeInputKey !== undefined &&
        frame.indicatorTimeframeInputKey !== hiddenInputKey
      )
        throw new Error(
          "Indicator timeframe input identity must remain stable within one bar.",
        );
      frame.indicatorTimeframeInputKey = hiddenInputKey;
    }
    frame.indicatorTimeframeId = value;
  },
});
