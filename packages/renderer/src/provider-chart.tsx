import type {
  Candle,
  ImportedProviderSession,
  ProviderLiveEvent,
  ProviderLiveRequest,
  WorkspaceIndicator,
} from "@erc-chart/contracts";
import { useEffect, useRef, useState, type JSX } from "react";
import type {
  Chart,
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
} from "./builtin-indicators.js";
import { registerApplicationBuiltInIndicators } from "./kline-builtins.js";
import { maximumIndicatorsPerWorkspace } from "./workspace.js";

export type ProviderDataSubscriber = (
  request: ProviderLiveRequest,
  listener: (event: ProviderLiveEvent) => void,
) => Promise<() => Promise<void>>;

export interface ProviderChartProps {
  readonly session: ImportedProviderSession;
  readonly subscribeProviderData?: ProviderDataSubscriber | undefined;
  readonly selectedTimeframeId?: string | undefined;
  readonly availableTimeframeIds?: readonly string[] | undefined;
  readonly timeframeLoading?: boolean | undefined;
  readonly onTimeframeChange?: ((timeframeId: string) => void) | undefined;
  readonly indicators?: readonly WorkspaceIndicator[] | undefined;
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

function periodForTimeframe(timeframeId: string): Period {
  const match = /^(\d+)(s|m|h|d)$/u.exec(timeframeId);
  if (match === null) return { type: "minute", span: 1 };
  const span = Number(match[1]);
  const unit = match[2];
  return {
    type:
      unit === "s"
        ? "second"
        : unit === "m"
          ? "minute"
          : unit === "h"
            ? "hour"
            : "day",
    span,
  };
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

export function updateChartData(
  updateData: (data: KLineData) => void,
  candles: readonly Candle[],
): void {
  for (const candle of candles) updateData(toKLineCandle(candle));
}

function toKLineData(session: ImportedProviderSession): KLineData[] {
  return session.candles.map(toKLineCandle);
}

export function ProviderChart({
  session,
  subscribeProviderData,
  selectedTimeframeId = session.timeframeId,
  availableTimeframeIds = [session.timeframeId],
  timeframeLoading = false,
  onTimeframeChange,
  indicators = [],
  onIndicatorAdd,
  onIndicatorUpdate,
  onIndicatorEnabledChange,
  onIndicatorRemove,
}: ProviderChartProps): JSX.Element {
  const chartRoot = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<Chart | undefined>(undefined);
  const latestSession = useRef(session);
  const latestIndicators = useRef(indicators);
  const latestIndicatorCallbacks = useRef({
    onIndicatorEnabledChange,
    onIndicatorRemove,
  });
  const managedRuntimeIds = useRef<ReadonlySet<string>>(new Set());
  const ownerByRuntimeId = useRef<ReadonlyMap<string, string>>(new Map());
  const updateData = useRef<((data: KLineData) => void) | undefined>(undefined);
  const lastAppliedOpenTimeMs = useRef<number | undefined>(undefined);
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [settingsInstanceId, setSettingsInstanceId] = useState<
    string | undefined
  >();
  const [settingsDraft, setSettingsDraft] = useState<
    Readonly<Record<string, string>>
  >({});
  latestSession.current = session;
  latestIndicators.current = indicators;
  latestIndicatorCallbacks.current = {
    onIndicatorEnabledChange,
    onIndicatorRemove,
  };
  const timeframeOptions = availableTimeframeIds.includes(selectedTimeframeId)
    ? availableTimeframeIds
    : [...availableTimeframeIds, selectedTimeframeId];
  const builtInIndicators = indicators.filter(
    (indicator) => indicator.pluginId === builtInIndicatorPluginId,
  );
  const settingsIndicator =
    settingsInstanceId === undefined
      ? undefined
      : builtInIndicators.find(
          (indicator) => indicator.instanceId === settingsInstanceId,
        );
  const settingsDefinition =
    settingsIndicator === undefined
      ? undefined
      : getBuiltInIndicatorDefinition(settingsIndicator.definitionId);

  const openIndicatorSettings = (instanceId: string): void => {
    const indicator = latestIndicators.current.find(
      (candidate) => candidate.instanceId === instanceId,
    );
    if (indicator === undefined) return;
    const parameters = normalizeBuiltInIndicatorParameters(indicator);
    if (parameters === undefined) return;
    setSettingsDraft(
      Object.fromEntries(
        Object.entries(parameters).map(([key, value]) => [key, String(value)]),
      ),
    );
    setSettingsInstanceId(instanceId);
    setIndicatorMenuOpen(false);
  };

  useEffect(() => {
    const element = chartRoot.current;
    if (element === null) return;
    let disposed = false;
    let destroy: (() => void) | undefined;
    let unsubscribeProviderData: (() => Promise<void>) | undefined;
    updateData.current = undefined;
    lastAppliedOpenTimeMs.current = undefined;
    void import("klinecharts").then((module) => {
      if (disposed) return;
      registerApplicationBuiltInIndicators(module);
      const chart = module.init(element);
      if (chart === null) return;
      chartInstance.current = chart;
      managedRuntimeIds.current = new Set();
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
        ownerByRuntimeId.current = new Map();
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
      const initialSession = latestSession.current;
      const data = toKLineData(initialSession);
      lastAppliedOpenTimeMs.current = initialSession.candles.at(-1)?.openTimeMs;
      chart.setDataLoader({
        getBars: ({ callback }): void => {
          callback(data);
        },
        subscribeBar: ({ callback }): void => {
          updateData.current = callback;
          applyCachedCandles(
            callback,
            latestSession.current.candles,
            lastAppliedOpenTimeMs,
          );
        },
        unsubscribeBar: (): void => {
          updateData.current = undefined;
        },
      });
      chart.setSymbol({
        ticker: initialSession.instrument.symbol,
        pricePrecision: 8,
        volumePrecision: 2,
      });
      chart.setPeriod(periodForTimeframe(initialSession.timeframeId));
      const reconciliation = reconcileBuiltInIndicators(
        chart,
        latestIndicators.current,
        managedRuntimeIds.current,
      );
      managedRuntimeIds.current = reconciliation.managedRuntimeIds;
      ownerByRuntimeId.current = reconciliation.ownerByRuntimeId;
      if (subscribeProviderData !== undefined) {
        void subscribeProviderData(
          {
            profileId: initialSession.profileId,
            instrumentId: initialSession.instrument.id,
            timeframeId: initialSession.timeframeId,
          },
          (event): void => {
            if (disposed || event.type !== "candles") return;
            const incrementalUpdate = updateData.current;
            if (incrementalUpdate !== undefined) {
              updateChartData(incrementalUpdate, event.candles);
              lastAppliedOpenTimeMs.current =
                event.candles.at(-1)?.openTimeMs ??
                lastAppliedOpenTimeMs.current;
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
      }
    });
    return (): void => {
      disposed = true;
      updateData.current = undefined;
      void unsubscribeProviderData?.().catch(() => undefined);
      destroy?.();
    };
  }, [
    session.profileId,
    session.instrument.id,
    session.instrument.symbol,
    session.timeframeId,
    subscribeProviderData,
  ]);

  useEffect(() => {
    const chart = chartInstance.current;
    if (chart === undefined) return;
    const reconciliation = reconcileBuiltInIndicators(
      chart,
      indicators,
      managedRuntimeIds.current,
    );
    managedRuntimeIds.current = reconciliation.managedRuntimeIds;
    ownerByRuntimeId.current = reconciliation.ownerByRuntimeId;
  }, [indicators]);

  useEffect(() => {
    const incrementalUpdate = updateData.current;
    if (incrementalUpdate === undefined) return;
    applyCachedCandles(
      incrementalUpdate,
      session.candles,
      lastAppliedOpenTimeMs,
    );
  }, [session.candles]);

  return (
    <section className="provider-chart" aria-label="Provider market data">
      <header className="provider-chart-heading">
        <div>
          <p className="eyebrow">{session.providerName}</p>
          <h2>{session.instrument.symbol}</h2>
        </div>
        <div className="provider-chart-controls">
          {onTimeframeChange === undefined ||
          timeframeOptions.length < 2 ? null : (
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
          )}
          {onIndicatorAdd === undefined ? null : (
            <div className="provider-indicator-control">
              <button
                type="button"
                className="provider-indicator-button"
                aria-haspopup="menu"
                aria-expanded={indicatorMenuOpen}
                onClick={() => setIndicatorMenuOpen((open) => !open)}
              >
                Indicator
              </button>
              {indicatorMenuOpen ? (
                <div
                  className="provider-indicator-menu"
                  role="menu"
                  aria-label="Built-in indicators"
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
                </div>
              ) : null}
            </div>
          )}
          <span className="provider-chart-meta">
            {timeframeLoading
              ? `${selectedTimeframeId} · loading`
              : `${session.timeframeId} · ${session.candles.length} candles`}
          </span>
        </div>
      </header>
      <div
        ref={chartRoot}
        className="provider-chart-canvas"
        data-provider-chart
        aria-label={`${session.instrument.symbol} ${session.timeframeId} candlestick chart`}
      />
      {settingsIndicator === undefined ||
      settingsDefinition === undefined ? null : (
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
                {settingsDefinition.name}
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
          <div className="provider-indicator-settings-fields">
            {settingsDefinition.parameters.map((parameter) => (
              <label key={parameter.key}>
                <span>{parameter.label}</span>
                {parameter.kind === "number" ? (
                  <input
                    type="number"
                    min={parameter.min}
                    max={parameter.max}
                    step={parameter.step}
                    value={settingsDraft[parameter.key] ?? ""}
                    onChange={(event) =>
                      setSettingsDraft((draft) => ({
                        ...draft,
                        [parameter.key]: event.currentTarget.value,
                      }))
                    }
                  />
                ) : (
                  <select
                    value={
                      settingsDraft[parameter.key] ?? parameter.defaultValue
                    }
                    onChange={(event) =>
                      setSettingsDraft((draft) => ({
                        ...draft,
                        [parameter.key]: event.currentTarget.value,
                      }))
                    }
                  >
                    {parameter.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            ))}
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
                const updated = updateBuiltInIndicatorParameters(
                  settingsIndicator,
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

function applyCachedCandles(
  updateData: (data: KLineData) => void,
  candles: readonly Candle[],
  lastAppliedOpenTimeMs: { current: number | undefined },
): void {
  if (candles.length === 0) return;
  const lastApplied = lastAppliedOpenTimeMs.current;
  const firstRelevantIndex =
    lastApplied === undefined
      ? 0
      : candles.findIndex((candle) => candle.openTimeMs >= lastApplied);
  if (firstRelevantIndex === -1) return;
  updateChartData(updateData, candles.slice(firstRelevantIndex));
  lastAppliedOpenTimeMs.current = candles.at(-1)?.openTimeMs;
}
