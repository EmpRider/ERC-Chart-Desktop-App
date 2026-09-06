import type {
  Candle,
  IndicatorRuntimeSnapshot,
  IndicatorRuntimeSyncRequest,
  InstalledIndicatorDefinition,
  InstalledIndicatorInputDefinition,
  InstalledIndicatorSummary,
  WorkspaceIndicator,
} from "@erc-chart/contracts";
import type {
  Chart,
  IndicatorCreate,
  IndicatorFigure,
  KLineData,
} from "klinecharts";

export type PluginIndicatorSync = (
  request: IndicatorRuntimeSyncRequest,
) => Promise<IndicatorRuntimeSnapshot>;

export interface PluginIndicatorSettingsField {
  readonly key: string;
  readonly label: string;
  readonly group?: string;
  readonly description?: string;
  readonly effect?: "calculation" | "presentation";
  readonly type: "boolean" | "number" | "string";
  readonly defaultValue: boolean | number | string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly editor?: "text" | "color" | "timeframe";
}

type PluginIndicatorFigureData = Record<string, number | null | string>;

function colorFieldKey(outputKey: string): string {
  return `__erc_color_${outputKey}`;
}

function sizeFieldKey(outputKey: string): string {
  return `__erc_size_${outputKey}`;
}

interface RuntimeContext {
  indicator: WorkspaceIndicator;
  summary: InstalledIndicatorSummary;
  instrumentId: string;
  timeframeId: string;
  sync: PluginIndicatorSync;
  snapshot?: IndicatorRuntimeSnapshot;
}

const contexts = new Map<string, RuntimeContext>();
const registeredNames = new Set<string>();

function runtimeName(instanceId: string): string {
  return `ERC_PLUGIN_${instanceId.replace(/[^A-Za-z0-9_]/gu, "_")}`;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizedInputValue(
  input: InstalledIndicatorInputDefinition,
  value: unknown,
): boolean | number | string {
  if (input.type === "boolean") {
    return typeof value === "boolean" ? value : input.defaultValue;
  }
  if (input.type === "number") {
    const raw = finite(value) ? value : input.defaultValue;
    const bounded = Math.min(input.max ?? raw, Math.max(input.min ?? raw, raw));
    if (input.step === undefined) return bounded;
    const decimals = Math.max(0, `${input.step}`.split(".")[1]?.length ?? 0);
    return Number(bounded.toFixed(decimals));
  }
  if (typeof value !== "string") return input.defaultValue;
  if (
    input.options !== undefined &&
    !input.options.some((option) => option.value === value)
  ) {
    return input.defaultValue;
  }
  return value;
}

export function normalizePluginIndicatorParameters(
  indicator: WorkspaceIndicator,
  definition: InstalledIndicatorDefinition,
): Readonly<Record<string, boolean | number | string>> {
  return Object.freeze(
    Object.fromEntries(
      definition.inputs.map((input) => [
        input.key,
        normalizedInputValue(input, indicator.parameters[input.key]),
      ]),
    ),
  );
}

export function createPluginWorkspaceIndicator(
  summary: InstalledIndicatorSummary,
  instanceId: string,
): WorkspaceIndicator {
  return {
    instanceId,
    pluginId: summary.pluginId,
    definitionId: summary.definition.id,
    enabled: true,
    parameters: Object.fromEntries(
      summary.definition.inputs.map((input) => [input.key, input.defaultValue]),
    ),
    inputs: { source: { kind: "candles" } },
  };
}

export function pluginIndicatorSettingsFields(
  definition: InstalledIndicatorDefinition,
): readonly PluginIndicatorSettingsField[] {
  return definition.inputs.map((input) => ({ ...input }));
}

export function updatePluginIndicatorParameters(
  indicator: WorkspaceIndicator,
  definition: InstalledIndicatorDefinition,
  draft: Readonly<Record<string, string>>,
): WorkspaceIndicator | undefined {
  const parameters: Record<string, boolean | number | string> = {};
  for (const input of definition.inputs) {
    const raw = draft[input.key];
    if (input.type === "boolean") {
      parameters[input.key] =
        raw === undefined ? input.defaultValue : raw === "true";
      continue;
    }
    if (input.type === "number") {
      if (raw === undefined || raw.trim() === "") return undefined;
      const value = Number(raw);
      if (!Number.isFinite(value)) return undefined;
      if (input.min !== undefined && value < input.min) return undefined;
      if (input.max !== undefined && value > input.max) return undefined;
      parameters[input.key] = value;
      continue;
    }
    const value = raw ?? input.defaultValue;
    if (
      input.options !== undefined &&
      !input.options.some((option) => option.value === value)
    ) {
      return undefined;
    }
    parameters[input.key] = value;
  }
  return { ...indicator, parameters };
}

function toCandle(
  data: KLineData,
  instrumentId: string,
  timeframeId: string,
): Candle {
  return {
    instrumentId: instrumentId as Candle["instrumentId"],
    timeframeId: timeframeId as Candle["timeframeId"],
    openTimeMs: data.timestamp,
    open: data.open,
    high: data.high,
    low: data.low,
    close: data.close,
    ...(data.volume === undefined ? {} : { volume: data.volume }),
  };
}

function lineStyle(style: "solid" | "dashed" | "dotted" | undefined): {
  readonly style?: "solid" | "dashed";
  readonly dashedValue?: readonly number[];
} {
  if (style === "dashed") return { style: "dashed", dashedValue: [6, 4] };
  if (style === "dotted") return { style: "dashed", dashedValue: [2, 3] };
  return { style: "solid" };
}

function figuresForDefinition(
  definition: InstalledIndicatorDefinition,
): IndicatorFigure<PluginIndicatorFigureData>[] {
  return definition.plots.flatMap((plot) => {
    const key = plot.outputKey ?? plot.key;
    const common = {
      key,
      ...(plot.label === undefined ? {} : { title: `${plot.label}: ` }),
      styles: ({
        data,
      }: {
        readonly data: { readonly current: PluginIndicatorFigureData | null };
      }): Record<string, unknown> => {
        const dynamicColor = data.current?.[colorFieldKey(key)];
        const dynamicSize = data.current?.[sizeFieldKey(key)];
        return {
          ...(typeof dynamicColor === "string"
            ? { color: dynamicColor }
            : plot.color === undefined
              ? {}
              : { color: plot.color }),
          ...(typeof dynamicSize === "number"
            ? { size: dynamicSize }
            : plot.width === undefined
              ? {}
              : { size: plot.width }),
          ...(plot.kind === "line"
            ? { lineCap: "round", lineJoin: "round" }
            : {}),
          ...lineStyle(plot.style),
        };
      },
    };
    if (plot.kind === "shape" || plot.kind === "text") {
      return [
        {
          ...common,
          type: "text",
          attrs: (): Record<string, unknown> => ({
            text: plot.direction === "down" ? "▼" : "▲",
          }),
        },
      ];
    }
    if (plot.kind === "histogram") {
      return [{ ...common, type: "bar", baseValue: 0 }];
    }
    if (
      plot.kind === "line" ||
      plot.kind === "hline" ||
      plot.kind === "band" ||
      plot.kind === "fill"
    ) {
      return [{ ...common, type: "line" }];
    }
    return [];
  });
}

function drawRuntimeOverlays(
  name: string,
  ctx: CanvasRenderingContext2D,
  xAxis: { convertTimestampToPixel: (timestamp: number) => number },
  yAxis: { convertToPixel: (value: number) => number },
): void {
  const snapshot = contexts.get(name)?.snapshot;
  if (snapshot === undefined) return;
  for (const overlay of snapshot.overlays) {
    if (overlay.kind === "line-segment") {
      const startX = xAxis.convertTimestampToPixel(overlay.startTimeMs);
      const endX = xAxis.convertTimestampToPixel(overlay.endTimeMs);
      const startY = yAxis.convertToPixel(overlay.startValue);
      const endY = yAxis.convertToPixel(overlay.endValue);
      ctx.beginPath();
      ctx.strokeStyle = overlay.color;
      ctx.lineWidth = overlay.width;
      ctx.setLineDash(
        overlay.style === "dashed"
          ? [6, 4]
          : overlay.style === "dotted"
            ? [2, 3]
            : [],
      );
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      continue;
    }
    const startX = xAxis.convertTimestampToPixel(overlay.startTimeMs);
    const endX = xAxis.convertTimestampToPixel(overlay.endTimeMs);
    const topY = yAxis.convertToPixel(overlay.top);
    const bottomY = yAxis.convertToPixel(overlay.bottom);
    ctx.fillStyle = overlay.color;
    ctx.fillRect(
      Math.min(startX, endX),
      Math.min(topY, bottomY),
      Math.abs(endX - startX),
      Math.abs(bottomY - topY),
    );
    if (overlay.borderColor !== undefined) {
      ctx.strokeStyle = overlay.borderColor;
      ctx.strokeRect(
        Math.min(startX, endX),
        Math.min(topY, bottomY),
        Math.abs(endX - startX),
        Math.abs(bottomY - topY),
      );
    }
  }
  ctx.setLineDash([]);
}

export interface PluginIndicatorReconciliation {
  readonly managedRuntimeIds: ReadonlySet<string>;
  readonly ownerByRuntimeId: ReadonlyMap<string, string>;
  readonly removedInstanceIds: readonly string[];
}

export function reconcilePluginIndicators(
  module: typeof import("klinecharts"),
  chart: Chart,
  indicators: readonly WorkspaceIndicator[],
  installed: readonly InstalledIndicatorSummary[],
  sync: PluginIndicatorSync | undefined,
  instrumentId: string,
  timeframeId: string,
  previousManagedRuntimeIds: ReadonlySet<string> = new Set(),
): PluginIndicatorReconciliation {
  const summaries = new Map(
    installed.map((summary) => [
      `${summary.pluginId}\u0000${summary.definition.id}`,
      summary,
    ]),
  );
  const desired =
    sync === undefined
      ? []
      : indicators.flatMap((indicator) => {
          const summary = summaries.get(
            `${indicator.pluginId}\u0000${indicator.definitionId}`,
          );
          return summary === undefined ? [] : [{ indicator, summary }];
        });
  const desiredIds = new Set(
    desired.map(({ indicator }) => indicator.instanceId),
  );
  const removedInstanceIds: string[] = [];
  for (const runtimeId of previousManagedRuntimeIds) {
    if (desiredIds.has(runtimeId)) continue;
    chart.removeIndicator({ id: runtimeId });
    contexts.delete(runtimeName(runtimeId));
    removedInstanceIds.push(runtimeId);
  }

  const managedRuntimeIds = new Set<string>();
  const ownerByRuntimeId = new Map<string, string>();
  for (const { indicator, summary } of desired) {
    const name = runtimeName(indicator.instanceId);
    const previousSnapshot = contexts.get(name)?.snapshot;
    contexts.set(name, {
      indicator,
      summary,
      instrumentId,
      timeframeId,
      sync: sync as PluginIndicatorSync,
      ...(previousSnapshot === undefined ? {} : { snapshot: previousSnapshot }),
    });
    if (!registeredNames.has(name)) {
      module.registerIndicator<PluginIndicatorFigureData, string>({
        name,
        shortName: summary.definition.name,
        series: summary.definition.placement === "overlay" ? "price" : "normal",
        figures: figuresForDefinition(summary.definition),
        calc: async (dataList) => {
          const context = contexts.get(name);
          if (context === undefined) return dataList.map(() => ({}));
          const snapshot = await context.sync({
            instanceId: context.indicator.instanceId,
            pluginId: context.indicator.pluginId,
            definitionId: context.indicator.definitionId,
            instrumentId: context.instrumentId,
            timeframeId: context.timeframeId,
            parameters: normalizePluginIndicatorParameters(
              context.indicator,
              context.summary.definition,
            ),
            candles: dataList.map((data) =>
              toCandle(data, context.instrumentId, context.timeframeId),
            ),
          });
          context.snapshot = snapshot;
          const points = new Map(
            snapshot.points.map((point) => [
              point.openTimeMs,
              {
                ...point.values,
                ...Object.fromEntries(
                  Object.entries(point.colors ?? {}).map(([key, color]) => [
                    colorFieldKey(key),
                    color,
                  ]),
                ),
                ...Object.fromEntries(
                  Object.entries(point.sizes ?? {}).map(([key, size]) => [
                    sizeFieldKey(key),
                    size,
                  ]),
                ),
              },
            ]),
          );
          return dataList.map((data) => points.get(data.timestamp) ?? {});
        },
        draw: ({ ctx, xAxis, yAxis }): boolean => {
          drawRuntimeOverlays(name, ctx, xAxis, yAxis);
          return false;
        },
      });
      registeredNames.add(name);
    }
    const parameters = normalizePluginIndicatorParameters(
      indicator,
      summary.definition,
    );
    const create: IndicatorCreate = {
      id: indicator.instanceId,
      name,
      shortName: summary.definition.name,
      visible: indicator.enabled,
      calcParams: [JSON.stringify(parameters)],
      ...(summary.definition.placement === "overlay"
        ? { paneId: "candle_pane" }
        : {}),
    };
    const current = chart.getIndicators({ id: indicator.instanceId })[0];
    if (current === undefined) {
      chart.createIndicator(create, summary.definition.placement === "overlay");
    } else if (current.name !== name) {
      chart.removeIndicator({ id: indicator.instanceId });
      chart.createIndicator(create, summary.definition.placement === "overlay");
    } else {
      chart.overrideIndicator(create);
    }
    managedRuntimeIds.add(indicator.instanceId);
    ownerByRuntimeId.set(indicator.instanceId, indicator.instanceId);
  }

  return { managedRuntimeIds, ownerByRuntimeId, removedInstanceIds };
}
