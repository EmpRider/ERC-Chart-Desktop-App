export const workspaceLoadChannel = "erc-chart:workspace-load" as const;
export const workspaceSaveChannel = "erc-chart:workspace-save" as const;

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const layouts = new Set([
  "grid-1",
  "split-horizontal",
  "split-vertical",
  "grid-3-left",
  "grid-3-top",
  "grid-4",
]);
const chartTypes = new Set(["candlestick", "line", "area"]);

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export type WorkspaceIndicatorInput =
  | {
      readonly kind: "candles";
      readonly timeframeSeconds?: number;
    }
  | { readonly kind: "ticks" }
  | {
      readonly kind: "indicator-output";
      readonly instanceId: string;
      readonly outputKey: string;
    };

export interface WorkspaceIndicator {
  readonly instanceId: string;
  readonly pluginId: string;
  readonly definitionId: string;
  readonly enabled: boolean;
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly inputs: Readonly<Record<string, WorkspaceIndicatorInput>>;
}

export interface WorkspaceViewport {
  readonly visibleBars: number;
  readonly rightOffsetBars: number;
  readonly priceScaleMode: "auto" | "manual";
  readonly manualPriceMin?: number;
  readonly manualPriceMax?: number;
}

export interface PersistedWorkspaceChartSlot {
  readonly id: string;
  readonly providerProfileId: string;
  readonly instrumentId: string;
  readonly timeframeSeconds: number;
  readonly chartType: "candlestick" | "line" | "area";
  readonly viewport?: WorkspaceViewport;
  readonly indicators: readonly WorkspaceIndicator[];
}

export interface PersistedWorkspaceTab {
  readonly id: string;
  readonly title: string;
  readonly layout:
    | "grid-1"
    | "split-horizontal"
    | "split-vertical"
    | "grid-3-left"
    | "grid-3-top"
    | "grid-4";
  readonly chartSlots: readonly PersistedWorkspaceChartSlot[];
}

export interface PersistedWorkspace {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly activeTabId: string;
  readonly tabs: readonly PersistedWorkspaceTab[];
  readonly savedAtMs: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasFields(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((field) => Object.hasOwn(value, field)) &&
    keys.every((field) => required.includes(field) || optional.includes(field))
  );
}

function isDenseArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && Object.keys(value).length === value.length;
}

function isInteger(value: unknown, minimum: number, maximum: number): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value);
}

function isText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
  );
}

function isJsonValue(value: unknown, seen: Set<object>): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    isNumber(value)
  )
    return true;
  if (
    typeof value !== "object" ||
    seen.has(value) ||
    (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)
  )
    return false;
  seen.add(value);
  const valid = isDenseArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : !Array.isArray(value) &&
      Object.values(value).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function isInput(value: unknown): value is WorkspaceIndicatorInput {
  if (!isObject(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "candles":
      return (
        hasFields(value, ["kind"], ["timeframeSeconds"]) &&
        (value.timeframeSeconds === undefined ||
          isInteger(value.timeframeSeconds, 1, 31_536_000))
      );
    case "ticks":
      return hasFields(value, ["kind"]);
    case "indicator-output":
      return (
        hasFields(value, ["kind", "instanceId", "outputKey"]) &&
        isId(value.instanceId) &&
        isId(value.outputKey)
      );
    default:
      return false;
  }
}

function isIndicator(value: unknown): value is WorkspaceIndicator {
  if (
    !isObject(value) ||
    !hasFields(value, [
      "instanceId",
      "pluginId",
      "definitionId",
      "enabled",
      "parameters",
      "inputs",
    ]) ||
    !isId(value.instanceId) ||
    typeof value.pluginId !== "string" ||
    value.pluginId.length > 128 ||
    !pluginIdPattern.test(value.pluginId) ||
    !isId(value.definitionId) ||
    typeof value.enabled !== "boolean" ||
    !isObject(value.parameters) ||
    !isJsonValue(value.parameters, new Set()) ||
    !isObject(value.inputs)
  )
    return false;
  return Object.values(value.inputs).every(isInput);
}

function isViewport(value: unknown): value is WorkspaceViewport {
  if (
    !isObject(value) ||
    !hasFields(
      value,
      ["visibleBars", "rightOffsetBars", "priceScaleMode"],
      ["manualPriceMin", "manualPriceMax"],
    ) ||
    !isInteger(value.visibleBars, 5, 100_000) ||
    !isInteger(value.rightOffsetBars, -100_000, 100_000) ||
    (value.priceScaleMode !== "auto" && value.priceScaleMode !== "manual") ||
    (value.manualPriceMin !== undefined && !isNumber(value.manualPriceMin)) ||
    (value.manualPriceMax !== undefined && !isNumber(value.manualPriceMax))
  )
    return false;
  return (
    value.priceScaleMode !== "manual" ||
    (isNumber(value.manualPriceMin) && isNumber(value.manualPriceMax))
  );
}

function isChartSlot(value: unknown): value is PersistedWorkspaceChartSlot {
  return (
    isObject(value) &&
    hasFields(
      value,
      [
        "id",
        "providerProfileId",
        "instrumentId",
        "timeframeSeconds",
        "chartType",
        "indicators",
      ],
      ["viewport"],
    ) &&
    isId(value.id) &&
    isId(value.providerProfileId) &&
    isText(value.instrumentId, 128) &&
    isInteger(value.timeframeSeconds, 1, 31_536_000) &&
    typeof value.chartType === "string" &&
    chartTypes.has(value.chartType) &&
    (value.viewport === undefined || isViewport(value.viewport)) &&
    isDenseArray(value.indicators) &&
    value.indicators.length <= 5 &&
    value.indicators.every(isIndicator)
  );
}

function isTab(value: unknown): value is PersistedWorkspaceTab {
  return (
    isObject(value) &&
    hasFields(value, ["id", "title", "layout", "chartSlots"]) &&
    isId(value.id) &&
    isText(value.title, 100) &&
    typeof value.layout === "string" &&
    layouts.has(value.layout) &&
    isDenseArray(value.chartSlots) &&
    value.chartSlots.length >= 1 &&
    value.chartSlots.length <= 4 &&
    value.chartSlots.every(isChartSlot)
  );
}

export function isPersistedWorkspace(
  value: unknown,
): value is PersistedWorkspace {
  try {
    return (
      isObject(value) &&
      hasFields(value, [
        "schemaVersion",
        "id",
        "name",
        "activeTabId",
        "tabs",
        "savedAtMs",
      ]) &&
      value.schemaVersion === 1 &&
      isId(value.id) &&
      isText(value.name, 100) &&
      isId(value.activeTabId) &&
      isDenseArray(value.tabs) &&
      value.tabs.length >= 1 &&
      value.tabs.length <= 32 &&
      value.tabs.every(isTab) &&
      value.tabs.some((tab) => tab.id === value.activeTabId) &&
      isInteger(value.savedAtMs, 0, Number.MAX_SAFE_INTEGER)
    );
  } catch {
    return false;
  }
}

export function isWorkspaceLoadResult(
  value: unknown,
): value is PersistedWorkspace | null {
  return value === null || isPersistedWorkspace(value);
}

export const isWorkspaceSaveRequest: (
  value: unknown,
) => value is PersistedWorkspace = isPersistedWorkspace;
