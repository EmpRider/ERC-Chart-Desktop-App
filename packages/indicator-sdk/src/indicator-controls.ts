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
  timeframe(timeframeId: string): void {
    const frame = authoringFrame();
    const value = requireTimeframeId(timeframeId);
    if (
      frame.indicatorTimeframeId !== undefined &&
      frame.indicatorTimeframeId !== value
    ) {
      throw new Error("Indicator timeframe must remain stable within one bar.");
    }
    frame.indicatorTimeframeId = value;
  },
});
