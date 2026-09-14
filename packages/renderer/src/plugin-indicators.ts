import type {
  Candle,
  IndicatorRuntimeOverlay,
  IndicatorRuntimePoint,
  IndicatorRuntimeSignal,
  IndicatorRuntimeSnapshot,
  InstalledIndicatorDefinition,
  InstalledIndicatorSummary,
  ProviderSeriesChange,
  WorkspaceIndicator,
} from "@erc-chart/contracts";
import {
  IndicatorDependencyGraphError,
  createIndicatorDependencyPlan,
  normalizeIndicatorParameters,
  type IndicatorWorkerDependencySnapshot,
  type IndicatorWorkerResultUpdate,
} from "@erc-chart/indicator-runtime";
import type {
  Chart,
  IndicatorCreate,
  IndicatorFigure,
  KLineData,
} from "klinecharts";
import type {
  BrowserIndicatorDataUpdate,
  BrowserIndicatorSyncRequest,
} from "./indicator-worker-runtime.js";
import {
  indicatorShapeBaseline,
  indicatorShapeText,
  indicatorShapeTextSize,
} from "./indicator-shape-style.js";

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
  readonly editor?: "text" | "color" | "timeframe" | "candle-type";
}

export interface PluginIndicatorSourcePlan {
  readonly requestedTimeframeId: string;
  readonly activeTimeframeId: string;
  readonly usedFallback: boolean;
  readonly candleType: "standard" | "heikin-ashi";
  readonly taTimeframeIds: readonly string[];
  readonly taSources: readonly {
    readonly requestedTimeframeId: string;
    readonly activeTimeframeId: string;
    readonly usedFallback: boolean;
  }[];
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
  chartTimeframeId: string;
  timeframeId: string;
  candleType: "standard" | "heikin-ashi";
  sourceTimeframeIds: readonly string[];
  sourceTimeframes: readonly {
    readonly requestedTimeframeId: string;
    readonly activeTimeframeId: string;
  }[];
  dependencyBindings: readonly {
    readonly inputKey: string;
    readonly instanceId: string;
    readonly runtimeId: string;
    readonly outputKey: string;
  }[];
  sourceKey: string;
  calculationKey: string;
  sync: PluginIndicatorSync;
  rows?: PluginIndicatorFigureData[];
  publishedPoints?: Map<number, IndicatorRuntimePoint>;
  dependencyVersion?: string;
  configurationRebuildPending?: boolean;
  overlays: readonly IndicatorRuntimeOverlay[];
  signals: readonly IndicatorRuntimeSignal[];
  pendingSeriesChange?: ProviderSeriesChange;
  calculationSequence: number;
  latestCalculation?: Promise<PluginIndicatorFigureData[]>;
  queuedDataList?: readonly KLineData[];
  calculationRunning?: boolean;
  dataGeneration: number;
  dataRevision: number;
  configGeneration: number;
  outputRevision: number;
  lastCandleCount?: number;
  lastBuilding: Candle | undefined;
}

const contexts = new Map<string, RuntimeContext>();
const rowStartTimes = new WeakMap<PluginIndicatorFigureData[], number>();
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
    toCandle(data, context.instrumentId, context.chartTimeframeId),
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
      context.chartTimeframeId,
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
      context.chartTimeframeId,
    );
    const building = toCandle(
      buildingData,
      context.instrumentId,
      context.chartTimeframeId,
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
  sourceTimeframes: readonly {
    readonly requestedTimeframeId: string;
    readonly activeTimeframeId: string;
  }[] = [],
  chartTimeframeId = timeframeId,
): string {
  return JSON.stringify({
    pluginId: indicator.pluginId,
    definitionId: indicator.definitionId,
    runtimeEntryUrl: summary.runtimeEntryUrl,
    providerProfileId,
    instrumentId,
    timeframeId,
    chartTimeframeId,
    sourceTimeframes,
    dependencyBindings: indicatorOutputBindings(indicator),
    parameters: normalizePluginIndicatorParameters(
      indicator,
      summary.definition,
    ),
  });
}

function sourceKey(
  providerProfileId: string,
  instrumentId: string,
  chartTimeframeId: string,
  sourcePlan: PluginIndicatorSourcePlan,
): string {
  return JSON.stringify({
    providerProfileId,
    instrumentId,
    chartTimeframeId,
    timeframeId: sourcePlan.activeTimeframeId,
    candleType: sourcePlan.candleType,
    sourceTimeframes: sourcePlan.taSources,
  });
}

function indicatorOutputBindings(indicator: WorkspaceIndicator): readonly {
  readonly inputKey: string;
  readonly instanceId: string;
  readonly outputKey: string;
}[] {
  return Object.entries(indicator.inputs)
    .flatMap(([inputKey, input]) =>
      input.kind === "indicator-output"
        ? [
            {
              inputKey,
              instanceId: input.instanceId,
              outputKey: input.outputKey,
            },
          ]
        : [],
    )
    .sort(({ inputKey: left }, { inputKey: right }) =>
      left.localeCompare(right),
    );
}

function validatedIndicatorOutputBindings(
  indicator: WorkspaceIndicator,
  definition: InstalledIndicatorDefinition,
): ReturnType<typeof indicatorOutputBindings> {
  const declaredInputs = new Map(
    definition.inputs.map((input) => [input.key, input]),
  );
  return indicatorOutputBindings(indicator).map((binding) => {
    const declaredInput = declaredInputs.get(binding.inputKey);
    if (declaredInput === undefined) {
      throw new IndicatorDependencyGraphError(
        "INDICATOR_DEPENDENCY_MISSING_INPUT",
        `Indicator ${indicator.instanceId} binding ${binding.inputKey} does not match a declared input.`,
      );
    }
    if (declaredInput.type !== "source") {
      throw new IndicatorDependencyGraphError(
        "INDICATOR_DEPENDENCY_INCOMPATIBLE_INPUT",
        `Indicator ${indicator.instanceId} binding ${binding.inputKey} requires a source input, received ${declaredInput.type}.`,
      );
    }
    return binding;
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

export function normalizePluginIndicatorParameters(
  indicator: WorkspaceIndicator,
  definition: InstalledIndicatorDefinition,
): Readonly<Record<string, boolean | number | string>> {
  return normalizeIndicatorParameters(definition, indicator.parameters);
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
  availableTimeframeIds?: readonly string[],
  chartTimeframeId?: string,
  parameters: Readonly<Record<string, unknown>> = {},
): readonly PluginIndicatorSettingsField[] {
  return definition.inputs
    .filter((input) => input.type !== "source")
    .map((input) => {
      if (
        input.type !== "string" ||
        input.editor !== "timeframe" ||
        availableTimeframeIds === undefined ||
        chartTimeframeId === undefined
      ) {
        return { ...input };
      }
      const options = [
        { value: "chart", label: `Chart (${chartTimeframeId})` },
        ...availableTimeframeIds
          .filter((value, index, values) => values.indexOf(value) === index)
          .map((value) => ({ value, label: value })),
      ];
      const requested = parameters[input.key];
      if (
        typeof requested === "string" &&
        requested !== "chart" &&
        !options.some(({ value }) => value === requested)
      ) {
        options.push({ value: requested, label: `${requested} (Unavailable)` });
      }
      return { ...input, options };
    });
}

export function resolvePluginIndicatorSourcePlan(
  indicator: WorkspaceIndicator,
  definition: InstalledIndicatorDefinition,
  chartTimeframeId: string,
  availableTimeframeIds: readonly string[],
): PluginIndicatorSourcePlan {
  const available = new Set(availableTimeframeIds);
  const declaration = definition.source?.timeframe;
  const candleDeclaration = definition.source?.candleType;
  const configured =
    declaration?.inputKey === undefined
      ? declaration?.requestedTimeframeId
      : indicator.parameters[declaration.inputKey];
  const requestedTimeframeId =
    typeof configured === "string" && configured.length > 0
      ? configured
      : (declaration?.requestedTimeframeId ?? "chart");
  const requestedActiveTimeframeId =
    requestedTimeframeId === "chart" ? chartTimeframeId : requestedTimeframeId;
  const activeTimeframeId = available.has(requestedActiveTimeframeId)
    ? requestedActiveTimeframeId
    : chartTimeframeId;
  const configuredCandleType =
    candleDeclaration?.inputKey === undefined
      ? candleDeclaration?.requestedCandleType
      : indicator.parameters[candleDeclaration.inputKey];
  const candleType =
    configuredCandleType === "heikin-ashi" ? "heikin-ashi" : "standard";
  const taSources = (definition.source?.taTimeframeIds ?? []).map(
    (requestedTaTimeframeId) => {
      const requestedActiveTimeframeId =
        requestedTaTimeframeId === "chart"
          ? chartTimeframeId
          : requestedTaTimeframeId;
      const activeTaTimeframeId = available.has(requestedActiveTimeframeId)
        ? requestedActiveTimeframeId
        : chartTimeframeId;
      return Object.freeze({
        requestedTimeframeId: requestedTaTimeframeId,
        activeTimeframeId: activeTaTimeframeId,
        usedFallback: activeTaTimeframeId !== requestedActiveTimeframeId,
      });
    },
  );
  const taTimeframeIds = [
    ...new Set(taSources.map(({ activeTimeframeId }) => activeTimeframeId)),
  ];
  return Object.freeze({
    requestedTimeframeId,
    activeTimeframeId,
    usedFallback: activeTimeframeId !== requestedActiveTimeframeId,
    candleType,
    taTimeframeIds: Object.freeze(taTimeframeIds),
    taSources: Object.freeze(taSources),
  });
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
    if (input.type === "source") {
      parameters[input.key] = input.defaultValue;
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
        const semanticTextSize =
          plot.kind === "shape" ? indicatorShapeTextSize(plot) : undefined;
        return {
          ...(plot.kind === "shape" && plot.textColor !== undefined
            ? { color: plot.textColor }
            : typeof dynamicColor === "string"
              ? { color: dynamicColor }
              : plot.color === undefined
                ? {}
                : { color: plot.color }),
          ...(semanticTextSize !== undefined
            ? { size: semanticTextSize }
            : typeof dynamicSize === "number"
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
      const baseline =
        plot.kind === "shape" ? indicatorShapeBaseline(plot) : undefined;
      return [
        {
          ...common,
          type: "text",
          attrs: (): Record<string, unknown> => ({
            text:
              plot.kind === "shape"
                ? indicatorShapeText(plot)
                : plot.direction === "down"
                  ? "▼"
                  : "▲",
            ...(baseline === undefined ? {} : { baseline }),
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

export function alignPluginIndicatorSnapshotRows(
  dataList: readonly KLineData[],
  snapshot: IndicatorRuntimeSnapshot,
  sourceTimeframeId?: string,
  chartTimeframeId?: string,
): PluginIndicatorFigureData[] {
  const sourceDuration =
    sourceTimeframeId === undefined
      ? undefined
      : timeframeDurationMs(sourceTimeframeId);
  const chartDuration =
    chartTimeframeId === undefined
      ? undefined
      : timeframeDurationMs(chartTimeframeId);
  if (
    sourceDuration !== undefined &&
    chartDuration !== undefined &&
    sourceTimeframeId !== chartTimeframeId
  ) {
    const points = [...snapshot.points].sort(
      (left, right) => left.openTimeMs - right.openTimeMs,
    );
    let pointIndex = 0;
    let latest: PluginIndicatorFigureData | undefined;
    return dataList.map((data) => {
      const chartCloseTimeMs = data.timestamp + chartDuration;
      while (pointIndex < points.length) {
        const point = points[pointIndex];
        if (
          point === undefined ||
          point.openTimeMs + sourceDuration > chartCloseTimeMs
        )
          break;
        latest = rowForPoint(point);
        pointIndex += 1;
      }
      return latest ?? {};
    });
  }
  const points = new Map(
    snapshot.points.map((point) => [point.openTimeMs, rowForPoint(point)]),
  );
  return dataList.map((data) => points.get(data.timestamp) ?? {});
}

function timeframeDurationMs(timeframeId: string): number | undefined {
  const match = /^(\d+)(s|m|h|d)$/u.exec(timeframeId);
  if (match === null) return undefined;
  const amount = Number(match[1]);
  const multiplier =
    match[2] === "s"
      ? 1_000
      : match[2] === "m"
        ? 60_000
        : match[2] === "h"
          ? 3_600_000
          : 86_400_000;
  const result = amount * multiplier;
  return Number.isSafeInteger(result) && result > 0 ? result : undefined;
}

function applyWorkerResult(
  dataList: readonly KLineData[],
  context: RuntimeContext,
  result: IndicatorWorkerResultUpdate,
  candleCount = dataList.length,
  candleTail = dataList.slice(-2),
): PluginIndicatorFigureData[] {
  if (result.kind === "snapshot") {
    context.publishedPoints = new Map(
      result.snapshot.points.map((point) => [
        point.openTimeMs,
        {
          openTimeMs: point.openTimeMs,
          values: { ...point.values },
          ...(point.colors === undefined
            ? {}
            : { colors: { ...point.colors } }),
          ...(point.sizes === undefined ? {} : { sizes: { ...point.sizes } }),
        },
      ]),
    );
    context.rows = alignPluginIndicatorSnapshotRows(
      dataList,
      result.snapshot,
      context.timeframeId,
      context.chartTimeframeId,
    );
    const first = dataList[0]?.timestamp;
    if (first !== undefined) rowStartTimes.set(context.rows, first);
    context.overlays = result.snapshot.overlays;
    context.signals = result.snapshot.signals;
    return context.rows;
  }
  const rows = context.rows;
  const expectedPointCount = result.kind === "building" ? 1 : 2;
  if (
    rows === undefined ||
    result.points.length !== expectedPointCount ||
    (result.kind === "building" && rows.length !== candleCount) ||
    (result.kind === "rollover" && rows.length + 1 !== candleCount)
  ) {
    throw new Error(
      "Indicator worker result delta does not match renderer state.",
    );
  }
  const startIndex = candleCount - expectedPointCount;
  for (let offset = 0; offset < expectedPointCount; offset += 1) {
    const data = candleTail[candleTail.length - expectedPointCount + offset];
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
  const published =
    context.publishedPoints ?? new Map<number, IndicatorRuntimePoint>();
  for (const point of result.points) {
    published.set(point.openTimeMs, {
      openTimeMs: point.openTimeMs,
      values: { ...point.values },
      ...(point.colors === undefined ? {} : { colors: { ...point.colors } }),
      ...(point.sizes === undefined ? {} : { sizes: { ...point.sizes } }),
    });
  }
  context.publishedPoints = published;
  if (result.overlays !== undefined) context.overlays = result.overlays;
  if (result.signals !== undefined) context.signals = result.signals;
  return rows;
}

interface ResolvedIndicatorDependency {
  readonly snapshot: Omit<IndicatorWorkerDependencySnapshot, "points">;
  readonly points: ReadonlyMap<number, IndicatorRuntimePoint>;
}

async function resolveDependenciesFor(
  context: RuntimeContext,
  dataList: readonly KLineData[],
): Promise<readonly ResolvedIndicatorDependency[]> {
  return Promise.all(
    context.dependencyBindings.map(async (binding) => {
      await calculatePluginIndicator(binding.runtimeId, dataList);
      const upstream = contexts.get(binding.runtimeId);
      if (upstream === undefined || upstream.publishedPoints === undefined) {
        throw new Error(
          `Indicator dependency ${binding.instanceId}.${binding.outputKey} has not published a result.`,
        );
      }
      return {
        snapshot: {
          inputKey: binding.inputKey,
          instanceId: binding.instanceId,
          outputKey: binding.outputKey,
          sourceGeneration: upstream.dataGeneration,
          sourceRevision: upstream.dataRevision,
          configGeneration: upstream.configGeneration,
          outputRevision: upstream.outputRevision,
        },
        points: upstream.publishedPoints,
      } satisfies ResolvedIndicatorDependency;
    }),
  );
}

function dependencySnapshotsForData(
  dependencies: readonly ResolvedIndicatorDependency[],
  data: BrowserIndicatorDataUpdate,
): readonly IndicatorWorkerDependencySnapshot[] {
  const openTimeMs =
    data.kind === "building"
      ? [data.candle.openTimeMs]
      : data.kind === "rollover"
        ? [data.finalized.openTimeMs, data.building.openTimeMs]
        : undefined;
  return dependencies.map(({ snapshot, points }) => {
    const selected =
      openTimeMs === undefined
        ? [...points.values()].sort(
            (left, right) => left.openTimeMs - right.openTimeMs,
          )
        : openTimeMs.flatMap((timestamp) => {
            const point = points.get(timestamp);
            return point === undefined ? [] : [point];
          });
    return {
      ...snapshot,
      points: selected.map((point) => ({
        openTimeMs: point.openTimeMs,
        values: {
          [snapshot.outputKey]: point.values[snapshot.outputKey] ?? null,
        },
      })),
    };
  });
}

export function pluginIndicatorDependencyVersion(
  dependencies: readonly IndicatorWorkerDependencySnapshot[],
): string | undefined {
  if (dependencies.length === 0) return undefined;
  return JSON.stringify(
    dependencies.map(
      ({
        inputKey,
        instanceId,
        outputKey,
        sourceGeneration,
        sourceRevision,
        configGeneration,
        outputRevision,
      }) => ({
        inputKey,
        instanceId,
        outputKey,
        sourceGeneration,
        sourceRevision,
        configGeneration,
        outputRevision,
      }),
    ),
  );
}

async function calculatePluginIndicator(
  runtimeId: string,
  dataList: readonly KLineData[],
): Promise<PluginIndicatorFigureData[]> {
  const context = contexts.get(runtimeId);
  if (context === undefined) return dataList.map(() => ({}));
  context.queuedDataList = dataList;
  if (context.calculationRunning && context.latestCalculation !== undefined)
    return context.latestCalculation;
  context.calculationRunning = true;
  const calculation = (async (): Promise<PluginIndicatorFigureData[]> => {
    try {
      while (context.queuedDataList !== undefined) {
        const next = context.queuedDataList;
        delete context.queuedDataList;
        const sourceChange = context.pendingSeriesChange;
        if (
          sourceChange !== undefined &&
          (sourceChange.generation < context.dataGeneration ||
            (sourceChange.generation === context.dataGeneration &&
              sourceChange.revision < context.dataRevision))
        ) {
          delete context.pendingSeriesChange;
          continue;
        }
        const resolvedDependencies =
          context.dependencyBindings.length === 0
            ? []
            : await resolveDependenciesFor(context, next);
        const dependencyMetadata = resolvedDependencies.map(({ snapshot }) => ({
          ...snapshot,
          points: [],
        }));
        const nextDependencyVersion =
          pluginIndicatorDependencyVersion(dependencyMetadata);
        const dependencyChanged =
          nextDependencyVersion !== context.dependencyVersion;
        let data = incrementalDataUpdate(next, context);
        const sourceDataChanged = data !== undefined;
        const configurationRebuild =
          context.configurationRebuildPending === true;
        if (
          configurationRebuild &&
          data !== undefined &&
          data.kind !== "snapshot" &&
          data.kind !== "rebuild"
        ) {
          data = fullSnapshotData(next, context, "rebuild");
        } else if (
          (dependencyChanged || configurationRebuild) &&
          data === undefined
        ) {
          data = fullSnapshotData(next, context, "rebuild");
        }
        if (data === undefined) {
          delete context.pendingSeriesChange;
          continue;
        }
        const dependencies = dependencySnapshotsForData(
          resolvedDependencies,
          data,
        );
        if (sourceChange !== undefined)
          context.dataGeneration = sourceChange.generation;
        delete context.pendingSeriesChange;
        if (sourceChange !== undefined)
          context.dataRevision = sourceChange.revision;
        else if (sourceDataChanged) context.dataRevision += 1;
        // Chart arrays can change while the worker runs. Capture only the tail for deltas.
        const resultTimeline =
          data.kind === "snapshot" || data.kind === "rebuild"
            ? [...next]
            : next;
        const count = next.length;
        const tail = next.slice(-2).map((candle) => ({ ...candle }));
        const snapshotTimeline = (): readonly KLineData[] => {
          const timeline = resultTimeline.slice(0, count);
          for (let offset = 0; offset < tail.length; offset += 1) {
            const candle = tail[offset];
            if (candle !== undefined)
              timeline[count - tail.length + offset] = candle;
          }
          return timeline;
        };
        const result = await context.sync({
          instanceId: runtimeId,
          runtimeEntryUrl: context.summary.runtimeEntryUrl,
          pluginId: context.indicator.pluginId,
          definitionId: context.indicator.definitionId,
          providerProfileId: context.providerProfileId,
          instrumentId: context.instrumentId,
          timeframeId: context.timeframeId,
          candleType: context.candleType,
          sourceTimeframeIds: context.sourceTimeframeIds,
          sourceTimeframes: context.sourceTimeframes,
          parameters: normalizePluginIndicatorParameters(
            context.indicator,
            context.summary.definition,
          ),
          ...(dependencies.length === 0 ? {} : { dependencies }),
          data,
          rebuildCandles: () =>
            snapshotTimeline().map((item) =>
              toCandle(item, context.instrumentId, context.chartTimeframeId),
            ),
          dataRevision: context.dataRevision,
          configGeneration: context.configGeneration,
        });
        const current = contexts.get(runtimeId);
        if (current !== context) {
          return current?.latestCalculation ?? current?.rows ?? [];
        }
        applyWorkerResult(
          result.kind === "snapshot" ? snapshotTimeline() : resultTimeline,
          context,
          result,
          count,
          tail,
        );
        context.outputRevision += 1;
        if (nextDependencyVersion === undefined)
          delete context.dependencyVersion;
        else context.dependencyVersion = nextDependencyVersion;
        delete context.configurationRebuildPending;
      }
      return context.rows ?? [];
    } finally {
      context.calculationRunning = false;
    }
  })();
  context.latestCalculation = calculation;
  return calculation;
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
    if (runtimeId.startsWith(prefix)) {
      const pending = context.pendingSeriesChange;
      context.pendingSeriesChange =
        pending?.generation === change.generation && pending.kind === "rebuild"
          ? {
              ...change,
              kind: "rebuild",
              ...(pending.dirtyFromOpenTimeMs === undefined
                ? {}
                : {
                    dirtyFromOpenTimeMs: Math.min(
                      pending.dirtyFromOpenTimeMs,
                      change.dirtyFromOpenTimeMs ?? pending.dirtyFromOpenTimeMs,
                    ),
                  }),
            }
          : change;
    }
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
  availableTimeframeIds: readonly string[] = [timeframeId],
): PluginIndicatorReconciliation {
  const summaries = new Map(
    installed.map((summary) => [
      `${summary.pluginId}\u0000${summary.definition.id}`,
      summary,
    ]),
  );
  const desiredCandidates =
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
  const dependencyPlan = createIndicatorDependencyPlan(
    desiredCandidates.map(({ indicator, summary }) => ({
      instanceId: indicator.instanceId,
      outputKeys: summary.definition.outputs.map(({ key }) => key),
      bindings: Object.fromEntries(
        validatedIndicatorOutputBindings(indicator, summary.definition).map(
          ({ inputKey, instanceId, outputKey }) => [
            inputKey,
            { instanceId, outputKey },
          ],
        ),
      ),
    })),
  );
  const desiredByInstanceId = new Map(
    desiredCandidates.map((candidate) => [
      candidate.indicator.instanceId,
      candidate,
    ]),
  );
  const desired = dependencyPlan.orderedInstanceIds.flatMap((instanceId) => {
    const candidate = desiredByInstanceId.get(instanceId);
    return candidate === undefined ? [] : [candidate];
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
  const calculationKeysByInstanceId = new Map<string, string>();
  for (const { indicator, summary, runtimeId } of desired) {
    const name = registrationName(summary);
    const previousContext = contexts.get(runtimeId);
    const sourcePlan = resolvePluginIndicatorSourcePlan(
      indicator,
      summary.definition,
      timeframeId,
      availableTimeframeIds,
    );
    const nextSourceKey = sourceKey(
      providerProfileId,
      instrumentId,
      timeframeId,
      sourcePlan,
    );
    const ownCalculationKey = calculationKey(
      indicator,
      summary,
      providerProfileId,
      instrumentId,
      sourcePlan.activeTimeframeId,
      sourcePlan.taSources,
      timeframeId,
    );
    const dependencyBindings = (
      dependencyPlan.bindingsByInstanceId.get(indicator.instanceId) ?? []
    ).map((binding) => {
      const dependency = desiredByInstanceId.get(binding.instanceId);
      if (dependency === undefined)
        throw new Error(
          `Indicator dependency ${binding.instanceId} is unavailable.`,
        );
      return {
        ...binding,
        runtimeId: dependency.runtimeId,
      };
    });
    const nextCalculationKey = JSON.stringify({
      own: ownCalculationKey,
      dependencies: dependencyBindings.map(
        ({ inputKey, instanceId, outputKey }) => ({
          inputKey,
          instanceId,
          outputKey,
          calculationKey: calculationKeysByInstanceId.get(instanceId),
        }),
      ),
    });
    calculationKeysByInstanceId.set(indicator.instanceId, nextCalculationKey);
    const previousCalculationKey = previousContext?.calculationKey;
    const sameConfiguration = previousCalculationKey === nextCalculationKey;
    const sameSource = previousContext?.sourceKey === nextSourceKey;
    const nextContext: RuntimeContext = {
      indicator,
      summary,
      providerProfileId,
      instrumentId,
      chartTimeframeId: timeframeId,
      timeframeId: sourcePlan.activeTimeframeId,
      candleType: sourcePlan.candleType,
      sourceTimeframeIds: sourcePlan.taTimeframeIds,
      sourceTimeframes: sourcePlan.taSources.map(
        ({ requestedTimeframeId, activeTimeframeId }) => ({
          requestedTimeframeId,
          activeTimeframeId,
        }),
      ),
      dependencyBindings,
      sourceKey: nextSourceKey,
      calculationKey: nextCalculationKey,
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
        sameSource && previousContext !== undefined
          ? previousContext.dataGeneration
          : 0,
      dataRevision:
        sameSource && previousContext !== undefined
          ? previousContext.dataRevision
          : 0,
      configGeneration:
        sameConfiguration && previousContext !== undefined
          ? previousContext.configGeneration
          : (previousContext?.configGeneration ?? 0) + 1,
      outputRevision: previousContext?.outputRevision ?? 0,
      ...(sameSource && previousContext?.lastCandleCount !== undefined
        ? { lastCandleCount: previousContext.lastCandleCount }
        : {}),
      lastBuilding: sameSource ? previousContext?.lastBuilding : undefined,
      ...(!sameConfiguration && sameSource && previousContext !== undefined
        ? { configurationRebuildPending: true }
        : {}),
      ...(sameConfiguration && previousContext?.rows !== undefined
        ? { rows: previousContext.rows }
        : {}),
      ...(sameConfiguration && previousContext?.publishedPoints !== undefined
        ? { publishedPoints: previousContext.publishedPoints }
        : {}),
      ...(sameConfiguration && previousContext?.dependencyVersion !== undefined
        ? { dependencyVersion: previousContext.dependencyVersion }
        : {}),
      ...(sameConfiguration &&
      previousContext?.pendingSeriesChange !== undefined
        ? { pendingSeriesChange: previousContext.pendingSeriesChange }
        : {}),
    };
    // Presentation reconciliation must not replace an in-flight calculation's owner.
    contexts.set(
      runtimeId,
      sameConfiguration && previousContext !== undefined
        ? Object.assign(previousContext, {
            indicator,
            summary,
            dependencyBindings,
            sourceKey: nextSourceKey,
            calculationKey: nextCalculationKey,
            sync: sync as PluginIndicatorSync,
          })
        : nextContext,
    );
    if (!registeredNames.has(name)) {
      module.registerIndicator<PluginIndicatorFigureData, string>({
        name,
        shortName: summary.definition.name,
        series: summary.definition.placement === "overlay" ? "price" : "normal",
        figures: figuresForDefinition(summary.definition),
        calc: async (dataList, runtimeIndicator) => {
          const context = contexts.get(runtimeIndicator.id);
          if (context === undefined) return dataList.map(() => ({}));
          // KLineCharts prepends candles immediately, but awaits calc before
          // replacing its index-based results. Keep existing plots on their
          // original candles while the worker rebuilds the expanded history.
          const displayed = runtimeIndicator.result;
          const displayedStart =
            displayed === undefined ? undefined : rowStartTimes.get(displayed);
          const first = dataList[0]?.timestamp;
          if (
            displayedStart !== undefined &&
            first !== undefined &&
            first < displayedStart
          ) {
            const offset = dataList.findIndex(
              (candle) => candle.timestamp === displayedStart,
            );
            if (offset > 0 && dataList.length >= offset + displayed.length) {
              const aligned = [
                ...Array.from({ length: offset }, () => ({})),
                ...displayed,
              ];
              runtimeIndicator.result = aligned;
              rowStartTimes.set(aligned, first);
            }
          }
          return calculatePluginIndicator(runtimeIndicator.id, dataList);
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
