import type {
  Candle,
  IndicatorRuntimeOverlay,
  IndicatorRuntimePoint,
  IndicatorRuntimeSignal,
  IndicatorRuntimeSnapshot,
  InstalledIndicatorDefinition,
  InstalledIndicatorInputDefinition,
  InstalledIndicatorSummary,
  ProviderSeriesChange,
  WorkspaceIndicator,
} from "@erc-chart/contracts";
import type { IndicatorWorkerResultUpdate } from "@erc-chart/indicator-runtime";
import type {
  Chart,
  IndicatorCreate,
  IndicatorFigure,
  KLineData,
} from "klinecharts";
import type { BrowserIndicatorSyncRequest } from "./indicator-worker-runtime.js";

export type PluginIndicatorSync = (
  request: BrowserIndicatorSyncRequest,
) => Promise<IndicatorWorkerResultUpdate>;

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
  providerProfileId: string;
  instrumentId: string;
  timeframeId: string;
  sync: PluginIndicatorSync;
  rows?: PluginIndicatorFigureData[];
  overlays: readonly IndicatorRuntimeOverlay[];
  signals: readonly IndicatorRuntimeSignal[];
  pendingSeriesChange?: ProviderSeriesChange;
  calculationSequence: number;
  latestCalculation?: Promise<PluginIndicatorFigureData[]>;
  dataGeneration: number;
  dataRevision: number;
  configGeneration: number;
  lastCandleCount?: number;
  lastBuilding: Candle | undefined;
}

const contexts = new Map<string, RuntimeContext>();
const registeredNames = new Set<string>();
const chartScopes = new WeakMap<object, string>();
let nextChartScope = 1;

function runtimeIdFor(chart: Chart, instanceId: string): string {
  let scope = chartScopes.get(chart);
  if (scope === undefined) {
    scope = `chart${nextChartScope}`;
    nextChartScope += 1;
    chartScopes.set(chart, scope);
  }
  return `erc.runtime.${scope}:${instanceId}`;
}

function sameCandleIdentity(left: Candle, right: Candle): boolean {
  return (
    left.instrumentId === right.instrumentId &&
    left.timeframeId === right.timeframeId &&
    left.openTimeMs === right.openTimeMs
  );
}

function sameCandle(left: Candle, right: Candle): boolean {
  return (
    sameCandleIdentity(left, right) &&
    left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.close === right.close &&
    left.volume === right.volume
  );
}

function fullSnapshotData(
  dataList: readonly KLineData[],
  context: RuntimeContext,
  kind: "snapshot" | "rebuild",
) {
  const candles = dataList.map((data) =>
    toCandle(data, context.instrumentId, context.timeframeId),
  );
  context.lastCandleCount = candles.length;
  context.lastBuilding = candles.at(-1);
  return { kind, candles } as const;
}

function incrementalDataUpdate(
  dataList: readonly KLineData[],
  context: RuntimeContext,
) {
  if (context.pendingSeriesChange?.kind === "rebuild") {
    return fullSnapshotData(dataList, context, "rebuild");
  }
  const previousCount = context.lastCandleCount;
  const previousBuilding = context.lastBuilding;
  if (previousCount === undefined)
    return fullSnapshotData(dataList, context, "snapshot");
  if (dataList.length === 0 && previousCount === 0) return undefined;
  if (dataList.length === previousCount && previousCount > 0) {
    const currentData = dataList.at(-1);
    if (currentData === undefined || previousBuilding === undefined)
      return fullSnapshotData(dataList, context, "rebuild");
    const current = toCandle(
      currentData,
      context.instrumentId,
      context.timeframeId,
    );
    if (!sameCandleIdentity(previousBuilding, current))
      return fullSnapshotData(dataList, context, "rebuild");
    if (sameCandle(previousBuilding, current)) return undefined;
    context.lastBuilding = current;
    return { kind: "building", candle: current } as const;
  }
  if (dataList.length === previousCount + 1 && previousCount > 0) {
    const finalizedData = dataList[previousCount - 1];
    const buildingData = dataList[previousCount];
    if (
      finalizedData === undefined ||
      buildingData === undefined ||
      previousBuilding === undefined
    ) {
      return fullSnapshotData(dataList, context, "rebuild");
    }
    const finalized = toCandle(
      finalizedData,
      context.instrumentId,
      context.timeframeId,
    );
    const building = toCandle(
      buildingData,
      context.instrumentId,
      context.timeframeId,
    );
    if (
      !sameCandleIdentity(previousBuilding, finalized) ||
      building.openTimeMs <= finalized.openTimeMs
    ) {
      return fullSnapshotData(dataList, context, "rebuild");
    }
    context.lastCandleCount = dataList.length;
    context.lastBuilding = building;
    return { kind: "rollover", finalized, building } as const;
  }
  return fullSnapshotData(dataList, context, "rebuild");
}

function calculationKey(
  indicator: WorkspaceIndicator,
  summary: InstalledIndicatorSummary,
  providerProfileId: string,
  instrumentId: string,
  timeframeId: string,
): string {
  return JSON.stringify({
    pluginId: indicator.pluginId,
    definitionId: indicator.definitionId,
    runtimeEntryUrl: summary.runtimeEntryUrl,
    providerProfileId,
    instrumentId,
    timeframeId,
    parameters: normalizePluginIndicatorParameters(
      indicator,
      summary.definition,
    ),
  });
}

function registrationName(summary: InstalledIndicatorSummary): string {
  return [
    "ERC_PLUGIN",
    summary.pluginId,
    summary.version,
    summary.definition.id,
  ]
    .map((part) => encodeURIComponent(part))
    .join("__");
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
  instanceId: string,
  ctx: CanvasRenderingContext2D,
  xAxis: { convertTimestampToPixel: (timestamp: number) => number },
  yAxis: { convertToPixel: (value: number) => number },
): void {
  const overlays = contexts.get(instanceId)?.overlays;
  if (overlays === undefined) return;
  for (const overlay of overlays) {
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

function rowForPoint(point: IndicatorRuntimePoint): PluginIndicatorFigureData {
  return {
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
  };
}

function rowsForSnapshot(
  dataList: readonly KLineData[],
  snapshot: IndicatorRuntimeSnapshot,
): PluginIndicatorFigureData[] {
  const points = new Map(
    snapshot.points.map((point) => [point.openTimeMs, rowForPoint(point)]),
  );
  return dataList.map((data) => points.get(data.timestamp) ?? {});
}

function applyWorkerResult(
  dataList: readonly KLineData[],
  context: RuntimeContext,
  result: IndicatorWorkerResultUpdate,
): PluginIndicatorFigureData[] {
  if (result.kind === "snapshot") {
    context.rows = rowsForSnapshot(dataList, result.snapshot);
    context.overlays = result.snapshot.overlays;
    context.signals = result.snapshot.signals;
    return context.rows;
  }
  const rows = context.rows;
  const expectedPointCount = result.kind === "building" ? 1 : 2;
  if (
    rows === undefined ||
    result.points.length !== expectedPointCount ||
    (result.kind === "building" && rows.length !== dataList.length) ||
    (result.kind === "rollover" && rows.length + 1 !== dataList.length)
  ) {
    throw new Error(
      "Indicator worker result delta does not match renderer state.",
    );
  }
  const startIndex = dataList.length - expectedPointCount;
  for (let offset = 0; offset < expectedPointCount; offset += 1) {
    const data = dataList[startIndex + offset];
    const point = result.points[offset];
    if (
      data === undefined ||
      point === undefined ||
      data.timestamp !== point.openTimeMs
    ) {
      throw new Error(
        "Indicator worker result delta does not match candle timestamps.",
      );
    }
    rows[startIndex + offset] = rowForPoint(point);
  }
  context.overlays = result.overlays;
  context.signals = result.signals;
  return rows;
}

export interface PluginIndicatorReconciliation {
  readonly managedRuntimeIds: ReadonlySet<string>;
  readonly ownerByRuntimeId: ReadonlyMap<string, string>;
  readonly removedInstanceIds: readonly string[];
}

export function disposePluginIndicatorContexts(
  instanceIds: Iterable<string>,
): void {
  for (const instanceId of instanceIds) contexts.delete(instanceId);
}

export function markPluginIndicatorSeriesChange(
  chart: Chart,
  change: ProviderSeriesChange,
): void {
  const scope = chartScopes.get(chart);
  if (scope === undefined) return;
  const prefix = `erc.runtime.${scope}:`;
  for (const [runtimeId, context] of contexts) {
    if (runtimeId.startsWith(prefix)) context.pendingSeriesChange = change;
  }
}

export function clearPluginIndicatorSeriesChange(
  chart: Chart,
  revision: number,
): void {
  const scope = chartScopes.get(chart);
  if (scope === undefined) return;
  const prefix = `erc.runtime.${scope}:`;
  for (const [runtimeId, context] of contexts) {
    if (
      runtimeId.startsWith(prefix) &&
      context.pendingSeriesChange?.revision === revision
    ) {
      delete context.pendingSeriesChange;
    }
  }
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
  providerProfileId = "",
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
          return summary === undefined
            ? []
            : [
                {
                  indicator,
                  summary,
                  runtimeId: runtimeIdFor(chart, indicator.instanceId),
                },
              ];
        });
  const desiredIds = new Set(desired.map(({ runtimeId }) => runtimeId));
  const removedInstanceIds: string[] = [];
  for (const runtimeId of previousManagedRuntimeIds) {
    if (desiredIds.has(runtimeId)) continue;
    chart.removeIndicator({ id: runtimeId });
    contexts.delete(runtimeId);
    removedInstanceIds.push(runtimeId);
  }

  const managedRuntimeIds = new Set<string>();
  const ownerByRuntimeId = new Map<string, string>();
  for (const { indicator, summary, runtimeId } of desired) {
    const name = registrationName(summary);
    const previousContext = contexts.get(runtimeId);
    const nextCalculationKey = calculationKey(
      indicator,
      summary,
      providerProfileId,
      instrumentId,
      timeframeId,
    );
    const previousCalculationKey =
      previousContext === undefined
        ? undefined
        : calculationKey(
            previousContext.indicator,
            previousContext.summary,
            previousContext.providerProfileId,
            previousContext.instrumentId,
            previousContext.timeframeId,
          );
    const sameConfiguration = previousCalculationKey === nextCalculationKey;
    contexts.set(runtimeId, {
      indicator,
      summary,
      providerProfileId,
      instrumentId,
      timeframeId,
      sync: sync as PluginIndicatorSync,
      overlays:
        sameConfiguration && previousContext !== undefined
          ? previousContext.overlays
          : [],
      signals:
        sameConfiguration && previousContext !== undefined
          ? previousContext.signals
          : [],
      calculationSequence: (previousContext?.calculationSequence ?? 0) + 1,
      dataGeneration:
        sameConfiguration && previousContext !== undefined
          ? previousContext.dataGeneration
          : 0,
      dataRevision:
        sameConfiguration && previousContext !== undefined
          ? previousContext.dataRevision
          : 0,
      configGeneration:
        sameConfiguration && previousContext !== undefined
          ? previousContext.configGeneration
          : (previousContext?.configGeneration ?? 0) + 1,
      ...(sameConfiguration && previousContext?.lastCandleCount !== undefined
        ? { lastCandleCount: previousContext.lastCandleCount }
        : {}),
      lastBuilding: sameConfiguration
        ? previousContext?.lastBuilding
        : undefined,
      ...(sameConfiguration && previousContext?.rows !== undefined
        ? { rows: previousContext.rows }
        : {}),
      ...(sameConfiguration &&
      previousContext?.pendingSeriesChange !== undefined
        ? { pendingSeriesChange: previousContext.pendingSeriesChange }
        : {}),
    });
    if (!registeredNames.has(name)) {
      module.registerIndicator<PluginIndicatorFigureData, string>({
        name,
        shortName: summary.definition.name,
        series: summary.definition.placement === "overlay" ? "price" : "normal",
        figures: figuresForDefinition(summary.definition),
        calc: async (dataList, runtimeIndicator) => {
          const context = contexts.get(runtimeIndicator.id);
          if (context === undefined) return dataList.map(() => ({}));
          const sequence = context.calculationSequence + 1;
          context.calculationSequence = sequence;
          const data = incrementalDataUpdate(dataList, context);
          if (data === undefined) {
            return context.rows ?? dataList.map(() => ({}));
          }
          const sourceChange = context.pendingSeriesChange;
          if (
            sourceChange !== undefined &&
            (sourceChange.generation < context.dataGeneration ||
              (sourceChange.generation === context.dataGeneration &&
                sourceChange.revision < context.dataRevision))
          ) {
            if (context.pendingSeriesChange === sourceChange) {
              delete context.pendingSeriesChange;
            }
            return context.rows ?? dataList.map(() => ({}));
          }
          if (sourceChange !== undefined) {
            context.dataGeneration = sourceChange.generation;
            if (context.pendingSeriesChange === sourceChange) {
              delete context.pendingSeriesChange;
            }
          }
          context.dataRevision =
            sourceChange?.revision ?? context.dataRevision + 1;
          const calculation = context
            .sync({
              instanceId: runtimeIndicator.id,
              runtimeEntryUrl: context.summary.runtimeEntryUrl,
              pluginId: context.indicator.pluginId,
              definitionId: context.indicator.definitionId,
              instrumentId: context.instrumentId,
              timeframeId: context.timeframeId,
              parameters: normalizePluginIndicatorParameters(
                context.indicator,
                context.summary.definition,
              ),
              data,
              rebuildCandles: () =>
                dataList.map((item) =>
                  toCandle(item, context.instrumentId, context.timeframeId),
                ),
              dataRevision: context.dataRevision,
              configGeneration: context.configGeneration,
            })
            .then((result) => {
              const current = contexts.get(runtimeIndicator.id);
              if (
                current !== context ||
                context.calculationSequence !== sequence
              ) {
                if (current?.latestCalculation !== undefined)
                  return current.latestCalculation;
                return current?.rows ?? dataList.map(() => ({}));
              }
              return applyWorkerResult(dataList, context, result);
            });
          context.latestCalculation = calculation;
          return calculation;
        },
        draw: ({ ctx, indicator: runtimeIndicator, xAxis, yAxis }): boolean => {
          drawRuntimeOverlays(runtimeIndicator.id, ctx, xAxis, yAxis);
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
      id: runtimeId,
      name,
      shortName: summary.definition.name,
      visible: indicator.enabled,
      calcParams: [JSON.stringify(parameters)],
      ...(summary.definition.placement === "overlay"
        ? { paneId: "candle_pane" }
        : {}),
    };
    const current = chart.getIndicators({ id: runtimeId })[0];
    if (current === undefined) {
      chart.createIndicator(create, summary.definition.placement === "overlay");
    } else if (current.name !== name) {
      chart.removeIndicator({ id: runtimeId });
      chart.createIndicator(create, summary.definition.placement === "overlay");
    } else {
      chart.overrideIndicator(create);
    }
    managedRuntimeIds.add(runtimeId);
    ownerByRuntimeId.set(runtimeId, indicator.instanceId);
  }

  return { managedRuntimeIds, ownerByRuntimeId, removedInstanceIds };
}
