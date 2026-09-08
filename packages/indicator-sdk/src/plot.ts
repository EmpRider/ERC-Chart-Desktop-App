import { authoringFrame } from "./authoring-context.js";
import type {
  IndicatorBox,
  IndicatorLineSegment,
  IndicatorPlotDefinition,
} from "./index.js";

export interface PlotOptions {
  readonly title?: string;
  readonly color?: string;
  readonly width?: number;
  readonly style?: "solid" | "dashed" | "dotted";
}
export interface ShapeOptions extends PlotOptions {
  readonly direction?: "up" | "down";
}

function valuePlot(
  kind: IndicatorPlotDefinition["kind"],
  value: number | null,
  options: ShapeOptions = {},
): void {
  const frame = authoringFrame();
  const index = frame.plotIndex++;
  if (index >= 128)
    throw new RangeError("An indicator may declare at most 128 plots.");
  const key = `plot_${index}`;
  if (
    options.width !== undefined &&
    (!Number.isFinite(options.width) ||
      options.width <= 0 ||
      options.width > 20)
  )
    throw new RangeError("Plot width must be greater than 0 and at most 20.");
  if (frame.discovery) {
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
      definition?.kind !== kind ||
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
  // Same-id drawings replace earlier geometry; oldest drawings are retained within a fixed cap.
  frame.overlayUpdates.set(value.id, Object.freeze({ ...value }));
  if (frame.overlayUpdates.size > 1_000)
    throw new RangeError("At most 1,000 drawing changes are allowed per bar.");
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
    frame.overlayUpdates.set(id, null);
    if (frame.overlayUpdates.size > 1_000)
      throw new RangeError(
        "At most 1,000 drawing changes are allowed per bar.",
      );
  },
});
