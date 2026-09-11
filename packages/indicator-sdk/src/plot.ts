import { sameDrawing } from "./drawing-equality.js";
import { authoringFrame, useKernel } from "./authoring-context.js";
import { readCompilerCallsite } from "./internal/callsite.js";
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

interface PlotDeclarationMetadata {
  readonly keyExplicit: boolean;
  readonly titleExplicit: boolean;
}

let activeDrawingCollector: Map<string, IndicatorOverlay> | undefined;
let activeCommittedDrawings: Map<string, IndicatorOverlay> | undefined;
const plotDeclarationMetadata = new WeakMap<
  IndicatorPlotDefinition,
  PlotDeclarationMetadata
>();

type ValuePlotCallee =
  "plot.line" | "plot.hline" | "plot.histogram" | "plot.shape";

function valuePlot(
  kind: IndicatorPlotDefinition["kind"],
  callee: ValuePlotCallee,
  value: number | null,
  options: ShapeOptions = {},
  hiddenCallsite?: unknown,
): void {
  const frame = authoringFrame();
  const callsite = readCompilerCallsite(hiddenCallsite, "plot", callee);
  const index = frame.plotIndex++;
  if (index >= 128)
    throw new RangeError("An indicator may declare at most 128 plots.");
  const outputKey = options.key ?? `plot_${index}`;
  const key = callsite?.id ?? outputKey;
  if (
    options.width !== undefined &&
    (!Number.isFinite(options.width) ||
      options.width <= 0 ||
      options.width > 20)
  )
    throw new RangeError("Plot width must be greater than 0 and at most 20.");
  let resolvedOutputKey = outputKey;
  if (frame.discovery) {
    if (
      frame.plots.some((plot) => {
        const existingOutputKey = plot.outputKey ?? plot.key;
        return (
          plot.key === key ||
          plot.key === outputKey ||
          existingOutputKey === key ||
          existingOutputKey === outputKey
        );
      })
    )
      throw new Error("Plot keys must be unique.");
    const definition: IndicatorPlotDefinition = {
      key,
      outputKey,
      kind,
      label: options.title ?? `Plot ${index + 1}`,
      ...(options.color === undefined ? {} : { color: options.color }),
      ...(options.width === undefined ? {} : { width: options.width }),
      ...(options.style === undefined ? {} : { style: options.style }),
      ...(options.direction === undefined
        ? {}
        : { direction: options.direction }),
    };
    frame.plots.push(definition);
    plotDeclarationMetadata.set(definition, {
      keyExplicit: options.key !== undefined,
      titleExplicit: options.title !== undefined,
    });
  } else {
    const definition =
      callsite === undefined
        ? frame.plots[index]
        : frame.plots.find((plot) => plot.key === callsite.id);
    if (definition === undefined)
      throw new Error(
        "Plot declarations must preserve their identity, kind, key and options on every bar.",
      );

    const metadata = plotDeclarationMetadata.get(definition);
    const keyExplicit = options.key !== undefined;
    const titleExplicit = options.title !== undefined;
    const preservesKey =
      metadata === undefined
        ? !keyExplicit || definition.outputKey === options.key
        : metadata.keyExplicit === keyExplicit &&
          (!metadata.keyExplicit || definition.outputKey === options.key);
    const preservesTitle =
      metadata === undefined
        ? !titleExplicit || definition.label === options.title
        : metadata.titleExplicit === titleExplicit &&
          (!metadata.titleExplicit || definition.label === options.title);
    if (
      definition.kind !== kind ||
      !preservesKey ||
      !preservesTitle ||
      definition.style !== options.style ||
      definition.direction !== options.direction
    )
      throw new Error(
        "Plot declarations must preserve their identity, kind, key and options on every bar.",
      );
    resolvedOutputKey = definition.outputKey ?? definition.key;
  }
  frame.point.values[resolvedOutputKey] =
    value !== null && Number.isFinite(value) ? value : null;
  if (options.color !== undefined)
    frame.point.colors[resolvedOutputKey] = options.color;
  if (options.width !== undefined)
    frame.point.sizes[resolvedOutputKey] = options.width;
}

function overlay(value: IndicatorBox | IndicatorLineSegment): void {
  const frame = authoringFrame();
  if (frame.discovery) return;
  if (!value.id || value.id.length > 256)
    throw new RangeError("Drawings require a bounded stable id.");
  if (activeDrawingCollector !== undefined) {
    const previous = activeCommittedDrawings?.get(value.id);
    activeDrawingCollector.set(
      value.id,
      previous !== undefined && sameDrawing(previous, value)
        ? previous
        : Object.freeze(value),
    );
    if (activeDrawingCollector.size > 2_000)
      throw new RangeError(
        "At most 2,000 drawings are allowed in one drawing scope.",
      );
    return;
  }
  // Same-id drawings replace earlier geometry; oldest drawings are retained within a fixed cap.
  frame.overlayUpdates.set(value.id, Object.freeze(value));
  if (frame.overlayUpdates.size > 2_000)
    throw new RangeError("At most 2,000 drawing changes are allowed per bar.");
}

function drawingScope(
  key: string,
  render: (() => void) | null,
  hiddenCallsite?: unknown,
): void {
  if (!key || key.length > 128)
    throw new RangeError("Drawing scopes require a bounded stable key.");
  const frame = authoringFrame();
  const callsite = readCompilerCallsite(
    hiddenCallsite,
    "drawing",
    "plot.drawings",
  );
  const state = useKernel<DrawingScopeState>(
    `plot-drawings:${key}`,
    () => ({
      committed: new Map<string, IndicatorOverlay>(),
    }),
    callsite,
  );
  if (frame.discovery || render === null) return;
  if (activeDrawingCollector !== undefined)
    throw new Error("Drawing scopes cannot be nested.");

  const next = new Map<string, IndicatorOverlay>();
  activeDrawingCollector = next;
  activeCommittedDrawings = state.committed;
  try {
    render();
  } finally {
    activeDrawingCollector = undefined;
    activeCommittedDrawings = undefined;
  }

  for (const [id, drawing] of next) {
    const previous = state.committed.get(id);
    if (previous !== drawing) frame.overlayUpdates.set(id, drawing);
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
  shape: (
    value: number | null,
    options?: ShapeOptions,
    hiddenCallsite?: unknown,
  ): void => valuePlot("shape", "plot.shape", value, options, hiddenCallsite),
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
