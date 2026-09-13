import { authoringFrame, type AuthoringFrame } from "./authoring-context.js";
import {
  isShapeKind,
  isShapeLocation,
  isTextSize,
  type ShapeKind,
  type ShapeLocation,
  type TextSize,
} from "./constants.js";
import { readCompilerCallsite } from "./internal/callsite.js";
import { drawingController } from "./internal/drawings.js";
import type {
  IndicatorBox,
  IndicatorLineSegment,
  IndicatorPlotDefinition,
} from "./index.js";

export interface PlotOptions {
  readonly key?: string;
  readonly title?: string;
  readonly color?: string;
  readonly width?: number;
  readonly style?: "solid" | "dashed" | "dotted";
}
export interface ShapeOptions extends PlotOptions {
  readonly direction?: "up" | "down";
  readonly shape?: ShapeKind;
  readonly location?: ShapeLocation;
  readonly text?: string;
  readonly textColor?: string;
  readonly textSize?: TextSize;
}

export interface BoxDrawing {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly color: string;
  readonly borderColor?: string;
}

export interface SegmentDrawing {
  readonly left: number;
  readonly right: number;
  readonly startValue: number;
  readonly endValue: number;
  readonly color: string;
  readonly width: number;
  readonly style: "solid" | "dashed" | "dotted";
}

export interface DrawingHandle<T> {
  readonly set: (patch: Partial<T>) => void;
  readonly delete: () => void;
}

export type BoxHandle = DrawingHandle<BoxDrawing>;
export type SegmentHandle = DrawingHandle<SegmentDrawing>;

type ValuePlotCallee =
  "plot.line" | "plot.hline" | "plot.histogram" | "plot.shape";

interface CompilerPlotDeclaration {
  readonly id: string;
  readonly kind: IndicatorPlotDefinition["kind"];
  readonly outputKey: string;
  readonly label: string;
  readonly keyExplicit: boolean;
  readonly titleExplicit: boolean;
  readonly color?: string;
  readonly width?: number;
  readonly style?: "solid" | "dashed" | "dotted";
  readonly direction?: "up" | "down";
  readonly shape?: ShapeKind;
  readonly location?: ShapeLocation;
  readonly text?: string;
  readonly textColor?: string;
  readonly textSize?: TextSize;
}

declare const __ERC_INDICATOR_PLOT_DECLARATIONS__:
  readonly CompilerPlotDeclaration[] | undefined;

interface PlotDeclarationMetadata {
  readonly keyExplicit: boolean;
  readonly titleExplicit: boolean;
}

interface FramePlotUsage {
  positionalIndex: number;
  readonly identities: Set<string>;
}

const plotDeclarationMetadata = new WeakMap<
  IndicatorPlotDefinition,
  PlotDeclarationMetadata
>();
const framePlotUsage = new WeakMap<AuthoringFrame, FramePlotUsage>();

function plotUsage(frame: AuthoringFrame): FramePlotUsage {
  let usage = framePlotUsage.get(frame);
  if (usage === undefined) {
    usage = { positionalIndex: 0, identities: new Set() };
    framePlotUsage.set(frame, usage);
  }
  return usage;
}

function plotKeysCollide(
  left: IndicatorPlotDefinition,
  right: IndicatorPlotDefinition,
): boolean {
  const leftOutput = left.outputKey ?? left.key;
  const rightOutput = right.outputKey ?? right.key;
  return (
    left.key === right.key ||
    left.key === rightOutput ||
    leftOutput === right.key ||
    leftOutput === rightOutput
  );
}

function shapeDefinitionFields(
  options: ShapeOptions,
): Partial<IndicatorPlotDefinition> {
  return {
    ...(options.direction === undefined
      ? {}
      : { direction: options.direction }),
    ...(options.shape === undefined ? {} : { shape: options.shape }),
    ...(options.location === undefined ? {} : { location: options.location }),
    ...(options.text === undefined ? {} : { text: options.text }),
    ...(options.textColor === undefined
      ? {}
      : { textColor: options.textColor }),
    ...(options.textSize === undefined ? {} : { textSize: options.textSize }),
  };
}

export function compilerPlotDefinitions(): IndicatorPlotDefinition[] {
  const declarations =
    typeof __ERC_INDICATOR_PLOT_DECLARATIONS__ === "undefined"
      ? []
      : __ERC_INDICATOR_PLOT_DECLARATIONS__;
  if (declarations.length > 128)
    throw new RangeError("An indicator may declare at most 128 plots.");
  const definitions: IndicatorPlotDefinition[] = [];
  for (const declaration of declarations) {
    const definition: IndicatorPlotDefinition = {
      key: declaration.id,
      outputKey: declaration.outputKey,
      kind: declaration.kind,
      label: declaration.label,
      ...(declaration.color === undefined ? {} : { color: declaration.color }),
      ...(declaration.width === undefined ? {} : { width: declaration.width }),
      ...(declaration.style === undefined ? {} : { style: declaration.style }),
      ...(declaration.direction === undefined
        ? {}
        : { direction: declaration.direction }),
      ...(declaration.shape === undefined ? {} : { shape: declaration.shape }),
      ...(declaration.location === undefined
        ? {}
        : { location: declaration.location }),
      ...(declaration.text === undefined ? {} : { text: declaration.text }),
      ...(declaration.textColor === undefined
        ? {}
        : { textColor: declaration.textColor }),
      ...(declaration.textSize === undefined
        ? {}
        : { textSize: declaration.textSize }),
    };
    if (definitions.some((value) => plotKeysCollide(value, definition)))
      throw new Error("Plot keys must be unique.");
    definitions.push(definition);
    plotDeclarationMetadata.set(definition, {
      keyExplicit: declaration.keyExplicit,
      titleExplicit: declaration.titleExplicit,
    });
  }
  return definitions;
}

function preservesPlotDeclaration(
  definition: IndicatorPlotDefinition,
  metadata: PlotDeclarationMetadata,
  kind: IndicatorPlotDefinition["kind"],
  options: ShapeOptions,
): boolean {
  const keyExplicit = options.key !== undefined;
  const titleExplicit = options.title !== undefined;
  const preservesKey =
    metadata.keyExplicit === keyExplicit &&
    (!metadata.keyExplicit || definition.outputKey === options.key);
  const preservesTitle =
    metadata.titleExplicit === titleExplicit &&
    (!metadata.titleExplicit || definition.label === options.title);
  return (
    definition.kind === kind &&
    preservesKey &&
    preservesTitle &&
    definition.style === options.style &&
    definition.direction === options.direction &&
    definition.shape === options.shape &&
    definition.location === options.location &&
    definition.text === options.text &&
    definition.textColor === options.textColor &&
    definition.textSize === options.textSize
  );
}

function discoveryCompilerDefinition(
  frame: AuthoringFrame,
  index: number,
  definition: IndicatorPlotDefinition,
  kind: IndicatorPlotDefinition["kind"],
  options: ShapeOptions,
): IndicatorPlotDefinition {
  const next: IndicatorPlotDefinition = {
    key: definition.key,
    outputKey: options.key ?? definition.outputKey ?? definition.key,
    kind,
    label: options.title ?? definition.label ?? definition.key,
    ...(options.color === undefined ? {} : { color: options.color }),
    ...(options.width === undefined ? {} : { width: options.width }),
    ...(options.style === undefined ? {} : { style: options.style }),
    ...shapeDefinitionFields(options),
  };
  if (
    frame.plots.some(
      (plot, plotIndex) => plotIndex !== index && plotKeysCollide(plot, next),
    )
  )
    throw new Error("Plot keys must be unique.");
  frame.plots[index] = next;
  plotDeclarationMetadata.set(next, {
    keyExplicit: options.key !== undefined,
    titleExplicit: options.title !== undefined,
  });
  return next;
}

function assertShapeOptions(
  kind: IndicatorPlotDefinition["kind"],
  options: ShapeOptions,
): void {
  const hasShapeMetadata =
    options.shape !== undefined ||
    options.location !== undefined ||
    options.text !== undefined ||
    options.textColor !== undefined ||
    options.textSize !== undefined;
  if (kind !== "shape") {
    if (hasShapeMetadata)
      throw new TypeError("Shape metadata is only valid for plot.shape().");
    return;
  }
  if (options.shape !== undefined && !isShapeKind(options.shape))
    throw new TypeError("Shape marker type is invalid.");
  if (options.location !== undefined && !isShapeLocation(options.location))
    throw new TypeError("Shape location is invalid.");
  if (
    options.text !== undefined &&
    (typeof options.text !== "string" || options.text.length > 256)
  )
    throw new RangeError("Shape text must contain at most 256 characters.");
  if (
    options.textColor !== undefined &&
    (typeof options.textColor !== "string" ||
      options.textColor.length === 0 ||
      options.textColor.length > 128 ||
      options.textColor.trim() !== options.textColor)
  )
    throw new TypeError("Shape text color must be a non-empty bounded string.");
  if (options.textSize !== undefined && !isTextSize(options.textSize))
    throw new TypeError("Shape text size is invalid.");
}

function valuePlot(
  kind: IndicatorPlotDefinition["kind"],
  callee: ValuePlotCallee,
  value: number | null,
  options: ShapeOptions = {},
  hiddenCallsite?: unknown,
): void {
  const frame = authoringFrame();
  const callsite = readCompilerCallsite(hiddenCallsite, "plot", callee);
  const usage = plotUsage(frame);
  let index: number;
  if (callsite !== undefined) {
    if (usage.identities.has(callsite.id))
      throw new Error(
        `Compiler call-site identity ${callsite.id} for ${callsite.callee} executed more than once in one bar.`,
      );
    if (frame.plotIndex + usage.identities.size >= 128)
      throw new RangeError("An indicator may declare at most 128 plots.");
    usage.identities.add(callsite.id);
    index = frame.plots.findIndex((plot) => plot.key === callsite.id);
    if (index < 0)
      throw new Error(
        `Compiler plot declaration ${callsite.id} for ${callsite.callee} is missing; rebuild the indicator package.`,
      );
  } else {
    if (frame.discovery) {
      if (frame.plots.length >= 128)
        throw new RangeError("An indicator may declare at most 128 plots.");
      index = frame.plots.length;
    } else {
      const compilerDeclarationCount =
        typeof __ERC_INDICATOR_PLOT_DECLARATIONS__ === "undefined"
          ? 0
          : __ERC_INDICATOR_PLOT_DECLARATIONS__.length;
      index = compilerDeclarationCount + usage.positionalIndex;
    }
    usage.positionalIndex += 1;
    frame.plotIndex += 1;
  }

  if (
    options.width !== undefined &&
    (!Number.isFinite(options.width) ||
      options.width <= 0 ||
      options.width > 20)
  )
    throw new RangeError("Plot width must be greater than 0 and at most 20.");
  assertShapeOptions(kind, options);

  let resolvedOutputKey: string;
  if (callsite === undefined && frame.discovery) {
    const outputKey = options.key ?? `plot_${index}`;
    const definition: IndicatorPlotDefinition = {
      key: outputKey,
      outputKey,
      kind,
      label: options.title ?? `Plot ${index + 1}`,
      ...(options.color === undefined ? {} : { color: options.color }),
      ...(options.width === undefined ? {} : { width: options.width }),
      ...(options.style === undefined ? {} : { style: options.style }),
      ...shapeDefinitionFields(options),
    };
    if (frame.plots.some((plot) => plotKeysCollide(plot, definition)))
      throw new Error("Plot keys must be unique.");
    frame.plots.push(definition);
    plotDeclarationMetadata.set(definition, {
      keyExplicit: options.key !== undefined,
      titleExplicit: options.title !== undefined,
    });
    resolvedOutputKey = outputKey;
  } else {
    let definition = frame.plots[index];
    if (definition === undefined)
      throw new Error(
        "Plot declarations must preserve their identity, kind, key and options on every bar.",
      );
    if (frame.discovery && callsite !== undefined) {
      definition = discoveryCompilerDefinition(
        frame,
        index,
        definition,
        kind,
        options,
      );
    } else {
      const metadata = plotDeclarationMetadata.get(definition);
      if (
        metadata === undefined ||
        !preservesPlotDeclaration(definition, metadata, kind, options)
      )
        throw new Error(
          "Plot declarations must preserve their identity, kind, key and options on every bar.",
        );
    }
    resolvedOutputKey = definition.outputKey ?? definition.key;
  }

  frame.point.values[resolvedOutputKey] =
    value !== null && Number.isFinite(value) ? value : null;
  if (options.color !== undefined)
    frame.point.colors[resolvedOutputKey] = options.color;
  if (options.width !== undefined)
    frame.point.sizes[resolvedOutputKey] = options.width;
}

function normalizeShapeOptions(
  value: boolean | number | null,
  options: ShapeOptions,
): ShapeOptions {
  if (typeof value !== "boolean") return options;
  const resolvedShape =
    options.shape ??
    (options.direction === "down"
      ? "triangle-down"
      : options.direction === "up"
        ? "triangle-up"
        : "circle");
  const resolvedLocation =
    options.location ??
    (resolvedShape === "triangle-down" || resolvedShape === "label-down"
      ? "above-bar"
      : "below-bar");
  return { ...options, shape: resolvedShape, location: resolvedLocation };
}

function resolveShapeValue(
  frame: AuthoringFrame,
  value: boolean | number | null,
  options: ShapeOptions,
): number | null {
  if (typeof value !== "boolean") return value;
  if (!value) return null;
  if (options.location === "above-bar") return frame.candle.high;
  if (options.location === "below-bar") return frame.candle.low;
  return null;
}

function shapePlot(
  value: boolean | number | null,
  optionsOrText?: ShapeOptions | string,
  textOrCallsite?: string | unknown,
  hiddenCallsite?: unknown,
): void {
  let options: ShapeOptions;
  let callsite: unknown;
  if (typeof optionsOrText === "string") {
    if (typeof textOrCallsite === "string") {
      options = { shape: optionsOrText as ShapeKind, text: textOrCallsite };
      callsite = hiddenCallsite;
    } else {
      options = { text: optionsOrText };
      callsite = hiddenCallsite ?? textOrCallsite;
    }
  } else {
    options = optionsOrText ?? {};
    callsite = hiddenCallsite ?? textOrCallsite;
  }
  const normalized = normalizeShapeOptions(value, options);
  const frame = authoringFrame();
  valuePlot(
    "shape",
    "plot.shape",
    resolveShapeValue(frame, value, normalized),
    normalized,
    callsite,
  );
}

function assertDrawingTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative integer timestamp.`);
}

function assertDrawingNumber(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
}

function assertSegmentWidth(width: number): void {
  if (!Number.isFinite(width) || width <= 0 || width > 20)
    throw new RangeError(
      "Drawing width must be greater than 0 and at most 20.",
    );
}

function boxOverlay(id: string, value: BoxDrawing): IndicatorBox {
  assertDrawingTime("Drawing left", value.left);
  assertDrawingTime("Drawing right", value.right);
  assertDrawingNumber("Drawing top", value.top);
  assertDrawingNumber("Drawing bottom", value.bottom);
  return {
    id,
    kind: "box",
    startTimeMs: value.left,
    endTimeMs: value.right,
    top: value.top,
    bottom: value.bottom,
    color: value.color,
    ...(value.borderColor === undefined
      ? {}
      : { borderColor: value.borderColor }),
  };
}

function segmentOverlay(
  id: string,
  value: SegmentDrawing,
): IndicatorLineSegment {
  assertDrawingTime("Drawing left", value.left);
  assertDrawingTime("Drawing right", value.right);
  assertDrawingNumber("Drawing startValue", value.startValue);
  assertDrawingNumber("Drawing endValue", value.endValue);
  assertSegmentWidth(value.width);
  return {
    id,
    kind: "line-segment",
    startTimeMs: value.left,
    endTimeMs: value.right,
    startValue: value.startValue,
    endValue: value.endValue,
    color: value.color,
    width: value.width,
    style: value.style,
  };
}

function box(value: BoxDrawing, hiddenCallsite?: unknown): BoxHandle {
  const callsite = readCompilerCallsite(hiddenCallsite, "drawing", "plot.box");
  assertDrawingTime("Drawing left", value.left);
  assertDrawingTime("Drawing right", value.right);
  assertDrawingNumber("Drawing top", value.top);
  assertDrawingNumber("Drawing bottom", value.bottom);
  const controller = drawingController("box", "plot.box", callsite);
  controller.write(boxOverlay(controller.id, value));
  return Object.freeze({
    set(patch: Partial<BoxDrawing>): void {
      controller.update((current) => {
        if (current.kind !== "box")
          throw new Error("Drawing handle kind changed unexpectedly.");
        const borderColor = Object.hasOwn(patch, "borderColor")
          ? patch.borderColor
          : current.borderColor;
        const next: BoxDrawing = {
          left: patch.left ?? current.startTimeMs,
          right: patch.right ?? current.endTimeMs,
          top: patch.top ?? current.top,
          bottom: patch.bottom ?? current.bottom,
          color: patch.color ?? current.color,
          ...(borderColor === undefined ? {} : { borderColor }),
        };
        return boxOverlay(controller.id, next);
      });
    },
    delete(): void {
      controller.delete();
    },
  });
}

function segment(
  value: SegmentDrawing,
  hiddenCallsite?: unknown,
): SegmentHandle {
  const callsite = readCompilerCallsite(
    hiddenCallsite,
    "drawing",
    "plot.segment",
  );
  assertDrawingTime("Drawing left", value.left);
  assertDrawingTime("Drawing right", value.right);
  assertDrawingNumber("Drawing startValue", value.startValue);
  assertDrawingNumber("Drawing endValue", value.endValue);
  assertSegmentWidth(value.width);
  const controller = drawingController(
    "line-segment",
    "plot.segment",
    callsite,
  );
  controller.write(segmentOverlay(controller.id, value));
  return Object.freeze({
    set(patch: Partial<SegmentDrawing>): void {
      controller.update((current) => {
        if (current.kind !== "line-segment")
          throw new Error("Drawing handle kind changed unexpectedly.");
        return segmentOverlay(controller.id, {
          left: patch.left ?? current.startTimeMs,
          right: patch.right ?? current.endTimeMs,
          startValue: patch.startValue ?? current.startValue,
          endValue: patch.endValue ?? current.endValue,
          color: patch.color ?? current.color,
          width: patch.width ?? current.width,
          style: patch.style ?? current.style,
        });
      });
    },
    delete(): void {
      controller.delete();
    },
  });
}

export interface ShapePlot {
  (value: boolean | number | null, options?: ShapeOptions): void;
  (value: boolean | number | null, text: string): void;
  (value: boolean | number | null, shape: ShapeKind, text: string): void;
}

/** Values are scalars. Drawing persistence and identity are SDK-owned. */
export interface PlotApi {
  readonly line: (value: number | null, options?: PlotOptions) => void;
  readonly hline: (value: number | null, options?: PlotOptions) => void;
  readonly histogram: (value: number | null, options?: PlotOptions) => void;
  readonly shape: ShapePlot;
  readonly box: (value: BoxDrawing) => BoxHandle;
  readonly segment: (value: SegmentDrawing) => SegmentHandle;
}

export const plot: PlotApi = Object.freeze({
  line: (
    value: number | null,
    options?: PlotOptions,
    hiddenCallsite?: unknown,
  ): void => valuePlot("line", "plot.line", value, options, hiddenCallsite),
  hline: (
    value: number | null,
    options?: PlotOptions,
    hiddenCallsite?: unknown,
  ): void => valuePlot("hline", "plot.hline", value, options, hiddenCallsite),
  histogram: (
    value: number | null,
    options?: PlotOptions,
    hiddenCallsite?: unknown,
  ): void =>
    valuePlot("histogram", "plot.histogram", value, options, hiddenCallsite),
  shape: shapePlot,
  box,
  segment,
});
