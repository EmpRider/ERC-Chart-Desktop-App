export const shape = Object.freeze({
  circle: "circle",
  triangleUp: "triangle-up",
  triangleDown: "triangle-down",
  labelUp: "label-up",
  labelDown: "label-down",
} as const);

export type ShapeKind = (typeof shape)[keyof typeof shape];

export const location = Object.freeze({
  aboveBar: "above-bar",
  belowBar: "below-bar",
  absolute: "absolute",
} as const);

export type ShapeLocation = (typeof location)[keyof typeof location];

export const textSize = Object.freeze({
  tiny: "tiny",
  small: "small",
  normal: "normal",
  large: "large",
  xlarge: "xlarge",
} as const);

export type TextSize = (typeof textSize)[keyof typeof textSize];

const shapeKinds = new Set<string>(Object.values(shape));
const shapeLocations = new Set<string>(Object.values(location));
const textSizes = new Set<string>(Object.values(textSize));

export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === "string" && shapeKinds.has(value);
}

export function isShapeLocation(value: unknown): value is ShapeLocation {
  return typeof value === "string" && shapeLocations.has(value);
}

export function isTextSize(value: unknown): value is TextSize {
  return typeof value === "string" && textSizes.has(value);
}
