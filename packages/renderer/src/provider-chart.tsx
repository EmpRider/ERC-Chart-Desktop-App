import type {
  Candle,
  ImportedProviderSession,
  InstalledIndicatorSummary,
  ProviderHistoryLoadRequest,
  ProviderLiveEvent,
  ProviderLiveRequest,
  ProviderSeriesChange,
  WorkspaceIndicator,
} from "@erc-chart/contracts";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type JSX,
  type SetStateAction,
} from "react";
import type {
  Chart,
  DataLoaderGetBarsParams,
  Indicator,
  IndicatorCreate,
  IndicatorFilter,
  KLineData,
  Period,
} from "klinecharts";
import {
  builtInIndicatorDefinitions,
  builtInIndicatorPluginId,
  createBuiltInWorkspaceIndicator,
  getBuiltInIndicatorDefinition,
  normalizeBuiltInIndicatorParameters,
  toBuiltInKLineIndicatorSpecs,
  updateBuiltInIndicatorParameters,
  type BuiltInIndicatorDefinition,
} from "./builtin-indicators.js";
import { registerApplicationBuiltInIndicators } from "./kline-builtins.js";
import {
  createPluginWorkspaceIndicator,
  disposePluginIndicatorContexts,
  markPluginIndicatorSeriesChange,
  normalizePluginIndicatorParameters,
  pluginIndicatorSettingsFields,
  reconcilePluginIndicators,
  updatePluginIndicatorParameters,
  type PluginIndicatorSettingsField,
  type PluginIndicatorSync,
} from "./plugin-indicators.js";
import { ProviderToolbarIcon } from "./provider-toolbar-icons.js";
import { maximumIndicatorsPerWorkspace } from "./workspace.js";

export interface ProviderChartSession extends ImportedProviderSession {
  readonly series?: ProviderSeriesChange;
  /** Last correction, retained even when React batches subsequent building updates. */
  readonly rebuildRevision?: number;
  /** Same-bar replacement without copying the historical session array. */
  readonly liveCandle?: Candle;
}

export function providerChartSessionCandles(
  session: ProviderChartSession,
): readonly Candle[] {
  if (session.liveCandle === undefined) return session.candles;
  const candles = [...session.candles];
  candles[candles.length - 1] = session.liveCandle;
  return candles;
}

export type ProviderChartType = "candlestick" | "heikin_ashi" | "line" | "area";

export type ProviderHistoryRequester = (
  request: ProviderHistoryLoadRequest,
) => Promise<readonly Candle[]>;

const coreDrawingTools = [
  { name: "straightLine", label: "Trend line", glyph: "╱" },
  { name: "horizontalStraightLine", label: "Horizontal line", glyph: "—" },
  { name: "verticalStraightLine", label: "Vertical line", glyph: "│" },
  { name: "fibonacciLine", label: "Fibonacci", glyph: "≡" },
  { name: "priceChannelLine", label: "Price channel", glyph: "∥" },
  { name: "parallelStraightLine", label: "Parallel lines", glyph: "//" },
  { name: "brush", label: "Brush", glyph: "✎" },
  { name: "simpleAnnotation", label: "Annotation", glyph: "A" },
] as const;

export type ProviderDataSubscriber = (
  request: ProviderLiveRequest,
  listener: (event: ProviderLiveEvent) => void,
) => Promise<() => Promise<void>>;

type ProviderChartNavigationApi = Pick<
  Chart,
  | "getBarSpace"
  | "scrollByDistance"
  | "scrollToRealTime"
  | "setBarSpace"
  | "setOffsetRightDistance"
  | "zoomAtCoordinate"
>;

const chartNavigationAnimationMs = 120;

export function panProviderChartView(
  chart: ProviderChartNavigationApi,
  direction: "left" | "right",
): void {
  const directionMultiplier = direction === "left" ? 1 : -1;
  chart.scrollByDistance(
    directionMultiplier * 3 * chart.getBarSpace().bar,
    chartNavigationAnimationMs,
  );
}

export function zoomProviderChartView(
  chart: ProviderChartNavigationApi,
  direction: "in" | "out",
): void {
  chart.zoomAtCoordinate(
    direction === "in" ? 1.05 : 0.95,
    undefined,
    chartNavigationAnimationMs,
  );
}

export function resetProviderChartView(
  chart: ProviderChartNavigationApi,
): void {
  chart.setBarSpace(10);
  chart.setOffsetRightDistance(80);
  chart.scrollToRealTime(chartNavigationAnimationMs);
}

type IndicatorSettingsDraft = Readonly<Record<string, string>>;

type IndicatorSettingsField = PluginIndicatorSettingsField;

function builtInSettingsFields(
  definition: BuiltInIndicatorDefinition,
): readonly IndicatorSettingsField[] {
  return definition.parameters.map((parameter) =>
    parameter.kind === "number"
      ? {
          key: parameter.key,
          label: parameter.label,
          group: "Parameters",
          effect: "calculation" as const,
          type: "number" as const,
          defaultValue: parameter.defaultValue,
          min: parameter.min,
          max: parameter.max,
          step: parameter.step,
        }
      : {
          key: parameter.key,
          label: parameter.label,
          group: "Parameters",
          effect: "calculation" as const,
          type: "string" as const,
          defaultValue: parameter.defaultValue,
          options: parameter.options,
        },
  );
}

export type IndicatorSettingsTab = "inputs" | "style";

export interface IndicatorSettingsGroup {
  readonly name: string;
  readonly fields: readonly IndicatorSettingsField[];
}

export function groupIndicatorSettingsFields(
  fields: readonly IndicatorSettingsField[],
  tab: IndicatorSettingsTab,
): readonly IndicatorSettingsGroup[] {
  const groups = new Map<string, IndicatorSettingsField[]>();
  for (const field of fields) {
    const fieldTab = field.effect === "presentation" ? "style" : "inputs";
    if (fieldTab !== tab) continue;
    const groupName = field.group?.trim() || "Other";
    const group = groups.get(groupName) ?? [];
    group.push(field);
    groups.set(groupName, group);
  }
  return [...groups.entries()].map(([name, groupFields]) => ({
    name,
    fields: groupFields,
  }));
}

export function queueIndicatorSettingsDraftChange(
  parameterKey: string,
  event: { readonly currentTarget: { readonly value: string } },
  setSettingsDraft: Dispatch<SetStateAction<IndicatorSettingsDraft>>,
): void {
  const value = event.currentTarget.value;
  setSettingsDraft((draft) => ({
    ...draft,
    [parameterKey]: value,
  }));
}

export interface ProviderChartProps {
  readonly session: ProviderChartSession;
  readonly chartType?: ProviderChartType | undefined;
  readonly onChartTypeChange?:
    ((chartType: ProviderChartType) => void) | undefined;
  readonly requestProviderHistory?: ProviderHistoryRequester | undefined;
  readonly subscribeProviderData?: ProviderDataSubscriber | undefined;
  readonly selectedTimeframeId?: string | undefined;
  readonly availableTimeframeIds?: readonly string[] | undefined;
  readonly timeframeLoading?: boolean | undefined;
  readonly onTimeframeChange?: ((timeframeId: string) => void) | undefined;
  readonly indicators?: readonly WorkspaceIndicator[] | undefined;
  readonly installedIndicators?:
    readonly InstalledIndicatorSummary[] | undefined;
  readonly onIndicatorImport?: (() => void) | undefined;
  readonly syncIndicator?: PluginIndicatorSync | undefined;
  readonly disposeIndicator?:
    ((instanceId: string) => Promise<void>) | undefined;
  readonly onIndicatorAdd?:
    ((indicator: WorkspaceIndicator) => void) | undefined;
  readonly onIndicatorUpdate?:
    ((indicator: WorkspaceIndicator) => void) | undefined;
  readonly onIndicatorEnabledChange?:
    ((instanceId: string, enabled: boolean) => void) | undefined;
  readonly onIndicatorRemove?: ((instanceId: string) => void) | undefined;
}

type BuiltInIndicatorChart = Pick<
  Chart,
  "createIndicator" | "getIndicators" | "overrideIndicator" | "removeIndicator"
>;

export interface BuiltInIndicatorReconciliation {
  readonly managedRuntimeIds: ReadonlySet<string>;
  readonly ownerByRuntimeId: ReadonlyMap<string, string>;
}

function runtimeIndicatorCreate(
  spec: ReturnType<typeof toBuiltInKLineIndicatorSpecs>[number],
): IndicatorCreate {
  return {
    id: spec.id,
    name: spec.name,
    shortName: spec.shortName,
    calcParams: [...spec.calcParams],
    ...(spec.precision === undefined ? {} : { precision: spec.precision }),
    visible: spec.visible,
    ...(spec.placement === "overlay" ? { paneId: "candle_pane" } : {}),
  };
}

export function reconcileBuiltInIndicators(
  chart: BuiltInIndicatorChart,
  indicators: readonly WorkspaceIndicator[],
  previousManagedRuntimeIds: ReadonlySet<string> = new Set(),
): BuiltInIndicatorReconciliation {
  const desiredSpecs = indicators.flatMap((indicator) =>
    toBuiltInKLineIndicatorSpecs(indicator),
  );
  const desiredRuntimeIds = new Set(desiredSpecs.map((spec) => spec.id));
  for (const runtimeId of previousManagedRuntimeIds) {
    if (!desiredRuntimeIds.has(runtimeId))
      chart.removeIndicator({ id: runtimeId });
  }

  const managedRuntimeIds = new Set<string>();
  const ownerByRuntimeId = new Map<string, string>();
  for (const spec of desiredSpecs) {
    const filter: IndicatorFilter = { id: spec.id };
    const existing = chart.getIndicators(filter)[0];
    if (existing !== undefined && existing.name !== spec.name) {
      chart.removeIndicator(filter);
    }
    const current = chart.getIndicators(filter)[0];
    if (current === undefined) {
      chart.createIndicator(
        runtimeIndicatorCreate(spec),
        spec.placement === "overlay",
      );
    } else {
      chart.overrideIndicator(runtimeIndicatorCreate(spec));
    }
    managedRuntimeIds.add(spec.id);
    ownerByRuntimeId.set(spec.id, spec.ownerInstanceId);
  }
  return { managedRuntimeIds, ownerByRuntimeId };
}

interface IndicatorTooltipFeatureClick {
  readonly paneId: string;
  readonly feature: { readonly id: string };
  readonly indicator: Indicator;
}

function isIndicatorTooltipFeatureClick(
  value: unknown,
): value is IndicatorTooltipFeatureClick {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<IndicatorTooltipFeatureClick>;
  return (
    typeof candidate.paneId === "string" &&
    typeof candidate.feature === "object" &&
    candidate.feature !== null &&
    typeof candidate.feature.id === "string" &&
    typeof candidate.indicator === "object" &&
    candidate.indicator !== null &&
    typeof candidate.indicator.id === "string"
  );
}

function createBuiltInIndicatorInstanceId(definitionId: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  const suffix =
    randomId ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `builtin:${definitionId}:${suffix}`;
}

function createPluginIndicatorInstanceId(
  pluginId: string,
  definitionId: string,
): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  const suffix =
    randomId ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `plugin:${pluginId}:${definitionId}:${suffix}`;
}

function periodForTimeframe(timeframeId: string): Period {
  const match = /^(\d+)(s|m|h|d|w|M|y)$/u.exec(timeframeId);
  if (match === null) return { type: "minute", span: 1 };
  const span = Number(match[1]);
  const unit = match[2];
  const type: Period["type"] =
    unit === "s"
      ? "second"
      : unit === "m"
        ? "minute"
        : unit === "h"
          ? "hour"
          : unit === "d"
            ? "day"
            : unit === "w"
              ? "week"
              : unit === "M"
                ? "month"
                : "year";
  return { type, span };
}

function timeframeDurationMs(timeframeId: string): number {
  const match = /^(\d+)(s|m|h|d|w|M|y)$/u.exec(timeframeId);
  if (match === null) return 60_000;
  const span = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === "s"
      ? 1_000
      : unit === "m"
        ? 60_000
        : unit === "h"
          ? 3_600_000
          : unit === "d"
            ? 86_400_000
            : unit === "w"
              ? 604_800_000
              : unit === "M"
                ? 2_592_000_000
                : 31_536_000_000;
  return span * multiplier;
}

function toKLineCandle(candle: Candle): KLineData {
  return {
    timestamp: candle.openTimeMs,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    ...(candle.volume === undefined ? {} : { volume: candle.volume }),
  };
}

function toHeikinAshiCandle(candle: Candle, previous?: KLineData): KLineData {
  const close = (candle.open + candle.high + candle.low + candle.close) / 4;
  const open =
    previous === undefined
      ? (candle.open + candle.close) / 2
      : (previous.open + previous.close) / 2;
  return {
    timestamp: candle.openTimeMs,
    open,
    high: Math.max(candle.high, open, close),
    low: Math.min(candle.low, open, close),
    close,
    ...(candle.volume === undefined ? {} : { volume: candle.volume }),
  };
}

export function toHeikinAshiData(
  candles: readonly Candle[],
  seed?: KLineData,
): KLineData[] {
  const result: KLineData[] = [];
  let previous = seed;
  let previousBeforeTimestamp = seed;
  let activeTimestamp: number | undefined;

  for (const candle of candles) {
    if (candle.openTimeMs !== activeTimestamp) {
      activeTimestamp = candle.openTimeMs;
      previousBeforeTimestamp = previous;
    }
    const transformed = toHeikinAshiCandle(candle, previousBeforeTimestamp);
    result.push(transformed);
    previous = transformed;
  }
  return result;
}

export function updateChartData(
  updateData: (data: KLineData) => void,
  candles: readonly Candle[],
  chartType: ProviderChartType = "candlestick",
  existingData: readonly KLineData[] = [],
): void {
  if (chartType !== "heikin_ashi") {
    for (const candle of candles) updateData(toKLineCandle(candle));
    return;
  }
  const firstTimestamp = candles[0]?.openTimeMs;
  let seed: KLineData | undefined;
  for (
    let index = existingData.length - 1;
    firstTimestamp !== undefined && index >= 0;
    index -= 1
  ) {
    const data = existingData[index];
    if (data !== undefined && data.timestamp < firstTimestamp) {
      seed = data;
      break;
    }
  }
  for (const data of toHeikinAshiData(candles, seed)) updateData(data);
}

export function applyProviderSeriesUpdate(
  chart: Pick<Chart, "getDataList" | "resetData">,
  updateData: (data: KLineData) => void,
  candles: readonly Candle[],
  series: ProviderSeriesChange,
  chartType: ProviderChartType,
  lastAppliedOpenTimeMs: { current: number | undefined },
  authoritativeResetCandles: { current: readonly Candle[] | undefined },
  dataLoadGeneration: { current: number },
): void {
  if (series.kind === "rebuild") {
    authoritativeResetCandles.current = Object.freeze([...candles]);
    dataLoadGeneration.current += 1;
    lastAppliedOpenTimeMs.current = candles.at(-1)?.openTimeMs;
    chart.resetData();
    return;
  }
  updateChartData(updateData, candles, chartType, chart.getDataList());
  lastAppliedOpenTimeMs.current =
    candles.at(-1)?.openTimeMs ?? lastAppliedOpenTimeMs.current;
}

function toKLineData(
  session: ImportedProviderSession,
  chartType: ProviderChartType,
): KLineData[] {
  return chartType === "heikin_ashi"
    ? toHeikinAshiData(session.candles)
    : session.candles.map(toKLineCandle);
}

const providerHistoryPageSize = 500;

export interface KLineHistoryPage {
  readonly data: KLineData[];
  readonly more: Readonly<{ forward: boolean; backward: boolean }>;
}

export async function loadKLineHistoryPage(
  params: Pick<DataLoaderGetBarsParams, "type" | "timestamp">,
  session: ImportedProviderSession,
  requestProviderHistory?: ProviderHistoryRequester,
  chartType: ProviderChartType = "candlestick",
): Promise<KLineHistoryPage> {
  if (params.type === "init") {
    return {
      data: toKLineData(session, chartType),
      more: {
        forward:
          requestProviderHistory !== undefined && session.candles.length > 0,
        backward: false,
      },
    };
  }
  if (
    params.type !== "forward" ||
    params.timestamp === null ||
    requestProviderHistory === undefined
  ) {
    return { data: [], more: { forward: false, backward: false } };
  }

  const timestamp = params.timestamp;
  const toMs = Math.max(0, timestamp - 1);
  if (toMs === 0) {
    return { data: [], more: { forward: false, backward: false } };
  }
  const durationMs = timeframeDurationMs(session.timeframeId);
  const fromMs = Math.max(0, toMs - durationMs * providerHistoryPageSize);
  const candles = await requestProviderHistory({
    profileId: session.profileId,
    instrumentId: session.instrument.id,
    timeframeId: session.timeframeId,
    fromMs,
    toMs,
    limit: providerHistoryPageSize,
  });
  const olderCandles = candles
    .filter((candle) => candle.openTimeMs < timestamp)
    .sort((left, right) => left.openTimeMs - right.openTimeMs)
    .slice(-providerHistoryPageSize);
  return {
    data:
      chartType === "heikin_ashi"
        ? toHeikinAshiData(olderCandles)
        : olderCandles.map(toKLineCandle),
    more: {
      forward: olderCandles.length >= providerHistoryPageSize && fromMs > 0,
      backward: false,
    },
  };
}

export function applyProviderChartType(
  chart: Pick<Chart, "setStyles">,
  chartType: ProviderChartType,
): void {
  if (chartType === "candlestick" || chartType === "heikin_ashi") {
    chart.setStyles({ candle: { type: "candle_solid" } });
    return;
  }
  if (chartType === "line") {
    chart.setStyles({
      candle: {
        type: "area",
        area: {
          backgroundColor: "rgba(0, 0, 0, 0)",
          point: { show: false },
        },
      },
    });
    return;
  }
  chart.setStyles({
    candle: {
      type: "area",
      area: {
        backgroundColor: [
          { offset: 0, color: "rgba(33, 150, 243, 0.01)" },
          { offset: 1, color: "rgba(33, 150, 243, 0.2)" },
        ],
        point: { show: true },
      },
    },
  });
}

function sessionDataKey(session: ImportedProviderSession): string {
  return [
    session.profileId,
    session.instrument.id,
    session.instrument.symbol,
    session.timeframeId,
  ].join("\u0000");
}

export function ProviderChart({
  session,
  chartType = "candlestick",
  onChartTypeChange,
  requestProviderHistory,
  subscribeProviderData,
  selectedTimeframeId = session.timeframeId,
  availableTimeframeIds = [session.timeframeId],
  timeframeLoading = false,
  onTimeframeChange,
  indicators = [],
  installedIndicators = [],
  onIndicatorImport,
  syncIndicator,
  disposeIndicator,
  onIndicatorAdd,
  onIndicatorUpdate,
  onIndicatorEnabledChange,
  onIndicatorRemove,
}: ProviderChartProps): JSX.Element {
  const providerChartRoot = useRef<HTMLElement>(null);
  const chartRoot = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<Chart | undefined>(undefined);
  const latestSession = useRef(session);
  const latestRequestProviderHistory = useRef(requestProviderHistory);
  const latestChartType = useRef(chartType);
  const appliedChartType = useRef<ProviderChartType | undefined>(undefined);
  const appliedChartSessionKey = useRef<string | undefined>(undefined);
  const dataLoadGeneration = useRef(0);
  const lastAppliedSeries = useRef<ProviderSeriesChange | undefined>(undefined);
  const latestIndicators = useRef(indicators);
  const latestInstalledIndicators = useRef(installedIndicators);
  const latestSyncIndicator = useRef(syncIndicator);
  const latestDisposeIndicator = useRef(disposeIndicator);
  const latestIndicatorCallbacks = useRef({
    onIndicatorEnabledChange,
    onIndicatorRemove,
  });
  const managedRuntimeIds = useRef<ReadonlySet<string>>(new Set());
  const pluginManagedRuntimeIds = useRef<ReadonlySet<string>>(new Set());
  const ownerByRuntimeId = useRef<ReadonlyMap<string, string>>(new Map());
  const klineModule = useRef<typeof import("klinecharts") | undefined>(
    undefined,
  );
  const updateData = useRef<((data: KLineData) => void) | undefined>(undefined);
  const lastAppliedOpenTimeMs = useRef<number | undefined>(undefined);
  const authoritativeResetCandles = useRef<readonly Candle[] | undefined>(
    undefined,
  );
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [chartSettingsOpen, setChartSettingsOpen] = useState(false);
  const [timezone, setTimezone] = useState("Etc/UTC");
  const [fullscreen, setFullscreen] = useState(false);
  const [settingsInstanceId, setSettingsInstanceId] = useState<
    string | undefined
  >();
  const [settingsDraft, setSettingsDraft] = useState<IndicatorSettingsDraft>(
    {},
  );
  const [settingsTab, setSettingsTab] =
    useState<IndicatorSettingsTab>("inputs");
  const [collapsedSettingsGroups, setCollapsedSettingsGroups] = useState<
    Readonly<Record<string, boolean>>
  >({});
  latestSession.current = session;
  latestRequestProviderHistory.current = requestProviderHistory;
  latestChartType.current = chartType;
  latestIndicators.current = indicators;
  latestInstalledIndicators.current = installedIndicators;
  latestSyncIndicator.current = syncIndicator;
  latestDisposeIndicator.current = disposeIndicator;
  latestIndicatorCallbacks.current = {
    onIndicatorEnabledChange,
    onIndicatorRemove,
  };
  const localTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  const timezoneOptions =
    localTimezone === "Etc/UTC" ? ["Etc/UTC"] : ["Etc/UTC", localTimezone];
  const timeframeOptions = availableTimeframeIds.includes(selectedTimeframeId)
    ? availableTimeframeIds
    : [...availableTimeframeIds, selectedTimeframeId];
  const settingsIndicator =
    settingsInstanceId === undefined
      ? undefined
      : indicators.find(
          (indicator) => indicator.instanceId === settingsInstanceId,
        );
  const settingsBuiltInDefinition =
    settingsIndicator === undefined
      ? undefined
      : settingsIndicator.pluginId === builtInIndicatorPluginId
        ? getBuiltInIndicatorDefinition(settingsIndicator.definitionId)
        : undefined;
  const settingsPluginSummary =
    settingsIndicator === undefined ||
    settingsIndicator.pluginId === builtInIndicatorPluginId
      ? undefined
      : installedIndicators.find(
          (summary) =>
            summary.pluginId === settingsIndicator.pluginId &&
            summary.definition.id === settingsIndicator.definitionId,
        );
  const settingsFields =
    settingsBuiltInDefinition !== undefined
      ? builtInSettingsFields(settingsBuiltInDefinition)
      : settingsPluginSummary === undefined
        ? []
        : pluginIndicatorSettingsFields(settingsPluginSummary.definition);
  const settingsName =
    settingsBuiltInDefinition?.name ?? settingsPluginSummary?.definition.name;
  const inputSettingsGroups = groupIndicatorSettingsFields(
    settingsFields,
    "inputs",
  );
  const styleSettingsGroups = groupIndicatorSettingsFields(
    settingsFields,
    "style",
  );
  const activeSettingsGroups =
    settingsTab === "inputs" ? inputSettingsGroups : styleSettingsGroups;

  const openIndicatorSettings = (instanceId: string): void => {
    const indicator = latestIndicators.current.find(
      (candidate) => candidate.instanceId === instanceId,
    );
    if (indicator === undefined) return;
    const parameters = normalizeBuiltInIndicatorParameters(indicator);
    const pluginSummary =
      parameters === undefined
        ? latestInstalledIndicators.current.find(
            (summary) =>
              summary.pluginId === indicator.pluginId &&
              summary.definition.id === indicator.definitionId,
          )
        : undefined;
    const normalized =
      parameters ??
      (pluginSummary === undefined
        ? undefined
        : normalizePluginIndicatorParameters(
            indicator,
            pluginSummary.definition,
          ));
    if (normalized === undefined) return;
    setSettingsDraft(
      Object.fromEntries(
        Object.entries(normalized).map(([key, value]) => [key, String(value)]),
      ),
    );
    const builtInDefinition =
      parameters === undefined
        ? undefined
        : getBuiltInIndicatorDefinition(indicator.definitionId);
    const availableFields =
      builtInDefinition !== undefined
        ? builtInSettingsFields(builtInDefinition)
        : pluginSummary === undefined
          ? []
          : pluginIndicatorSettingsFields(pluginSummary.definition);
    setSettingsTab(
      availableFields.some((field) => field.effect !== "presentation")
        ? "inputs"
        : "style",
    );
    setCollapsedSettingsGroups({});
    setSettingsInstanceId(instanceId);
    setIndicatorMenuOpen(false);
  };

  useEffect(() => {
    const element = chartRoot.current;
    if (element === null) return;
    let disposed = false;
    let destroy: (() => void) | undefined;
    updateData.current = undefined;
    lastAppliedOpenTimeMs.current = undefined;
    void import("klinecharts").then((module) => {
      if (disposed) return;
      klineModule.current = module;
      registerApplicationBuiltInIndicators(module);
      const chart = module.init(element);
      if (chart === null) return;
      chartInstance.current = chart;
      managedRuntimeIds.current = new Set();
      pluginManagedRuntimeIds.current = new Set();
      ownerByRuntimeId.current = new Map();
      const onIndicatorTooltipFeatureClick = (value?: unknown): void => {
        if (!isIndicatorTooltipFeatureClick(value)) return;
        const ownerInstanceId = ownerByRuntimeId.current.get(
          value.indicator.id,
        );
        if (ownerInstanceId === undefined) return;
        const indicator = latestIndicators.current.find(
          (candidate) => candidate.instanceId === ownerInstanceId,
        );
        if (indicator === undefined) return;
        switch (value.feature.id) {
          case "erc-visible":
            latestIndicatorCallbacks.current.onIndicatorEnabledChange?.(
              ownerInstanceId,
              !indicator.enabled,
            );
            break;
          case "erc-settings":
            openIndicatorSettings(ownerInstanceId);
            break;
          case "erc-remove":
            latestIndicatorCallbacks.current.onIndicatorRemove?.(
              ownerInstanceId,
            );
            break;
        }
      };
      chart.subscribeAction(
        "onIndicatorTooltipFeatureClick",
        onIndicatorTooltipFeatureClick,
      );
      destroy = (): void => {
        chart.unsubscribeAction(
          "onIndicatorTooltipFeatureClick",
          onIndicatorTooltipFeatureClick,
        );
        if (chartInstance.current === chart) chartInstance.current = undefined;
        managedRuntimeIds.current = new Set();
        const pluginInstanceIds = [...pluginManagedRuntimeIds.current];
        pluginManagedRuntimeIds.current = new Set();
        disposePluginIndicatorContexts(pluginInstanceIds);
        for (const instanceId of pluginInstanceIds) {
          void latestDisposeIndicator
            .current?.(instanceId)
            .catch(() => undefined);
        }
        ownerByRuntimeId.current = new Map();
        if (klineModule.current === module) klineModule.current = undefined;
        appliedChartSessionKey.current = undefined;
        module.dispose(chart);
      };
      chart.setStyles({
        grid: {
          horizontal: {
            color: "rgba(120, 139, 160, 0.16)",
          },
          vertical: {
            color: "rgba(120, 139, 160, 0.16)",
          },
        },
        indicator: {
          tooltip: {
            title: {
              showParams: false,
            },
            features: [
              {
                id: "erc-visible",
                position: "middle",
                type: "icon_font",
                content: { family: "Segoe UI Symbol", code: "◉" },
                color: "#78879b",
                activeColor: "#d7e4f3",
                size: 11,
              },
              {
                id: "erc-settings",
                position: "middle",
                type: "icon_font",
                content: { family: "Segoe UI Symbol", code: "⚙" },
                color: "#78879b",
                activeColor: "#d7e4f3",
                size: 11,
              },
              {
                id: "erc-remove",
                position: "middle",
                type: "icon_font",
                content: { family: "Segoe UI Symbol", code: "×" },
                color: "#78879b",
                activeColor: "#d7e4f3",
                size: 13,
              },
            ],
          },
        },
      });
      applyProviderChartType(chart, latestChartType.current);
      appliedChartType.current = latestChartType.current;
      const initialSession = latestSession.current;
      lastAppliedOpenTimeMs.current = initialSession.candles.at(-1)?.openTimeMs;
      chart.setSymbol({
        ticker: initialSession.instrument.symbol,
        pricePrecision: 8,
        volumePrecision: 2,
      });
      chart.setPeriod(periodForTimeframe(initialSession.timeframeId));
      appliedChartSessionKey.current = sessionDataKey(initialSession);
      dataLoadGeneration.current += 1;
      chart.setDataLoader({
        getBars: async (params): Promise<void> => {
          const requestSession = latestSession.current;
          const requestKey = sessionDataKey(requestSession);
          const requestGeneration = dataLoadGeneration.current;
          const resetCandles =
            params.type === "init"
              ? authoritativeResetCandles.current
              : undefined;
          const dataSession =
            resetCandles === undefined
              ? {
                  ...requestSession,
                  candles: providerChartSessionCandles(requestSession),
                }
              : { ...requestSession, candles: resetCandles };
          try {
            const page = await loadKLineHistoryPage(
              params,
              dataSession,
              latestRequestProviderHistory.current,
              latestChartType.current,
            );
            if (
              disposed ||
              dataLoadGeneration.current !== requestGeneration ||
              sessionDataKey(latestSession.current) !== requestKey
            ) {
              return;
            }
            if (params.type === "init" && requestSession.series !== undefined) {
              markPluginIndicatorSeriesChange(chart, {
                ...requestSession.series,
                kind: "rebuild",
              });
              lastAppliedSeries.current = requestSession.series;
            }
            params.callback(page.data, page.more);
            if (
              resetCandles !== undefined &&
              authoritativeResetCandles.current === resetCandles
            ) {
              authoritativeResetCandles.current = undefined;
            }
          } catch {
            if (
              !disposed &&
              dataLoadGeneration.current === requestGeneration &&
              sessionDataKey(latestSession.current) === requestKey
            ) {
              params.callback([], false);
            }
          }
        },
        subscribeBar: ({ callback }): void => {
          updateData.current = callback;
          applyCachedCandles(
            callback,
            latestSession.current.liveCandle === undefined
              ? latestSession.current.candles
              : [latestSession.current.liveCandle],
            lastAppliedOpenTimeMs,
            latestChartType.current,
            chart.getDataList(),
          );
        },
        unsubscribeBar: (): void => {
          updateData.current = undefined;
        },
      });
      const reconciliation = reconcileBuiltInIndicators(
        chart,
        latestIndicators.current,
        managedRuntimeIds.current,
      );
      managedRuntimeIds.current = reconciliation.managedRuntimeIds;
      const pluginReconciliation = reconcilePluginIndicators(
        module,
        chart,
        latestIndicators.current,
        latestInstalledIndicators.current,
        latestSyncIndicator.current,
        initialSession.instrument.id,
        initialSession.timeframeId,
        pluginManagedRuntimeIds.current,
        initialSession.profileId,
      );
      pluginManagedRuntimeIds.current = pluginReconciliation.managedRuntimeIds;
      for (const instanceId of pluginReconciliation.removedInstanceIds) {
        void latestDisposeIndicator
          .current?.(instanceId)
          .catch(() => undefined);
      }
      ownerByRuntimeId.current = new Map([
        ...reconciliation.ownerByRuntimeId,
        ...pluginReconciliation.ownerByRuntimeId,
      ]);
    });
    return (): void => {
      disposed = true;
      updateData.current = undefined;
      destroy?.();
    };
  }, []);

  useEffect(() => {
    const chart = chartInstance.current;
    if (chart === undefined) return;
    const nextKey = sessionDataKey(session);
    if (appliedChartSessionKey.current === nextKey) return;
    const previous = appliedChartSessionKey.current?.split("\u0000");
    const symbolChanged =
      previous === undefined ||
      previous[0] !== session.profileId ||
      previous[1] !== session.instrument.id ||
      previous[2] !== session.instrument.symbol;
    const timeframeChanged =
      previous === undefined || previous[3] !== session.timeframeId;
    lastAppliedOpenTimeMs.current = session.candles.at(-1)?.openTimeMs;
    authoritativeResetCandles.current = undefined;
    lastAppliedSeries.current = undefined;
    appliedChartSessionKey.current = nextKey;
    if (symbolChanged) {
      dataLoadGeneration.current += 1;
      chart.setSymbol({
        ticker: session.instrument.symbol,
        pricePrecision: 8,
        volumePrecision: 2,
      });
    }
    if (timeframeChanged) {
      dataLoadGeneration.current += 1;
      chart.setPeriod(periodForTimeframe(session.timeframeId));
    }
  }, [
    session.profileId,
    session.instrument.id,
    session.instrument.symbol,
    session.timeframeId,
  ]);

  useEffect(() => {
    const chart = chartInstance.current;
    if (chart === undefined) return;
    if (appliedChartType.current === chartType) return;
    appliedChartType.current = chartType;
    applyProviderChartType(chart, chartType);
    dataLoadGeneration.current += 1;
    lastAppliedOpenTimeMs.current = undefined;
    chart.resetData();
  }, [chartType]);

  useEffect(() => {
    chartInstance.current?.setTimezone(timezone);
  }, [timezone]);

  useEffect(() => {
    const onFullscreenChange = (): void => {
      setFullscreen(document.fullscreenElement === providerChartRoot.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return (): void =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (subscribeProviderData === undefined) return;
    let disposed = false;
    let unsubscribeProviderData: (() => Promise<void>) | undefined;
    void subscribeProviderData(
      {
        profileId: session.profileId,
        instrumentId: session.instrument.id,
        timeframeId: session.timeframeId,
      },
      (event): void => {
        if (disposed || event.type !== "candles") return;
        const incrementalUpdate = updateData.current;
        const chart = chartInstance.current;
        if (incrementalUpdate !== undefined && chart !== undefined) {
          markPluginIndicatorSeriesChange(chart, event.series);
          applyProviderSeriesUpdate(
            chart,
            incrementalUpdate,
            event.candles,
            event.series,
            latestChartType.current,
            lastAppliedOpenTimeMs,
            authoritativeResetCandles,
            dataLoadGeneration,
          );
        }
      },
    )
      .then((unsubscribe) => {
        if (disposed) {
          void unsubscribe().catch(() => undefined);
          return;
        }
        unsubscribeProviderData = unsubscribe;
      })
      .catch(() => undefined);
    return (): void => {
      disposed = true;
      void unsubscribeProviderData?.().catch(() => undefined);
    };
  }, [
    subscribeProviderData,
    session.profileId,
    session.instrument.id,
    session.timeframeId,
  ]);

  useEffect(() => {
    const chart = chartInstance.current;
    const module = klineModule.current;
    if (chart === undefined || module === undefined) return;
    const reconciliation = reconcileBuiltInIndicators(
      chart,
      indicators,
      managedRuntimeIds.current,
    );
    managedRuntimeIds.current = reconciliation.managedRuntimeIds;
    const pluginReconciliation = reconcilePluginIndicators(
      module,
      chart,
      indicators,
      installedIndicators,
      syncIndicator,
      session.instrument.id,
      session.timeframeId,
      pluginManagedRuntimeIds.current,
      session.profileId,
    );
    pluginManagedRuntimeIds.current = pluginReconciliation.managedRuntimeIds;
    for (const instanceId of pluginReconciliation.removedInstanceIds) {
      void disposeIndicator?.(instanceId).catch(() => undefined);
    }
    ownerByRuntimeId.current = new Map([
      ...reconciliation.ownerByRuntimeId,
      ...pluginReconciliation.ownerByRuntimeId,
    ]);
  }, [
    indicators,
    installedIndicators,
    syncIndicator,
    disposeIndicator,
    session.profileId,
    session.instrument.id,
    session.timeframeId,
  ]);

  useEffect(() => {
    const incrementalUpdate = updateData.current;
    const chart = chartInstance.current;
    if (incrementalUpdate === undefined || chart === undefined) return;
    const series = session.series;
    if (series !== undefined) {
      const previous = lastAppliedSeries.current;
      if (
        previous !== undefined &&
        series.generation === previous.generation &&
        series.revision <= previous.revision
      )
        return;
      // The session retains corrections across React batches; multiple revisions alone are not a correction.
      const change: ProviderSeriesChange =
        previous === undefined ||
        series.generation !== previous.generation ||
        (session.rebuildRevision === undefined
          ? (series.previousRevision ?? series.revision - 1) !==
            previous.revision
          : session.rebuildRevision > previous.revision)
          ? {
              ...series,
              kind: "rebuild",
              dirtyFromOpenTimeMs:
                session.candles[0]?.openTimeMs ??
                series.dirtyFromOpenTimeMs ??
                0,
            }
          : series;
      lastAppliedSeries.current = series;
      markPluginIndicatorSeriesChange(chart, change);
      if (change.kind === "rebuild") {
        applyProviderSeriesUpdate(
          chart,
          incrementalUpdate,
          providerChartSessionCandles(session),
          change,
          chartType,
          lastAppliedOpenTimeMs,
          authoritativeResetCandles,
          dataLoadGeneration,
        );
        return;
      }
    }
    applyCachedCandles(
      incrementalUpdate,
      session.liveCandle === undefined ? session.candles : [session.liveCandle],
      lastAppliedOpenTimeMs,
      chartType,
      chart.getDataList(),
    );
  }, [
    chartType,
    session.candles,
    session.series,
    session.liveCandle,
    session.rebuildRevision,
  ]);

  const setChartType = (nextChartType: ProviderChartType): void => {
    const chart = chartInstance.current;
    if (chart !== undefined) applyProviderChartType(chart, nextChartType);
    onChartTypeChange?.(nextChartType);
    setChartSettingsOpen(false);
  };

  const saveScreenshot = (): void => {
    const chart = chartInstance.current;
    if (chart === undefined) return;
    const anchor = document.createElement("a");
    anchor.href = chart.getConvertPictureUrl(true, "png", "#090f19");
    anchor.download = `${session.instrument.symbol}-${session.timeframeId}.png`;
    anchor.click();
  };

  const resetChartView = (): void => {
    const chart = chartInstance.current;
    if (chart === undefined) return;
    resetProviderChartView(chart);
  };

  const panChartView = (direction: "left" | "right"): void => {
    const chart = chartInstance.current;
    if (chart === undefined) return;
    panProviderChartView(chart, direction);
  };

  const zoomChartView = (direction: "in" | "out"): void => {
    const chart = chartInstance.current;
    if (chart === undefined) return;
    zoomProviderChartView(chart, direction);
  };

  const toggleFullscreen = (): void => {
    const root = providerChartRoot.current;
    if (root === null) return;
    if (document.fullscreenElement === root) {
      void document.exitFullscreen();
      return;
    }
    void root.requestFullscreen();
  };

  return (
    <section
      ref={providerChartRoot}
      className="provider-chart"
      aria-label="Provider market data"
    >
      <header className="provider-chart-heading">
        <div className="provider-symbol-control">
          <span className="provider-symbol-badge" aria-hidden="true">
            {session.providerName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{session.instrument.symbol}</strong>
            <small>{session.providerName}</small>
          </div>
        </div>

        {onTimeframeChange === undefined ||
        timeframeOptions.length < 2 ? null : (
          <div
            className="provider-timeframe-group"
            role="group"
            aria-label={`Timeframe for ${session.instrument.symbol}`}
          >
            <select
              className="provider-timeframe-select"
              aria-label={`Timeframe for ${session.instrument.symbol}`}
              value={selectedTimeframeId}
              onChange={(event) => onTimeframeChange(event.currentTarget.value)}
            >
              {timeframeOptions.map((timeframeId) => (
                <option value={timeframeId} key={timeframeId}>
                  {timeframeId}
                </option>
              ))}
            </select>
            {timeframeOptions.map((timeframeId) => (
              <button
                type="button"
                key={timeframeId}
                className={
                  timeframeId === selectedTimeframeId
                    ? "provider-timeframe-button active"
                    : "provider-timeframe-button"
                }
                aria-pressed={timeframeId === selectedTimeframeId}
                disabled={
                  timeframeLoading && timeframeId === selectedTimeframeId
                }
                onClick={() => onTimeframeChange(timeframeId)}
              >
                {timeframeId}
              </button>
            ))}
          </div>
        )}

        <div className="provider-chart-controls">
          {onIndicatorAdd === undefined ? null : (
            <div className="provider-indicator-control">
              <button
                type="button"
                className="provider-toolbar-button provider-indicator-button"
                aria-haspopup="menu"
                aria-expanded={indicatorMenuOpen}
                onClick={() => {
                  setIndicatorMenuOpen((open) => !open);
                  setChartSettingsOpen(false);
                }}
              >
                <ProviderToolbarIcon name="indicator" />
                Indicator
              </button>
              {indicatorMenuOpen ? (
                <div
                  className="provider-indicator-menu"
                  role="menu"
                  aria-label="Indicators"
                >
                  <div className="provider-indicator-menu-heading">
                    <strong>Built-in indicators</strong>
                    <span>
                      {indicators.length}/{maximumIndicatorsPerWorkspace}
                    </span>
                  </div>
                  {builtInIndicatorDefinitions.map((definition) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={definition.id}
                      disabled={
                        indicators.length >= maximumIndicatorsPerWorkspace
                      }
                      onClick={() => {
                        onIndicatorAdd(
                          createBuiltInWorkspaceIndicator(
                            definition.id,
                            createBuiltInIndicatorInstanceId(definition.id),
                          ),
                        );
                        setIndicatorMenuOpen(false);
                      }}
                    >
                      <span>{definition.name}</span>
                      <small>{definition.description}</small>
                    </button>
                  ))}
                  {installedIndicators.length === 0 ? null : (
                    <>
                      <div className="provider-indicator-menu-heading">
                        <strong>Installed indicators</strong>
                      </div>
                      {installedIndicators.map((summary) => (
                        <button
                          type="button"
                          role="menuitem"
                          key={`${summary.pluginId}:${summary.definition.id}`}
                          disabled={
                            indicators.length >= maximumIndicatorsPerWorkspace
                          }
                          onClick={() => {
                            onIndicatorAdd(
                              createPluginWorkspaceIndicator(
                                summary,
                                createPluginIndicatorInstanceId(
                                  summary.pluginId,
                                  summary.definition.id,
                                ),
                              ),
                            );
                            setIndicatorMenuOpen(false);
                          }}
                        >
                          <span>{summary.definition.name}</span>
                          <small>
                            {summary.pluginName} · {summary.version}
                          </small>
                        </button>
                      ))}
                    </>
                  )}
                  {onIndicatorImport === undefined ? null : (
                    <button
                      type="button"
                      role="menuitem"
                      className="provider-indicator-import"
                      onClick={() => {
                        setIndicatorMenuOpen(false);
                        onIndicatorImport();
                      }}
                    >
                      <span>Import indicator…</span>
                      <small>Install an ERC Chart indicator package</small>
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          )}

          <label className="provider-timezone-control">
            <span className="visually-hidden">Timezone</span>
            <ProviderToolbarIcon name="timezone" />
            <select
              value={timezone}
              aria-label="Chart timezone"
              onChange={(event) => setTimezone(event.currentTarget.value)}
            >
              {timezoneOptions.map((value) => (
                <option key={value} value={value}>
                  {value === "Etc/UTC"
                    ? "Timezone · UTC"
                    : `Timezone · ${value}`}
                </option>
              ))}
            </select>
          </label>

          <div className="provider-chart-settings-control">
            <button
              type="button"
              className="provider-toolbar-button"
              aria-haspopup="menu"
              aria-expanded={chartSettingsOpen}
              onClick={() => {
                setChartSettingsOpen((open) => !open);
                setIndicatorMenuOpen(false);
              }}
            >
              <ProviderToolbarIcon name="settings" />
              Setting
            </button>
            {chartSettingsOpen ? (
              <div className="provider-chart-settings-menu" role="menu">
                <p>Chart type</p>
                {(["candlestick", "heikin_ashi", "line", "area"] as const).map(
                  (value) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={chartType === value}
                      className={chartType === value ? "active" : undefined}
                      key={value}
                      onClick={() => setChartType(value)}
                    >
                      {value === "candlestick"
                        ? "Candles"
                        : value === "heikin_ashi"
                          ? "Heikin-Ashi"
                          : value === "line"
                            ? "Line"
                            : "Area"}
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="provider-toolbar-button provider-screenshot-button"
            onClick={saveScreenshot}
          >
            <ProviderToolbarIcon name="screenshot" />
            Screenshot
          </button>
          <button
            type="button"
            className="provider-toolbar-button provider-fullscreen-button"
            onClick={toggleFullscreen}
          >
            <ProviderToolbarIcon
              name={fullscreen ? "exit-fullscreen" : "fullscreen"}
            />
            {fullscreen ? "Exit" : "Fullscreen"}
          </button>
        </div>
      </header>

      <div className="provider-chart-body">
        <aside className="provider-drawing-toolbar" aria-label="Drawing tools">
          {coreDrawingTools.map((tool) => (
            <button
              type="button"
              key={tool.name}
              title={tool.label}
              aria-label={tool.label}
              onClick={() => chartInstance.current?.createOverlay(tool.name)}
            >
              <span aria-hidden="true">{tool.glyph}</span>
            </button>
          ))}
          <button
            type="button"
            className="provider-drawing-clear"
            title="Clear drawings"
            aria-label="Clear drawings"
            onClick={() => chartInstance.current?.removeOverlay()}
          >
            <span aria-hidden="true">×</span>
          </button>
        </aside>
        <div className="provider-chart-stage">
          <div
            ref={chartRoot}
            className="provider-chart-canvas"
            data-provider-chart
            aria-label={`${session.instrument.symbol} ${session.timeframeId} ${chartType === "heikin_ashi" ? "Heikin-Ashi" : chartType} chart`}
          />
        </div>
        <div
          className="provider-chart-navigation"
          role="group"
          aria-label="Chart navigation"
        >
          <button
            type="button"
            title="Pan chart left"
            aria-label="Pan chart left"
            onClick={() => panChartView("left")}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M15 6l-6 6 6 6" />
              <path d="M9 12h10" />
            </svg>
          </button>
          <button
            type="button"
            title="Go to latest candles"
            aria-label="Go to latest candles"
            onClick={resetChartView}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M6.2 9.2A6.8 6.8 0 0 1 17.8 7.3" />
              <path d="M17.8 7.3V4.2" />
              <path d="M17.8 7.3h-3.1" />
              <path d="M17.8 14.8A6.8 6.8 0 0 1 6.2 16.7" />
              <path d="M6.2 16.7v3.1" />
              <path d="M6.2 16.7h3.1" />
            </svg>
          </button>
          <button
            type="button"
            title="Pan chart right"
            aria-label="Pan chart right"
            onClick={() => panChartView("right")}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M9 6l6 6-6 6" />
              <path d="M5 12h10" />
            </svg>
          </button>
          <button
            type="button"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => zoomChartView("out")}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="10.5" cy="10.5" r="5.5" />
              <path d="M7.5 10.5h6" />
              <path d="M15 15l4 4" />
            </svg>
          </button>
          <button
            type="button"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => zoomChartView("in")}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="10.5" cy="10.5" r="5.5" />
              <path d="M7.5 10.5h6" />
              <path d="M10.5 7.5v6" />
              <path d="M15 15l4 4" />
            </svg>
          </button>
        </div>
      </div>
      {settingsIndicator === undefined || settingsName === undefined ? null : (
        <div
          className="provider-indicator-settings"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`indicator-settings-${settingsIndicator.instanceId}`}
        >
          <div className="provider-indicator-settings-header">
            <div>
              <p>Indicator settings</p>
              <h3 id={`indicator-settings-${settingsIndicator.instanceId}`}>
                {settingsName}
              </h3>
            </div>
            <button
              type="button"
              aria-label="Close indicator settings"
              onClick={() => setSettingsInstanceId(undefined)}
            >
              ×
            </button>
          </div>
          <div className="provider-indicator-settings-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={settingsTab === "inputs"}
              className={settingsTab === "inputs" ? "active" : undefined}
              onClick={() => setSettingsTab("inputs")}
            >
              Inputs
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={settingsTab === "style"}
              className={settingsTab === "style" ? "active" : undefined}
              onClick={() => setSettingsTab("style")}
            >
              Style
            </button>
          </div>
          <div className="provider-indicator-settings-scroll" role="tabpanel">
            {activeSettingsGroups.length === 0 ? (
              <p className="provider-indicator-settings-empty">
                No {settingsTab === "inputs" ? "input" : "style"} settings.
              </p>
            ) : (
              activeSettingsGroups.map((group) => {
                const collapseKey = `${settingsTab}:${group.name}`;
                const collapsed = collapsedSettingsGroups[collapseKey] === true;
                return (
                  <section
                    className="provider-indicator-settings-group"
                    key={collapseKey}
                  >
                    <button
                      type="button"
                      className="provider-indicator-settings-group-toggle"
                      aria-expanded={!collapsed}
                      onClick={() =>
                        setCollapsedSettingsGroups((current) => ({
                          ...current,
                          [collapseKey]: !collapsed,
                        }))
                      }
                    >
                      <span>{group.name}</span>
                      <span aria-hidden="true">{collapsed ? "+" : "−"}</span>
                    </button>
                    {collapsed ? null : (
                      <div className="provider-indicator-settings-fields">
                        {group.fields.map((parameter) => (
                          <label key={parameter.key}>
                            <span>{parameter.label}</span>
                            {parameter.description === undefined ? null : (
                              <small>{parameter.description}</small>
                            )}
                            {parameter.type === "number" ? (
                              <input
                                type="number"
                                min={parameter.min}
                                max={parameter.max}
                                step={parameter.step}
                                value={settingsDraft[parameter.key] ?? ""}
                                onChange={(event) =>
                                  queueIndicatorSettingsDraftChange(
                                    parameter.key,
                                    event,
                                    setSettingsDraft,
                                  )
                                }
                              />
                            ) : parameter.type === "boolean" ? (
                              <select
                                value={
                                  settingsDraft[parameter.key] ??
                                  String(parameter.defaultValue)
                                }
                                onChange={(event) =>
                                  queueIndicatorSettingsDraftChange(
                                    parameter.key,
                                    event,
                                    setSettingsDraft,
                                  )
                                }
                              >
                                <option value="true">On</option>
                                <option value="false">Off</option>
                              </select>
                            ) : parameter.options !== undefined ? (
                              <select
                                value={
                                  settingsDraft[parameter.key] ??
                                  String(parameter.defaultValue)
                                }
                                onChange={(event) =>
                                  queueIndicatorSettingsDraftChange(
                                    parameter.key,
                                    event,
                                    setSettingsDraft,
                                  )
                                }
                              >
                                {parameter.options.map((option) => (
                                  <option
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={settingsDraft[parameter.key] ?? ""}
                                onChange={(event) =>
                                  queueIndicatorSettingsDraftChange(
                                    parameter.key,
                                    event,
                                    setSettingsDraft,
                                  )
                                }
                              />
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })
            )}
          </div>
          <div className="provider-indicator-settings-actions">
            <button
              type="button"
              onClick={() => setSettingsInstanceId(undefined)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                const updated =
                  settingsBuiltInDefinition !== undefined
                    ? updateBuiltInIndicatorParameters(
                        settingsIndicator,
                        settingsDraft,
                      )
                    : settingsPluginSummary === undefined
                      ? undefined
                      : updatePluginIndicatorParameters(
                          settingsIndicator,
                          settingsPluginSummary.definition,
                          settingsDraft,
                        );
                if (updated !== undefined) onIndicatorUpdate?.(updated);
                setSettingsInstanceId(undefined);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function applyCachedCandles(
  updateData: (data: KLineData) => void,
  candles: readonly Candle[],
  lastAppliedOpenTimeMs: { current: number | undefined },
  chartType: ProviderChartType,
  existingData: readonly KLineData[] = [],
): void {
  if (candles.length === 0) return;
  const lastApplied = lastAppliedOpenTimeMs.current;
  let firstRelevantIndex = candles.length;
  while (
    firstRelevantIndex > 0 &&
    (lastApplied === undefined ||
      (candles[firstRelevantIndex - 1]?.openTimeMs ?? -1) >= lastApplied)
  ) {
    firstRelevantIndex -= 1;
  }
  if (firstRelevantIndex === candles.length) return;
  updateChartData(
    updateData,
    candles.slice(firstRelevantIndex),
    chartType,
    existingData,
  );
  lastAppliedOpenTimeMs.current = candles.at(-1)?.openTimeMs;
}
