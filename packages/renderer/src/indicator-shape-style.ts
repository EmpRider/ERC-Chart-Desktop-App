import type { InstalledIndicatorPlotDefinition } from "@erc-chart/contracts";

const textSizePixels = Object.freeze({
  tiny: 8,
  small: 10,
  normal: 12,
  large: 14,
  xlarge: 18,
} as const);

export function indicatorShapeText(
  plot: InstalledIndicatorPlotDefinition,
): string {
  if (plot.text !== undefined) return plot.text;
  if (plot.shape === "circle") return "●";
  if (plot.shape === "triangle-down" || plot.shape === "label-down") return "▼";
  if (plot.shape === "triangle-up" || plot.shape === "label-up") return "▲";
  return plot.direction === "down" ? "▼" : "▲";
}

export function indicatorShapeBaseline(
  plot: InstalledIndicatorPlotDefinition,
): "top" | "bottom" | undefined {
  if (plot.location === "below-bar") return "top";
  if (plot.location === "above-bar") return "bottom";
  return undefined;
}

export function indicatorShapeTextSize(
  plot: InstalledIndicatorPlotDefinition,
): number | undefined {
  return plot.textSize === undefined
    ? undefined
    : textSizePixels[plot.textSize];
}
