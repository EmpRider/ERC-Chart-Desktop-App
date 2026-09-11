import { sameDrawing } from "./drawing-equality.js";
import {
  authoringFrame,
  useKernel,
  type AuthoringFrame,
} from "./authoring-context.js";
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

type ValuePlotCallee =
  "plot.line" | "plot.hline" | "plot.histogram" | "plot.shape";

interface CompilerPlotDeclaration {
  readonly id: string;
  readonly callee: ValuePlotCallee;
  readonly kind: IndicatorPlotDefinition["kind"];
  readonly outputKey: string;
  readonly label: string;
  readonly keyExplicit: boolean;
  readonly titleExplicit: boolean;
  readonly color?: string;
  readonly width?: number;
  readonly style?: "solid" | "dashed" | "dotted";
  readonly direction?: "up" | "down";
}

declare const __ERC_INDICATOR_PLOT_DECLARATIONS__:
  readonly CompilerPlotDeclaration[] | undefined;

interface DrawingScopeState {
  committed: Map<string, IndicatorOverlay>;
}

interface PlotDeclarationMetadata {
  readonly keyExplicit: boolean;
  readonly titleExplicit: boolean;
}

interface FramePlotUsage {
  positionalIndex: number;
  readonly identities: Set<string>;
}

let activeDrawingCollector: Map<string, IndicatorOverlay> | undefined;
let activeCommittedDrawings: Map<string, IndicatorOverlay> | undefined;
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
    definition.direction === options.direction
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
    ...(options.direction === undefined
      ? {}
      : { direction: options.direction }),
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
    if (frame.plotIndex + usage.identities.size >= 128)
      throw new RangeError("An indicator may declare at most 128 plots.");
    index = usage.positionalIndex++;
    frame.plotIndex += 1;
  }

  if (
    options.width !== undefined &&
    (!Number.isFinite(options.width) ||
      options.width <= 0 ||
      options.width > 20)
  )
    throw new RangeError("Plot width must be greater than 0 and at most 20.");

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
      ...(options.direction === undefined
        ? {}
        : { direction: options.direction }),
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
