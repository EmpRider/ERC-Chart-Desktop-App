import type { IndicatorOverlay } from "./index.js";

export function sameDrawing(
  left: IndicatorOverlay,
  right: IndicatorOverlay,
): boolean {
  if (left.kind !== right.kind || left.id !== right.id) return false;
  if (left.kind === "box" && right.kind === "box")
    return (
      left.startTimeMs === right.startTimeMs &&
      left.endTimeMs === right.endTimeMs &&
      left.top === right.top &&
      left.bottom === right.bottom &&
      left.color === right.color &&
      left.borderColor === right.borderColor
    );
  if (left.kind === "line-segment" && right.kind === "line-segment")
    return (
      left.startTimeMs === right.startTimeMs &&
      left.endTimeMs === right.endTimeMs &&
      left.startValue === right.startValue &&
      left.endValue === right.endValue &&
      left.color === right.color &&
      left.width === right.width &&
      left.style === right.style
    );
  return false;
}
