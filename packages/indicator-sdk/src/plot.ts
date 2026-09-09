import { authoringFrame, useKernel } from "./authoring-context.js";
import type {
  IndicatorBox,
  IndicatorLineSegment,
  IndicatorOverlay,
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
}

interface DrawingScopeState {
  committed: Map<string, IndicatorOverlay>;
}

let activeDrawingCollector: Map<string, IndicatorOverlay> | undefined;

function valuePlot(
  kind: IndicatorPlotDefinition["kind"],
  value: number | null,
  options: ShapeOptions = {},
): void {
  const frame = authoringFrame();
  const index = frame.plotIndex++;
  if (index >= 128)
    throw new RangeError("An indicator may declare at most 128 plots.");
  const key = options.key ?? `plot_${index}`;
  if (
    options.width !== undefined &&
    (!Number.isFinite(options.width) ||
      options.width <= 0 ||
      options.width > 20)
  )
    throw new RangeError("Plot width must be greater than 0 and at most 20.");
  if (frame.discovery) {
    if (
      frame.plots.some(
        (plot) => plot.key === key || (plot.outputKey ?? plot.key) === key,
      )
    )
      throw new Error("Plot keys must be unique.");
    frame.plots.push({
      key,
      outputKey: key,
      kind,
      label: options.title ?? `Plot ${index + 1}`,
      ...(options.color === undefined ? {} : { color: options.color }),
      ...(options.width === undefined ? {} : { width: options.width }),
      ...(options.style === undefined ? {} : { style: options.style }),
      ...(options.direction === undefined
        ? {}
        : { direction: options.direction }),
    });
  } else {
    const definition = frame.plots[index];
    if (
      definition?.key !== key ||
      definition.kind !== kind ||
      definition.label !== (options.title ?? `Plot ${index + 1}`) ||
      definition.style !== options.style ||
      definition.direction !== options.direction
    )
      throw new Error(
        "Plot declarations must remain in the same order on every bar; use null to hide a value.",
      );
  }
  frame.point.values[key] =
    value !== null && Number.isFinite(value) ? value : null;
  if (options.color !== undefined) frame.point.colors[key] = options.color;
  if (options.width !== undefined) frame.point.sizes[key] = options.width;
}

function overlay(value: IndicatorBox | IndicatorLineSegment): void {
  const frame = authoringFrame();
  if (frame.discovery) return;
  if (!value.id || value.id.length > 256)
    throw new RangeError("Drawings require a bounded stable id.");
  const frozen = Object.freeze({ ...value });
  if (activeDrawingCollector !== undefined) {
    activeDrawingCollector.set(value.id, frozen);
    if (activeDrawingCollector.size > 2_000)
      throw new RangeError(
        "At most 2,000 drawings are allowed in one drawing scope.",
      );
    return;
  }
  // Same-id drawings replace earlier geometry; oldest drawings are retained within a fixed cap.
  frame.overlayUpdates.set(value.id, frozen);
  if (frame.overlayUpdates.size > 2_000)
    throw new RangeError("At most 2,000 drawing changes are allowed per bar.");
}

function sameDrawing(left: IndicatorOverlay, right: IndicatorOverlay): boolean {
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

function drawingScope(key: string, render: (() => void) | null): void {
  if (!key || key.length > 128)
    throw new RangeError("Drawing scopes require a bounded stable key.");
  const frame = authoringFrame();
  const state = useKernel<DrawingScopeState>(`plot-drawings:${key}`, () => ({
    committed: new Map<string, IndicatorOverlay>(),
  }));
  if (frame.discovery || render === null) return;
  if (activeDrawingCollector !== undefined)
    throw new Error("Drawing scopes cannot be nested.");

  const next = new Map<string, IndicatorOverlay>();
  activeDrawingCollector = next;
  try {
    render();
  } finally {
    activeDrawingCollector = undefined;
  }

  for (const [id, drawing] of next) {
    const previous = state.committed.get(id);
    if (previous === undefined || !sameDrawing(previous, drawing))
      frame.overlayUpdates.set(id, drawing);
  }
  for (const id of state.committed.keys()) {
    if (!next.has(id)) frame.overlayUpdates.set(id, null);
  }
  if (frame.overlayUpdates.size > 2_000)
    throw new RangeError("At most 2,000 drawing changes are allowed per bar.");
  if (frame.phase === "finalized") state.committed = next;
}

/** Values are scalars. The SDK owns plot definitions and timestamp-aligned output arrays. */
export interface PlotApi {
  readonly line: (value: number | null, options?: PlotOptions) => void;
  readonly hline: (value: number | null, options?: PlotOptions) => void;
  readonly histogram: (value: number | null, options?: PlotOptions) => void;
  readonly shape: (value: number | null, options?: ShapeOptions) => void;
  readonly box: (value: Omit<IndicatorBox, "kind">) => void;
  readonly segment: (value: Omit<IndicatorLineSegment, "kind">) => void;
  readonly remove: (id: string) => void;
  readonly drawings: (key: string, render: (() => void) | null) => void;
}
export const plot: PlotApi = Object.freeze({
  line: (value: number | null, options?: PlotOptions): void =>
    valuePlot("line", value, options),
  hline: (value: number | null, options?: PlotOptions): void =>
    valuePlot("hline", value, options),
  histogram: (value: number | null, options?: PlotOptions): void =>
    valuePlot("histogram", value, options),
  shape: (value: number | null, options?: ShapeOptions): void =>
    valuePlot("shape", value, options),
  box: (value: Omit<IndicatorBox, "kind">): void =>
    overlay({ ...value, kind: "box" }),
  segment: (value: Omit<IndicatorLineSegment, "kind">): void =>
    overlay({ ...value, kind: "line-segment" }),
  remove: (id: string): void => {
    const frame = authoringFrame();
    if (!id || id.length > 256)
      throw new RangeError("Drawings require a bounded stable id.");
    if (activeDrawingCollector !== undefined) {
      activeDrawingCollector.delete(id);
      return;
    }
    frame.overlayUpdates.set(id, null);
    if (frame.overlayUpdates.size > 2_000)
      throw new RangeError(
        "At most 2,000 drawing changes are allowed per bar.",
      );
  },
  drawings: drawingScope,
});
