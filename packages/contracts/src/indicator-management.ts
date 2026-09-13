import type { Candle } from "./market-data.js";
import {
  isPluginId,
  isPluginPackagePath,
  isPluginVersion,
  type PluginManifestPermissions,
} from "./plugins.js";

export const indicatorImportPreviewChannel =
  "erc-chart:indicator-import-preview" as const;
export const indicatorImportApproveChannel =
  "erc-chart:indicator-import-approve" as const;
export const indicatorImportCancelChannel =
  "erc-chart:indicator-import-cancel" as const;
export const indicatorsListChannel = "erc-chart:indicators-list" as const;
export const indicatorRemoveChannel = "erc-chart:indicator-remove" as const;

export type IndicatorInputEffect = "calculation" | "presentation";

export interface InstalledIndicatorInputOption {
  readonly value: string;
  readonly label: string;
}

interface InstalledIndicatorInputBase {
  readonly key: string;
  readonly label: string;
  readonly group?: string;
  readonly description?: string;
  readonly effect?: IndicatorInputEffect;
}

export type InstalledIndicatorInputDefinition = InstalledIndicatorInputBase &
  (
    | { readonly type: "boolean"; readonly defaultValue: boolean }
    | {
        readonly type: "number";
        readonly defaultValue: number;
        readonly min?: number;
        readonly max?: number;
        readonly step?: number;
      }
    | {
        readonly type: "string";
        readonly defaultValue: string;
        readonly options?: readonly InstalledIndicatorInputOption[];
        readonly editor?: "text" | "color" | "timeframe";
      }
  );

export interface InstalledIndicatorOutputDefinition {
  readonly key: string;
  readonly label: string;
}

export type InstalledIndicatorPlotKind =
  | "line"
  | "hline"
  | "histogram"
  | "band"
  | "fill"
  | "shape"
  | "line-segment"
  | "box"
  | "text";

export type InstalledIndicatorShapeKind =
  "circle" | "triangle-up" | "triangle-down" | "label-up" | "label-down";
export type InstalledIndicatorShapeLocation =
  "above-bar" | "below-bar" | "absolute";
export type InstalledIndicatorTextSize =
  "tiny" | "small" | "normal" | "large" | "xlarge";

export interface InstalledIndicatorPlotDefinition {
  readonly key: string;
  readonly kind: InstalledIndicatorPlotKind;
  readonly outputKey?: string;
  readonly label?: string;
  readonly color?: string;
  readonly width?: number;
  readonly style?: "solid" | "dashed" | "dotted";
  readonly direction?: "up" | "down";
  readonly shape?: InstalledIndicatorShapeKind;
  readonly location?: InstalledIndicatorShapeLocation;
  readonly text?: string;
  readonly textColor?: string;
  readonly textSize?: InstalledIndicatorTextSize;
}

export interface InstalledIndicatorDefinition {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly placement: "overlay" | "pane";
  readonly inputs: readonly InstalledIndicatorInputDefinition[];
  readonly outputs: readonly InstalledIndicatorOutputDefinition[];
  readonly plots: readonly InstalledIndicatorPlotDefinition[];
  readonly requiresLiveTicks: boolean;
}

export interface InstalledIndicatorSummary {
  readonly pluginId: string;
  readonly pluginName: string;
  readonly version: string;
  readonly runtimeEntryUrl: string;
  readonly definition: InstalledIndicatorDefinition;
}

export interface IndicatorImportPreview {
  readonly requestId: string;
  readonly pluginId: string;
  readonly pluginName: string;
  readonly pluginVersion: string;
  readonly mode: "developer";
  readonly trust: "unsigned";
  readonly permissions: PluginManifestPermissions;
  readonly definition: InstalledIndicatorDefinition;
}

export type IndicatorParameterValue = boolean | number | string;
export type IndicatorParameterValues = Readonly<
  Record<string, IndicatorParameterValue>
>;

export interface IndicatorRuntimeSyncRequest {
  readonly instanceId: string;
  readonly pluginId: string;
  readonly definitionId: string;
  readonly instrumentId: string;
  readonly timeframeId: string;
  readonly parameters: IndicatorParameterValues;
  readonly candles: readonly Candle[];
}

export interface IndicatorRuntimeUpdateRequest {
  readonly instanceId: string;
  readonly phase: "building" | "finalized";
  readonly candle: Candle;
}

export interface IndicatorRuntimePoint {
  readonly openTimeMs: number;
  readonly values: Readonly<Record<string, number | null>>;
  readonly colors?: Readonly<Record<string, string>>;
  readonly sizes?: Readonly<Record<string, number>>;
}

export interface IndicatorRuntimeLineSegment {
  readonly id: string;
  readonly kind: "line-segment";
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly startValue: number;
  readonly endValue: number;
  readonly color: string;
  readonly width: number;
  readonly style: "solid" | "dashed" | "dotted";
}

export interface IndicatorRuntimeBox {
  readonly id: string;
  readonly kind: "box";
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly top: number;
  readonly bottom: number;
  readonly color: string;
  readonly borderColor?: string;
}

export type IndicatorRuntimeOverlay =
  IndicatorRuntimeLineSegment | IndicatorRuntimeBox;

export interface IndicatorRuntimeSignal {
  readonly id: string;
  readonly occurredAtMs: number;
  readonly direction: "long" | "neutral" | "short";
  readonly finalized: boolean;
  readonly confidence?: number;
}

export interface IndicatorRuntimeSnapshot {
  readonly points: readonly IndicatorRuntimePoint[];
  readonly overlays: readonly IndicatorRuntimeOverlay[];
  readonly signals: readonly IndicatorRuntimeSignal[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown, maximum = 256): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

function isOptionalShapeText(value: unknown): value is string {
  return typeof value === "string" && value.length <= 256;
}

function isIdentifier(value: unknown): value is string {
  return isBoundedText(value, 256) && /^[A-Za-z0-9._:-]+$/u.test(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isPermissions(value: unknown): value is PluginManifestPermissions {
  if (!isRecord(value)) return false;
  return (
    isStringArray(value.network) &&
    isStringArray(value.credentials) &&
    Array.isArray(value.storage) &&
    value.storage.every(
      (item) => item === "plugin-settings" || item === "provider-cache",
    )
  );
}

function isInputOption(value: unknown): value is InstalledIndicatorInputOption {
  return (
    isRecord(value) &&
    isBoundedText(value.value, 256) &&
    isBoundedText(value.label, 256)
  );
}

function isInputDefinition(
  value: unknown,
): value is InstalledIndicatorInputDefinition {
  if (
    !isRecord(value) ||
    !isIdentifier(value.key) ||
    !isBoundedText(value.label) ||
    (value.group !== undefined && !isBoundedText(value.group)) ||
    (value.description !== undefined &&
      !isBoundedText(value.description, 2_048)) ||
    (value.effect !== undefined &&
      value.effect !== "calculation" &&
      value.effect !== "presentation")
  ) {
    return false;
  }
  if (value.type === "boolean") return typeof value.defaultValue === "boolean";
  if (value.type === "number") {
    return (
      isFiniteNumber(value.defaultValue) &&
      (value.min === undefined || isFiniteNumber(value.min)) &&
      (value.max === undefined || isFiniteNumber(value.max)) &&
      (value.step === undefined ||
        (isFiniteNumber(value.step) && Number(value.step) > 0))
    );
  }
  if (value.type === "string") {
    return (
      typeof value.defaultValue === "string" &&
      value.defaultValue.length <= 8_192 &&
      (value.options === undefined ||
        (Array.isArray(value.options) &&
          value.options.length <= 256 &&
          value.options.every(isInputOption))) &&
      (value.editor === undefined ||
        value.editor === "text" ||
        value.editor === "color" ||
        value.editor === "timeframe")
    );
  }
  return false;
}

function isOutputDefinition(
  value: unknown,
): value is InstalledIndicatorOutputDefinition {
  return (
    isRecord(value) && isIdentifier(value.key) && isBoundedText(value.label)
  );
}

const plotKinds = new Set<InstalledIndicatorPlotKind>([
  "line",
  "hline",
  "histogram",
  "band",
  "fill",
  "shape",
  "line-segment",
  "box",
  "text",
]);
const shapeKinds = new Set<InstalledIndicatorShapeKind>([
  "circle",
  "triangle-up",
  "triangle-down",
  "label-up",
  "label-down",
]);
const shapeLocations = new Set<InstalledIndicatorShapeLocation>([
  "above-bar",
  "below-bar",
  "absolute",
]);
const textSizes = new Set<InstalledIndicatorTextSize>([
  "tiny",
  "small",
  "normal",
  "large",
  "xlarge",
]);

function isPlotDefinition(
  value: unknown,
): value is InstalledIndicatorPlotDefinition {
  if (!isRecord(value)) return false;
  const hasShapeMetadata =
    value.shape !== undefined ||
    value.location !== undefined ||
    value.text !== undefined ||
    value.textColor !== undefined ||
    value.textSize !== undefined;
  return (
    isIdentifier(value.key) &&
    typeof value.kind === "string" &&
    plotKinds.has(value.kind as InstalledIndicatorPlotKind) &&
    (value.outputKey === undefined || isIdentifier(value.outputKey)) &&
    (value.label === undefined || isBoundedText(value.label)) &&
    (value.color === undefined || isBoundedText(value.color, 128)) &&
    (value.width === undefined ||
      (isFiniteNumber(value.width) && value.width > 0 && value.width <= 20)) &&
    (value.style === undefined ||
      value.style === "solid" ||
      value.style === "dashed" ||
      value.style === "dotted") &&
    (value.direction === undefined ||
      value.direction === "up" ||
      value.direction === "down") &&
    (value.shape === undefined ||
      (typeof value.shape === "string" &&
        shapeKinds.has(value.shape as InstalledIndicatorShapeKind))) &&
    (value.location === undefined ||
      (typeof value.location === "string" &&
        shapeLocations.has(
          value.location as InstalledIndicatorShapeLocation,
        ))) &&
    (value.text === undefined || isOptionalShapeText(value.text)) &&
    (value.textColor === undefined || isBoundedText(value.textColor, 128)) &&
    (value.textSize === undefined ||
      (typeof value.textSize === "string" &&
        textSizes.has(value.textSize as InstalledIndicatorTextSize))) &&
    (value.kind === "shape" || !hasShapeMetadata)
  );
}

export function isInstalledIndicatorDefinition(
  value: unknown,
): value is InstalledIndicatorDefinition {
  return (
    isRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedText(value.name) &&
    (value.description === undefined ||
      isBoundedText(value.description, 2_048)) &&
    (value.placement === "overlay" || value.placement === "pane") &&
    Array.isArray(value.inputs) &&
    value.inputs.length <= 128 &&
    value.inputs.every(isInputDefinition) &&
    Array.isArray(value.outputs) &&
    value.outputs.length <= 128 &&
    value.outputs.every(isOutputDefinition) &&
    Array.isArray(value.plots) &&
    value.plots.length <= 128 &&
    value.plots.every(isPlotDefinition) &&
    typeof value.requiresLiveTicks === "boolean"
  );
}

export function isInstalledIndicatorSummary(
  value: unknown,
): value is InstalledIndicatorSummary {
  return (
    isRecord(value) &&
    isPluginId(value.pluginId) &&
    isBoundedText(value.pluginName) &&
    isPluginVersion(value.version) &&
    isIndicatorRuntimeEntryUrl(
      value.runtimeEntryUrl,
      value.pluginId,
      value.version,
    ) &&
    isInstalledIndicatorDefinition(value.definition)
  );
}

function isIndicatorRuntimeEntryUrl(
  value: unknown,
  pluginId: string,
  version: string,
): value is string {
  if (!isBoundedText(value, 1_024) || /%2e/iu.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    url.protocol !== "erc-plugin:" ||
    url.hostname.toLowerCase() !== "plugin" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    return false;
  }
  const revision = url.searchParams.get("revision");
  if (
    revision === null ||
    !/^[a-f0-9]{64}$/u.test(revision) ||
    [...url.searchParams.keys()].some((key) => key !== "revision") ||
    url.searchParams.getAll("revision").length !== 1
  ) {
    return false;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  const [urlPluginId, urlVersion, ...entrySegments] = pathname
    .split("/")
    .filter(Boolean);
  const entryPath = entrySegments.join("/");
  return (
    urlPluginId === pluginId &&
    urlVersion === version &&
    entryPath.startsWith("dist/") &&
    isPluginPackagePath(entryPath)
  );
}

export function isInstalledIndicatorList(
  value: unknown,
): value is readonly InstalledIndicatorSummary[] {
  return (
    Array.isArray(value) &&
    value.length <= 256 &&
    value.every(isInstalledIndicatorSummary)
  );
}

export function isIndicatorImportPreview(
  value: unknown,
): value is IndicatorImportPreview {
  return (
    isRecord(value) &&
    isBoundedText(value.requestId, 128) &&
    isPluginId(value.pluginId) &&
    isBoundedText(value.pluginName) &&
    isBoundedText(value.pluginVersion, 128) &&
    value.mode === "developer" &&
    value.trust === "unsigned" &&
    isPermissions(value.permissions) &&
    isInstalledIndicatorDefinition(value.definition)
  );
}

export function isIndicatorImportPreviewResult(
  value: unknown,
): value is IndicatorImportPreview | null {
  return value === null || isIndicatorImportPreview(value);
}

function isCandle(value: unknown): value is Candle {
  return (
    isRecord(value) &&
    isBoundedText(value.instrumentId) &&
    isBoundedText(value.timeframeId) &&
    Number.isSafeInteger(value.openTimeMs) &&
    Number(value.openTimeMs) >= 0 &&
    isFiniteNumber(value.open) &&
    isFiniteNumber(value.high) &&
    isFiniteNumber(value.low) &&
    isFiniteNumber(value.close) &&
    (value.volume === undefined || isFiniteNumber(value.volume))
  );
}

function isParameterValues(value: unknown): value is IndicatorParameterValues {
  return (
    isRecord(value) &&
    Object.keys(value).length <= 128 &&
    Object.entries(value).every(
      ([key, item]) =>
        isIdentifier(key) &&
        (typeof item === "boolean" ||
          typeof item === "string" ||
          isFiniteNumber(item)),
    )
  );
}

export function isIndicatorRuntimeSyncRequest(
  value: unknown,
): value is IndicatorRuntimeSyncRequest {
  return (
    isRecord(value) &&
    isIdentifier(value.instanceId) &&
    isPluginId(value.pluginId) &&
    isIdentifier(value.definitionId) &&
    isBoundedText(value.instrumentId) &&
    isBoundedText(value.timeframeId) &&
    isParameterValues(value.parameters) &&
    Array.isArray(value.candles) &&
    value.candles.length <= 100_000 &&
    value.candles.every(isCandle)
  );
}

export function isIndicatorRuntimeUpdateRequest(
  value: unknown,
): value is IndicatorRuntimeUpdateRequest {
  return (
    isRecord(value) &&
    isIdentifier(value.instanceId) &&
    (value.phase === "building" || value.phase === "finalized") &&
    isCandle(value.candle)
  );
}

function isNumericRecord(
  value: unknown,
): value is Readonly<Record<string, number | null>> {
  return (
    isRecord(value) &&
    Object.keys(value).length <= 128 &&
    Object.entries(value).every(
      ([key, item]) =>
        isIdentifier(key) && (item === null || isFiniteNumber(item)),
    )
  );
}

function isColorRecord(
  value: unknown,
): value is Readonly<Record<string, string>> {
  return (
    isRecord(value) &&
    Object.keys(value).length <= 128 &&
    Object.entries(value).every(
      ([key, item]) =>
        isIdentifier(key) && typeof item === "string" && item.length <= 128,
    )
  );
}

function isSizeRecord(
  value: unknown,
): value is Readonly<Record<string, number>> {
  return (
    isRecord(value) &&
    Object.keys(value).length <= 128 &&
    Object.entries(value).every(
      ([key, item]) =>
        isIdentifier(key) &&
        isFiniteNumber(item) &&
        Number(item) > 0 &&
        Number(item) <= 20,
    )
  );
}

function isRuntimePoint(value: unknown): value is IndicatorRuntimePoint {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.openTimeMs) &&
    Number(value.openTimeMs) >= 0 &&
    isNumericRecord(value.values) &&
    (value.colors === undefined || isColorRecord(value.colors)) &&
    (value.sizes === undefined || isSizeRecord(value.sizes))
  );
}

function isRuntimeOverlay(value: unknown): value is IndicatorRuntimeOverlay {
  if (!isRecord(value) || !isIdentifier(value.id)) return false;
  if (value.kind === "line-segment") {
    return (
      Number.isSafeInteger(value.startTimeMs) &&
      Number.isSafeInteger(value.endTimeMs) &&
      isFiniteNumber(value.startValue) &&
      isFiniteNumber(value.endValue) &&
      isBoundedText(value.color, 128) &&
      isFiniteNumber(value.width) &&
      value.width > 0 &&
      value.width <= 20 &&
      (value.style === "solid" ||
        value.style === "dashed" ||
        value.style === "dotted")
    );
  }
  if (value.kind === "box") {
    return (
      Number.isSafeInteger(value.startTimeMs) &&
      Number.isSafeInteger(value.endTimeMs) &&
      isFiniteNumber(value.top) &&
      isFiniteNumber(value.bottom) &&
      isBoundedText(value.color, 128) &&
      (value.borderColor === undefined || isBoundedText(value.borderColor, 128))
    );
  }
  return false;
}

function isRuntimeSignal(value: unknown): value is IndicatorRuntimeSignal {
  return (
    isRecord(value) &&
    isIdentifier(value.id) &&
    Number.isSafeInteger(value.occurredAtMs) &&
    (value.direction === "long" ||
      value.direction === "neutral" ||
      value.direction === "short") &&
    typeof value.finalized === "boolean" &&
    (value.confidence === undefined ||
      (isFiniteNumber(value.confidence) &&
        value.confidence >= 0 &&
        value.confidence <= 1))
  );
}

export function isIndicatorRuntimeSnapshot(
  value: unknown,
): value is IndicatorRuntimeSnapshot {
  return (
    isRecord(value) &&
    Array.isArray(value.points) &&
    value.points.length <= 100_000 &&
    value.points.every(isRuntimePoint) &&
    Array.isArray(value.overlays) &&
    value.overlays.length <= 10_000 &&
    value.overlays.every(isRuntimeOverlay) &&
    Array.isArray(value.signals) &&
    value.signals.length <= 10_000 &&
    value.signals.every(isRuntimeSignal)
  );
}

export function isIndicatorRuntimeInstanceId(value: unknown): value is string {
  return isIdentifier(value);
}
