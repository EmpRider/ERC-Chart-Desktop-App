import {
  indicatorContractVersion,
  indicatorHostVersion,
  candlesWithPriceSource,
  inputOptions,
  movingAverageTypes,
  priceSeries,
  priceSources,
  ta,
  type Candle,
  type CandleTaKernel,
  type IndicatorDefinition,
  type IndicatorInputValue,
  type IndicatorInstanceContext,
  type IndicatorPluginModule,
  type IndicatorSnapshot,
  type DmiSeries,
  type MovingAverageType,
  type NumericTaKernel,
  type PriceSource,
  type RuntimeIndicatorInstance,
  type SignalCandidate,
} from "@erc-chart/indicator-sdk";

const pluginId = "erc.indicator.atr-rope-utbot";
const definitionId = `${pluginId}.unified`;

const ropeModes = [
  "original",
  "partial",
  "reduced",
  "momentum",
  "ema",
  "adaptive",
  "zerolag",
] as const;
const utModes = ["original", "0lag"] as const;
const signalModes = [
  "original",
  "MG Follow",
  "Win Follow",
  "Win Follow + MG Follow",
] as const;
const suppressionModes = [
  "off",
  "Any",
  "ATR Rope",
  "UT Bot",
  "ATR Rope + UT Bot",
] as const;
const drawModes = ["Line + Band", "Line", "Band"] as const;
const bandMergeModes = ["Inside Band", "Band Overlap"] as const;

type RopeMode = (typeof ropeModes)[number];
type DirectionMaType = MovingAverageType;
type UtMode = (typeof utModes)[number];
type SignalMode = (typeof signalModes)[number];
type SuppressionMode = (typeof suppressionModes)[number];
type DrawMode = (typeof drawModes)[number];
type BandMergeMode = (typeof bandMergeModes)[number];

interface Params {
  readonly ropePeriod: number;
  readonly ropeMultiplier: number;
  readonly ropeSource: PriceSource;
  readonly ropeSensitivityMode: RopeMode;
  readonly ropeDirectionMaType: DirectionMaType;
  readonly ropeDirectionLookback: number;
  readonly ropeDirectionThreshold: number;
  readonly utbotKeyValue: number;
  readonly utbotAtrPeriod: number;
  readonly utbotSource: PriceSource;
  readonly utbotMode: UtMode;
  readonly signalIssueMode: SignalMode;
  readonly mgStepCount: number;
  readonly profilePeriod: number;
  readonly fastPocPeriod: number;
  readonly rowCount: number;
  readonly dmiLength: number;
  readonly minEarlyBars: number;
  readonly projectionBars: number;
  readonly bodyWeight: number;
  readonly migrationStrength: number;
  readonly migrationConfirmBars: number;
  readonly migrationCenterSmoothing: number;
  readonly activeHistoricalPocCount: number;
  readonly minZoneBarsToRender: number;
  readonly minZoneHitsToRender: number;
  readonly maxStoredZones: number;
  readonly pocBandHalfRows: number;
  readonly bandMergeMode: BandMergeMode;
  readonly maxBandExpansionRows: number;
  readonly pocBandSignalSuppressLine: SuppressionMode;
  readonly drawMode: DrawMode;
  readonly adxPocSource: PriceSource;
  readonly currentColor: string;
  readonly historicalColor: string;
  readonly frozenColor: string;
  readonly bandOpacity: number;
  readonly lineOpacity: number;
  readonly lineWidth: number;
  readonly ropeUpColor: string;
  readonly ropeDownColor: string;
  readonly ropeFlatColor: string;
  readonly ropeWidth: number;
  readonly showTrailingStop: boolean;
  readonly utbotTrailingStopColor: string;
  readonly utbotUpTrendColor: string;
  readonly utbotDownTrendColor: string;
  readonly buySignalColor: string;
  readonly sellSignalColor: string;
}

interface RopeResult {
  readonly rope: number[];
  readonly upper: number[];
  readonly lower: number[];
  readonly directionUpper: number[];
  readonly directionLower: number[];
  readonly direction: number[];
}

interface UtResult {
  readonly stop: number[];
  readonly position: number[];
}

interface PocCandidate {
  readonly barIndex: number;
  readonly center: number;
  readonly bandLow: number;
  readonly bandHigh: number;
  readonly rowHeight: number;
  readonly projectedScore: number;
  readonly currentScore: number;
  readonly velocity: number;
  readonly scoreLookup: readonly {
    readonly center: number;
    readonly score: number;
    readonly projectedScore: number;
  }[];
}

interface PocSegment {
  startIndex: number;
  endIndex: number;
  center: number;
  bandLow: number;
  bandHigh: number;
}

interface PocZone {
  readonly id: string;
  readonly createdAt: number;
  lastSeenIndex: number;
  center: number;
  bandLow: number;
  bandHigh: number;
  rowHeight: number;
  hitCount: number;
  projectedScore: number;
  activeRank: number;
  frozen: boolean;
  lastActiveOrder: number;
  readonly segments: PocSegment[];
}

interface SuppressionBand {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly top: number;
  readonly bottom: number;
}

interface CalculationResult extends IndicatorSnapshot {
  readonly finalizedBarIndex: number;
  readonly pocZones: readonly PocZone[];
}

interface RopePoint {
  readonly rope: number;
  readonly upper: number;
  readonly lower: number;
  readonly directionUpper: number;
  readonly directionLower: number;
  readonly direction: number;
}

interface UtPoint {
  readonly stop: number;
  readonly position: number;
}

interface LiveTailState {
  readonly ropeAtr: CandleTaKernel<number>;
  readonly directionMa: NumericTaKernel;
  readonly utAtr: CandleTaKernel<number>;
  finalizedCount: number;
  previousRope: number;
  bandAtr: number;
  previousAtr: number;
  previousUtStop: number;
  previousUtPosition: number;
  previousUtClose: number;
}

export const definition: IndicatorDefinition = {
  id: definitionId,
  name: "ATR Rope + UT Bot Unified",
  description:
    "ATR Rope + UT Bot with follow signals and rolling ADX POC migration. This ERC conversion intentionally uses chart-timeframe candles only until the host exposes explicit MTF inputs, preventing hidden lookahead from userscript security() semantics.",
  indicatorContractVersion,
  hostCompatibility: {
    minimumHostApiVersion: indicatorHostVersion,
    maximumHostApiVersion: indicatorHostVersion,
  },
  placement: "overlay",
  requiresLiveTicks: false,
  inputs: [
    {
      key: "ropePeriod",
      label: "ATR period",
      group: "ATR Rope",
      type: "number",
      defaultValue: 14,
      min: 1,
      max: 500,
      step: 1,
    },
    {
      key: "ropeMultiplier",
      label: "Sensitivity multiplier",
      group: "ATR Rope",
      type: "number",
      defaultValue: 1.5,
      min: 0.1,
      max: 10,
      step: 0.1,
    },
    {
      key: "ropeSource",
      label: "Price source",
      group: "ATR Rope",
      type: "string",
      defaultValue: "close",
      options: inputOptions(priceSources),
    },
    {
      key: "ropeSensitivityMode",
      label: "Sensitivity mode",
      group: "ATR Rope",
      type: "string",
      defaultValue: "original",
      options: inputOptions(ropeModes),
    },
    {
      key: "ropeDirectionMaType",
      label: "Direction MA",
      group: "ATR Rope Direction",
      type: "string",
      defaultValue: "sma",
      options: inputOptions(movingAverageTypes),
    },
    {
      key: "ropeDirectionLookback",
      label: "Direction lookback",
      group: "ATR Rope Direction",
      type: "number",
      defaultValue: 2,
      min: 1,
      max: 20,
      step: 1,
    },
    {
      key: "ropeDirectionThreshold",
      label: "Direction threshold",
      group: "ATR Rope Direction",
      type: "number",
      defaultValue: 0.05,
      min: 0,
      max: 500,
      step: 0.01,
    },
    {
      key: "utbotKeyValue",
      label: "ATR multiplier",
      group: "UT Bot",
      type: "number",
      defaultValue: 1,
      min: 0.1,
      max: 10,
      step: 0.1,
    },
    {
      key: "utbotAtrPeriod",
      label: "ATR period",
      group: "UT Bot",
      type: "number",
      defaultValue: 10,
      min: 1,
      max: 500,
      step: 1,
    },
    {
      key: "utbotSource",
      label: "Price source",
      group: "UT Bot",
      type: "string",
      defaultValue: "close",
      options: inputOptions(priceSources),
    },
    {
      key: "utbotMode",
      label: "Mode",
      group: "UT Bot",
      type: "string",
      defaultValue: "original",
      options: inputOptions(utModes),
    },
    {
      key: "signalIssueMode",
      label: "Signal mode",
      group: "Signals",
      type: "string",
      defaultValue: "original",
      options: inputOptions(signalModes),
    },
    {
      key: "mgStepCount",
      label: "MG follow steps",
      group: "Signals",
      type: "number",
      defaultValue: 0,
      min: 0,
      max: 20,
      step: 1,
    },
    {
      key: "buySignalColor",
      label: "Buy color",
      group: "Signals",
      type: "string",
      defaultValue: "#089981",
      editor: "color",
      effect: "presentation",
    },
    {
      key: "sellSignalColor",
      label: "Sell color",
      group: "Signals",
      type: "string",
      defaultValue: "#F23645",
      editor: "color",
      effect: "presentation",
    },
    {
      key: "adxPocSource",
      label: "Price source",
      group: "ADX POC",
      type: "string",
      defaultValue: "close",
      options: inputOptions(priceSources),
    },
    {
      key: "profilePeriod",
      label: "Profile period",
      group: "ADX POC",
      type: "number",
      defaultValue: 30,
      min: 5,
      max: 500,
      step: 1,
    },
    {
      key: "fastPocPeriod",
      label: "Fast POC period",
      group: "ADX POC",
      type: "number",
      defaultValue: 10,
      min: 3,
      max: 100,
      step: 1,
    },
    {
      key: "rowCount",
      label: "Price rows",
      group: "ADX POC",
      type: "number",
      defaultValue: 24,
      min: 10,
      max: 100,
      step: 1,
    },
    {
      key: "dmiLength",
      label: "ADX / DI length",
      group: "ADX POC",
      type: "number",
      defaultValue: 14,
      min: 1,
      max: 500,
      step: 1,
    },
    {
      key: "minEarlyBars",
      label: "Minimum early bars",
      group: "ADX POC",
      type: "number",
      defaultValue: 5,
      min: 2,
      max: 100,
      step: 1,
    },
    {
      key: "projectionBars",
      label: "Projection bars",
      group: "ADX POC Migration",
      type: "number",
      defaultValue: 5,
      min: 1,
      max: 50,
      step: 1,
    },
    {
      key: "bodyWeight",
      label: "Body weight",
      group: "ADX POC",
      type: "number",
      defaultValue: 0.7,
      min: 0,
      max: 1,
      step: 0.05,
    },
    {
      key: "migrationStrength",
      label: "Migration strength",
      group: "ADX POC Migration",
      type: "number",
      defaultValue: 1.1,
      min: 1,
      max: 3,
      step: 0.05,
    },
    {
      key: "migrationConfirmBars",
      label: "Migration confirmations",
      group: "ADX POC Migration",
      type: "number",
      defaultValue: 1,
      min: 1,
      max: 5,
      step: 1,
    },
    {
      key: "migrationCenterSmoothing",
      label: "Center smoothing",
      group: "ADX POC Migration",
      type: "number",
      defaultValue: 0.1,
      min: 0,
      max: 0.95,
      step: 0.05,
    },
    {
      key: "activeHistoricalPocCount",
      label: "Active historical POCs",
      group: "ADX POC Zones",
      type: "number",
      defaultValue: 1,
      min: 0,
      max: 20,
      step: 1,
    },
    {
      key: "minZoneBarsToRender",
      label: "Minimum zone bars",
      group: "ADX POC Zones",
      type: "number",
      defaultValue: 3,
      min: 1,
      max: 20,
      step: 1,
    },
    {
      key: "minZoneHitsToRender",
      label: "Minimum zone hits",
      group: "ADX POC Zones",
      type: "number",
      defaultValue: 2,
      min: 1,
      max: 20,
      step: 1,
    },
    {
      key: "maxStoredZones",
      label: "Maximum stored zones",
      group: "ADX POC Zones",
      type: "number",
      defaultValue: 300,
      min: 20,
      max: 1000,
      step: 10,
    },
    {
      key: "pocBandHalfRows",
      label: "Band half rows",
      group: "ADX POC Band",
      type: "number",
      defaultValue: 1.5,
      min: 0.1,
      max: 20,
      step: 0.1,
    },
    {
      key: "bandMergeMode",
      label: "Band merge mode",
      group: "ADX POC Band",
      type: "string",
      defaultValue: "Inside Band",
      options: inputOptions(bandMergeModes),
    },
    {
      key: "maxBandExpansionRows",
      label: "Maximum band expansion",
      group: "ADX POC Band",
      type: "number",
      defaultValue: 2,
      min: 0.5,
      max: 20,
      step: 0.25,
    },
    {
      key: "pocBandSignalSuppressLine",
      label: "Signal suppression",
      group: "ADX POC Suppression",
      type: "string",
      defaultValue: "off",
      options: inputOptions(suppressionModes),
    },
    {
      key: "drawMode",
      label: "POC draw mode",
      group: "ADX POC Style",
      type: "string",
      defaultValue: "Line + Band",
      options: inputOptions(drawModes),
      effect: "presentation",
    },
    {
      key: "currentColor",
      label: "Current POC",
      group: "ADX POC Style",
      type: "string",
      defaultValue: "rgba(255, 255, 0, 1)",
      editor: "color",
      effect: "presentation",
    },
    {
      key: "historicalColor",
      label: "Historical POC",
      group: "ADX POC Style",
      type: "string",
      defaultValue: "rgba(255, 213, 79, 0.75)",
      editor: "color",
      effect: "presentation",
    },
    {
      key: "frozenColor",
      label: "Frozen POC",
      group: "ADX POC Style",
      type: "string",
      defaultValue: "rgba(255, 255, 0, 0.35)",
      editor: "color",
      effect: "presentation",
    },
    {
      key: "bandOpacity",
      label: "Band opacity",
      group: "ADX POC Style",
      type: "number",
      defaultValue: 0.18,
      min: 0,
      max: 1,
      step: 0.05,
      effect: "presentation",
    },
    {
      key: "lineOpacity",
      label: "Line opacity",
      group: "ADX POC Style",
      type: "number",
      defaultValue: 0.95,
      min: 0,
      max: 1,
      step: 0.05,
      effect: "presentation",
    },
    {
      key: "lineWidth",
      label: "Line width",
      group: "ADX POC Style",
      type: "number",
      defaultValue: 2,
      min: 1,
      max: 5,
      step: 1,
      effect: "presentation",
    },
    {
      key: "ropeUpColor",
      label: "Rope up color",
      group: "Display",
      type: "string",
      defaultValue: "#3daa45",
      editor: "color",
      effect: "presentation",
    },
    {
      key: "ropeDownColor",
      label: "Rope down color",
      group: "Display",
      type: "string",
      defaultValue: "#ff033e",
      editor: "color",
      effect: "presentation",
    },
    {
      key: "ropeFlatColor",
      label: "Rope flat color",
      group: "Display",
      type: "string",
      defaultValue: "#004d92",
      editor: "color",
      effect: "presentation",
    },
    {
      key: "ropeWidth",
      label: "Rope width",
      group: "Display",
      type: "number",
      defaultValue: 3,
      min: 1,
      max: 10,
      step: 1,
      effect: "presentation",
    },
    {
      key: "showTrailingStop",
      label: "Show trailing stop",
      group: "Display",
      type: "boolean",
      defaultValue: true,
      effect: "presentation",
    },
    {
      key: "utbotTrailingStopColor",
      label: "UT neutral color",
      group: "Display",
      type: "string",
      defaultValue: "#787B86",
      editor: "color",
      effect: "presentation",
    },
    {
      key: "utbotUpTrendColor",
      label: "UT up color",
      group: "Display",
      type: "string",
      defaultValue: "#089981",
      editor: "color",
      effect: "presentation",
    },
    {
      key: "utbotDownTrendColor",
      label: "UT down color",
      group: "Display",
      type: "string",
      defaultValue: "#F23645",
      editor: "color",
      effect: "presentation",
    },
  ],
  outputs: [
    { key: "rope", label: "ATR Rope" },
    { key: "directionUpper", label: "Direction Upper" },
    { key: "directionLower", label: "Direction Lower" },
    { key: "utStop", label: "UT Stop" },
    { key: "buyMarker", label: "Buy" },
    { key: "sellMarker", label: "Sell" },
  ],
  plots: [
    {
      key: "rope",
      kind: "line",
      outputKey: "rope",
      label: "ATR Rope",
      color: "#3daa45",
      width: 3,
    },
    {
      key: "directionUpper",
      kind: "line",
      outputKey: "directionUpper",
      label: "Direction Upper",
      color: "#3daa45",
      width: 1,
    },
    {
      key: "directionLower",
      kind: "line",
      outputKey: "directionLower",
      label: "Direction Lower",
      color: "#ff033e",
      width: 1,
    },
    {
      key: "utStop",
      kind: "line",
      outputKey: "utStop",
      label: "UT Stop",
      color: "#089981",
      width: 2,
    },
    {
      key: "buyMarker",
      kind: "shape",
      outputKey: "buyMarker",
      label: "Buy",
      color: "#089981",
      direction: "up",
    },
    {
      key: "sellMarker",
      kind: "shape",
      outputKey: "sellMarker",
      label: "Sell",
      color: "#F23645",
      direction: "down",
    },
  ],
};

function numberValue(
  values: Readonly<Record<string, IndicatorInputValue>>,
  key: string,
): number {
  const value = values[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid numeric parameter: ${key}`);
  }
  return value;
}

function stringValue(
  values: Readonly<Record<string, IndicatorInputValue>>,
  key: string,
): string {
  const value = values[key];
  if (typeof value !== "string")
    throw new Error(`Invalid string parameter: ${key}`);
  return value;
}

function booleanValue(
  values: Readonly<Record<string, IndicatorInputValue>>,
  key: string,
): boolean {
  const value = values[key];
  if (typeof value !== "boolean")
    throw new Error(`Invalid boolean parameter: ${key}`);
  return value;
}

function toParams(
  values: Readonly<Record<string, IndicatorInputValue>>,
): Params {
  return {
    ropePeriod: Math.max(1, Math.floor(numberValue(values, "ropePeriod"))),
    ropeMultiplier: numberValue(values, "ropeMultiplier"),
    ropeSource: stringValue(values, "ropeSource") as PriceSource,
    ropeSensitivityMode: stringValue(values, "ropeSensitivityMode") as RopeMode,
    ropeDirectionMaType: stringValue(
      values,
      "ropeDirectionMaType",
    ) as DirectionMaType,
    ropeDirectionLookback: Math.max(
      1,
      Math.floor(numberValue(values, "ropeDirectionLookback")),
    ),
    ropeDirectionThreshold: numberValue(values, "ropeDirectionThreshold"),
    utbotKeyValue: numberValue(values, "utbotKeyValue"),
    utbotAtrPeriod: Math.max(
      1,
      Math.floor(numberValue(values, "utbotAtrPeriod")),
    ),
    utbotSource: stringValue(values, "utbotSource") as PriceSource,
    utbotMode: stringValue(values, "utbotMode") as UtMode,
    signalIssueMode: stringValue(values, "signalIssueMode") as SignalMode,
    mgStepCount: Math.max(0, Math.floor(numberValue(values, "mgStepCount"))),
    profilePeriod: Math.max(
      5,
      Math.floor(numberValue(values, "profilePeriod")),
    ),
    fastPocPeriod: Math.max(
      3,
      Math.floor(numberValue(values, "fastPocPeriod")),
    ),
    rowCount: Math.max(10, Math.floor(numberValue(values, "rowCount"))),
    dmiLength: Math.max(1, Math.floor(numberValue(values, "dmiLength"))),
    minEarlyBars: Math.max(2, Math.floor(numberValue(values, "minEarlyBars"))),
    projectionBars: Math.max(
      1,
      Math.floor(numberValue(values, "projectionBars")),
    ),
    bodyWeight: numberValue(values, "bodyWeight"),
    migrationStrength: numberValue(values, "migrationStrength"),
    migrationConfirmBars: Math.max(
      1,
      Math.floor(numberValue(values, "migrationConfirmBars")),
    ),
    migrationCenterSmoothing: numberValue(values, "migrationCenterSmoothing"),
    activeHistoricalPocCount: Math.max(
      0,
      Math.floor(numberValue(values, "activeHistoricalPocCount")),
    ),
    minZoneBarsToRender: Math.max(
      1,
      Math.floor(numberValue(values, "minZoneBarsToRender")),
    ),
    minZoneHitsToRender: Math.max(
      1,
      Math.floor(numberValue(values, "minZoneHitsToRender")),
    ),
    maxStoredZones: Math.max(
      20,
      Math.floor(numberValue(values, "maxStoredZones")),
    ),
    pocBandHalfRows: numberValue(values, "pocBandHalfRows"),
    bandMergeMode: stringValue(values, "bandMergeMode") as BandMergeMode,
    maxBandExpansionRows: numberValue(values, "maxBandExpansionRows"),
    pocBandSignalSuppressLine: stringValue(
      values,
      "pocBandSignalSuppressLine",
    ) as SuppressionMode,
    drawMode: stringValue(values, "drawMode") as DrawMode,
    adxPocSource: stringValue(values, "adxPocSource") as PriceSource,
    currentColor: stringValue(values, "currentColor"),
    historicalColor: stringValue(values, "historicalColor"),
    frozenColor: stringValue(values, "frozenColor"),
    bandOpacity: numberValue(values, "bandOpacity"),
    lineOpacity: numberValue(values, "lineOpacity"),
    lineWidth: numberValue(values, "lineWidth"),
    ropeUpColor: stringValue(values, "ropeUpColor"),
    ropeDownColor: stringValue(values, "ropeDownColor"),
    ropeFlatColor: stringValue(values, "ropeFlatColor"),
    ropeWidth: numberValue(values, "ropeWidth"),
    showTrailingStop: booleanValue(values, "showTrailingStop"),
    utbotTrailingStopColor: stringValue(values, "utbotTrailingStopColor"),
    utbotUpTrendColor: stringValue(values, "utbotUpTrendColor"),
    utbotDownTrendColor: stringValue(values, "utbotDownTrendColor"),
    buySignalColor: stringValue(values, "buySignalColor"),
    sellSignalColor: stringValue(values, "sellSignalColor"),
  };
}

function computeRope(candles: readonly Candle[], params: Params): RopeResult {
  const source = priceSeries(candles, params.ropeSource);
  const atrValues = ta.atr(candles, params.ropePeriod);
  const rope = Array<number>(candles.length).fill(Number.NaN);
  const upper = Array<number>(candles.length).fill(Number.NaN);
  const lower = Array<number>(candles.length).fill(Number.NaN);
  const lag = Math.floor((params.ropePeriod - 1) / 2);
  let previousRope = source[0] ?? 0;
  for (let index = 0; index < candles.length; index += 1) {
    const current = source[index] ?? Number.NaN;
    const currentAtr = atrValues[index] ?? Number.NaN;
    if (!Number.isFinite(current)) {
      rope[index] = previousRope;
      continue;
    }
    if (!Number.isFinite(currentAtr)) {
      previousRope = current;
      rope[index] = current;
      continue;
    }
    const threshold = Math.max(0, currentAtr * params.ropeMultiplier);
    const move = current - previousRope;
    const absMove = Math.abs(move);
    const sign = Math.sign(move);
    let amount = 0;
    switch (params.ropeSensitivityMode) {
      case "original":
        amount = absMove > threshold ? (absMove - threshold) * sign : 0;
        break;
      case "partial":
        amount =
          absMove < threshold ? move * 0.4 : (absMove - threshold) * sign;
        break;
      case "reduced":
        amount =
          absMove > threshold * 0.5 ? (absMove - threshold * 0.5) * sign : 0;
        break;
      case "momentum": {
        const old = index >= 3 ? (source[index - 3] ?? current) : current;
        const momentum = Math.abs(current - old);
        const denominator = threshold * 3;
        const normalized =
          denominator > Number.EPSILON ? momentum / denominator : 0;
        const factor = 1 + Math.min(normalized, 1) * 0.5;
        amount =
          absMove < threshold
            ? move * 0.3
            : (absMove - threshold * 0.6) * sign * factor;
        break;
      }
      case "ema":
        amount =
          absMove < threshold
            ? move * 0.15
            : (absMove - threshold * 0.7) * sign + move * 0.075;
        break;
      case "adaptive": {
        const old = index >= 5 ? (source[index - 5] ?? current) : current;
        const change = Math.abs(current - old);
        const denominator = threshold * 5;
        const normalized =
          denominator > Number.EPSILON ? change / denominator : 0;
        const adaptiveThreshold =
          threshold * (1 - Math.min(normalized * 0.4, 0.6));
        amount =
          absMove > adaptiveThreshold
            ? (absMove - adaptiveThreshold) * sign
            : 0;
        break;
      }
      case "zerolag": {
        const lagged =
          lag === 0 || index < lag ? current : (source[index - lag] ?? current);
        const zeroLag = lag === 0 ? current : current + (current - lagged);
        const lagMove = zeroLag - previousRope;
        const magnitude = Math.abs(lagMove);
        amount =
          magnitude > threshold
            ? (magnitude - threshold) * Math.sign(lagMove)
            : 0;
        break;
      }
    }
    previousRope += Number.isFinite(amount) ? amount : 0;
    rope[index] = previousRope;
    upper[index] = previousRope + threshold;
    lower[index] = previousRope - threshold;
  }

  const directionInput = rope.map((value, index) =>
    index === 0 ? (source[0] ?? value) : (rope[index - 1] ?? value),
  );
  const directionBase = ta.movingAverage(
    directionInput,
    params.ropeDirectionMaType,
    params.ropeDirectionLookback,
  );
  const directionUpper = Array<number>(candles.length).fill(Number.NaN);
  const directionLower = Array<number>(candles.length).fill(Number.NaN);
  const direction = Array<number>(candles.length).fill(0);
  let bandAtr = Number.NaN;
  for (let index = 0; index < candles.length; index += 1) {
    const base = directionBase[index] ?? Number.NaN;
    const currentAtr = atrValues[index] ?? Number.NaN;
    const ropeValue = rope[index] ?? Number.NaN;
    if (
      !Number.isFinite(base) ||
      !Number.isFinite(currentAtr) ||
      !Number.isFinite(ropeValue)
    )
      continue;
    if (!Number.isFinite(bandAtr)) bandAtr = currentAtr;
    const band = bandAtr * params.ropeDirectionThreshold;
    directionUpper[index] = base + band;
    directionLower[index] = base - band;
    const nextDirection =
      ropeValue > base + band ? 1 : ropeValue < base - band ? -1 : 0;
    direction[index] = nextDirection;
    if (nextDirection === 0) bandAtr = currentAtr;
  }
  return { rope, upper, lower, directionUpper, directionLower, direction };
}

function computeUtBot(candles: readonly Candle[], params: Params): UtResult {
  const source = priceSeries(candles, params.utbotSource);
  const atrValues = ta.atr(candles, params.utbotAtrPeriod);
  const stop = Array<number>(candles.length).fill(Number.NaN);
  const position = Array<number>(candles.length).fill(0);
  const lag = Math.floor((params.utbotAtrPeriod - 1) / 2);
  let previousStop = Number.NaN;
  let previousPosition = 0;
  let previousClose = Number.NaN;
  for (let index = 0; index < candles.length; index += 1) {
    const raw = source[index] ?? Number.NaN;
    const lagged =
      lag === 0 || index < lag ? raw : (source[index - lag] ?? raw);
    const current =
      params.utbotMode === "0lag" && lag > 0 ? raw + (raw - lagged) : raw;
    const currentAtr = atrValues[index] ?? Number.NaN;
    if (!Number.isFinite(current) || !Number.isFinite(currentAtr)) {
      previousClose = Number.isFinite(current) ? current : previousClose;
      continue;
    }
    const loss = Math.max(0, currentAtr * params.utbotKeyValue);
    const previousC = Number.isFinite(previousClose) ? previousClose : current;
    const stopPrev = Number.isFinite(previousStop)
      ? previousStop
      : current - loss;
    let currentStop: number;
    if (!Number.isFinite(previousStop)) currentStop = current - loss;
    else if (current > previousStop && previousC > previousStop)
      currentStop = Math.max(previousStop, current - loss);
    else if (current < previousStop && previousC < previousStop)
      currentStop = Math.min(previousStop, current + loss);
    else currentStop = current > previousStop ? current - loss : current + loss;
    if (index > 0 && Number.isFinite(stopPrev)) {
      if (previousC < stopPrev && current > stopPrev) previousPosition = 1;
      else if (previousC > stopPrev && current < stopPrev)
        previousPosition = -1;
    }
    stop[index] = currentStop;
    position[index] = previousPosition;
    previousStop = currentStop;
    previousClose = current;
  }
  return { stop, position };
}

function projectedPocCandidate(
  candles: readonly Candle[],
  dmi: DmiSeries,
  params: Params,
  barIndex: number,
  previousScores: readonly {
    readonly center: number;
    readonly score: number;
  }[],
): PocCandidate | undefined {
  const profileStart = Math.max(0, barIndex - params.profilePeriod + 1);
  const fastPeriod = Math.min(params.fastPocPeriod, params.profilePeriod);
  const start = Math.max(0, barIndex - fastPeriod + 1);
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let index = profileStart; index <= barIndex; index += 1) {
    const candle = candles[index];
    if (candle === undefined) continue;
    low = Math.min(low, candle.low);
    high = Math.max(high, candle.high);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return undefined;
  if (high <= low) {
    const close = candles[barIndex]?.close ?? 0;
    const tick = Math.max(Math.abs(close) * 1e-8, Number.EPSILON);
    low = close - tick * 5;
    high = close + tick * 5;
  }
  const rowHeight = (high - low) / params.rowCount;
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) return undefined;
  const rows = Array.from({ length: params.rowCount }, (_, row) => ({
    center: low + (row + 0.5) * rowHeight,
    score: 0,
    plus: 0,
    minus: 0,
  }));
  const relMax = Math.max(barIndex - start, 1);
  for (let index = start; index <= barIndex; index += 1) {
    const candle = candles[index];
    if (candle === undefined) continue;
    const plus = dmi.plusDI[index] ?? Number.NaN;
    const minus = dmi.minusDI[index] ?? Number.NaN;
    const adxValue = dmi.adx[index] ?? Number.NaN;
    if (![plus, minus, adxValue].every(Number.isFinite)) continue;
    const total = Math.max(plus + minus, 0.000001);
    const dominance = Math.abs(plus - minus) / total;
    const recency = 0.25 + 0.75 * ((index - start) / relMax);
    const candleScore = adxValue * dominance * recency;
    const startRow = Math.max(
      0,
      Math.min(params.rowCount - 1, Math.floor((candle.low - low) / rowHeight)),
    );
    const endRow = Math.max(
      0,
      Math.min(
        params.rowCount - 1,
        Math.floor((candle.high - low) / rowHeight),
      ),
    );
    const bodyLow = Math.min(candle.open, candle.close);
    const bodyHigh = Math.max(candle.open, candle.close);
    const totalRows = Math.max(1, endRow - startRow + 1);
    const bodyRows: number[] = [];
    for (let row = startRow; row <= endRow; row += 1) {
      const rowLow = low + row * rowHeight;
      const rowHigh = rowLow + rowHeight;
      if (
        bodyLow === bodyHigh
          ? bodyLow >= rowLow && bodyLow <= rowHigh
          : bodyLow < rowHigh && bodyHigh > rowLow
      )
        bodyRows.push(row);
    }
    const bodyCount = Math.max(1, bodyRows.length);
    for (let row = startRow; row <= endRow; row += 1) {
      const target = rows[row];
      if (target === undefined) continue;
      const inBody = bodyRows.includes(row);
      const contribution =
        (candleScore * (1 - params.bodyWeight)) / totalRows +
        (inBody ? (candleScore * params.bodyWeight) / bodyCount : 0);
      target.score += contribution;
      target.plus += plus * contribution;
      target.minus += minus * contribution;
    }
  }
  let best:
    | {
        readonly row: number;
        readonly projected: number;
        readonly previous: number;
      }
    | undefined;
  const scoreLookup = rows.map((row, rowIndex) => {
    let previous = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const old of previousScores) {
      const distance = Math.abs(old.center - row.center);
      if (distance < bestDistance) {
        bestDistance = distance;
        previous = old.score;
      }
    }
    const velocity = row.score - previous;
    const projected = Math.max(0, row.score + velocity * params.projectionBars);
    if (best === undefined || projected > best.projected)
      best = { row: rowIndex, projected, previous };
    return { center: row.center, score: row.score, projectedScore: projected };
  });
  if (best === undefined || best.projected <= 0) return undefined;
  const row = rows[best.row];
  if (row === undefined) return undefined;
  const half = rowHeight * params.pocBandHalfRows;
  return {
    barIndex,
    center: row.center,
    bandLow: row.center - half,
    bandHigh: row.center + half,
    rowHeight,
    projectedScore: best.projected,
    currentScore: row.score,
    velocity: row.score - best.previous,
    scoreLookup,
  };
}

function candidateMatchesBand(
  candidate: PocCandidate,
  band: Pick<PocCandidate, "center" | "bandLow" | "bandHigh">,
  mode: BandMergeMode,
): boolean {
  return mode === "Band Overlap"
    ? candidate.bandLow <= band.bandHigh && candidate.bandHigh >= band.bandLow
    : candidate.center >= band.bandLow && candidate.center <= band.bandHigh;
}

function zoneMatches(
  candidate: PocCandidate,
  zone: PocZone,
  mode: BandMergeMode,
): boolean {
  return candidateMatchesBand(candidate, zone, mode);
}

function zonePriority(zone: PocZone): number {
  if (zone.activeRank === 0 && !zone.frozen) return 0;
  if (zone.activeRank > 0 && !zone.frozen) return 1;
  return 2;
}

function findMatchingZone(
  candidate: PocCandidate,
  zones: readonly PocZone[],
  excluded: PocZone,
  mode: BandMergeMode,
): PocZone | undefined {
  return [...zones]
    .filter((zone) => zone !== excluded)
    .sort((left, right) => zonePriority(left) - zonePriority(right))
    .find((zone) => zoneMatches(candidate, zone, mode));
}

function buildPocZones(
  candles: readonly Candle[],
  params: Params,
  lastClosedIndex: number,
): PocZone[] {
  if (lastClosedIndex < Math.max(params.dmiLength, params.minEarlyBars) - 1)
    return [];
  const pocCandles = candlesWithPriceSource(candles, params.adxPocSource);
  const dmi = ta.dmi(candles, params.dmiLength);
  const zones: PocZone[] = [];
  let current: PocZone | undefined;
  let previousScores: readonly {
    readonly center: number;
    readonly score: number;
  }[] = [];
  let pendingMigration:
    { readonly candidate: PocCandidate; readonly hitCount: number } | undefined;
  const startIndex = Math.max(
    0,
    params.minEarlyBars - 1,
    lastClosedIndex - 3_000,
  );
  for (let barIndex = startIndex; barIndex <= lastClosedIndex; barIndex += 1) {
    const candidate = projectedPocCandidate(
      pocCandles,
      dmi,
      params,
      barIndex,
      previousScores,
    );
    if (candidate === undefined) continue;
    previousScores = candidate.scoreLookup.map((item) => ({
      center: item.center,
      score: item.score,
    }));
    if (current === undefined) {
      current = createZone(candidate);
      zones.push(current);
      rankZones(zones, current, barIndex, params.activeHistoricalPocCount);
      continue;
    }
    if (zoneMatches(candidate, current, params.bandMergeMode)) {
      updateZone(current, candidate, params);
      pendingMigration = undefined;
      rankZones(zones, current, barIndex, params.activeHistoricalPocCount);
      extendZones(zones, current, barIndex, params.activeHistoricalPocCount);
      continue;
    }
    const activeScore = nearestProjectedScore(candidate, current.center);
    const comparison = Math.max(
      activeScore,
      current.projectedScore * 0.25,
      0.000001,
    );
    const migrate =
      candidate.velocity > 0 &&
      candidate.projectedScore > params.migrationStrength * comparison;
    if (migrate) {
      const previousPending = pendingMigration;
      const samePending =
        previousPending !== undefined &&
        candidateMatchesBand(
          candidate,
          previousPending.candidate,
          params.bandMergeMode,
        );
      pendingMigration = samePending
        ? {
            candidate: {
              ...candidate,
              bandLow: Math.min(
                previousPending.candidate.bandLow,
                candidate.bandLow,
              ),
              bandHigh: Math.max(
                previousPending.candidate.bandHigh,
                candidate.bandHigh,
              ),
            },
            hitCount: previousPending.hitCount + 1,
          }
        : { candidate, hitCount: 1 };
      if (pendingMigration.hitCount >= params.migrationConfirmBars) {
        current.frozen = true;
        const matching = findMatchingZone(
          candidate,
          zones,
          current,
          params.bandMergeMode,
        );
        if (matching === undefined) {
          current = createZone(candidate);
          zones.push(current);
        } else {
          current = matching;
          updateZone(current, candidate, params);
        }
        pendingMigration = undefined;
        rankZones(zones, current, barIndex, params.activeHistoricalPocCount);
      }
    } else {
      pendingMigration = undefined;
    }
    extendZones(zones, current, barIndex, params.activeHistoricalPocCount);
  }
  const active = zones.filter((zone) => !zone.frozen);
  const frozen = zones
    .filter((zone) => zone.frozen)
    .sort((left, right) => left.lastSeenIndex - right.lastSeenIndex);
  const keepFrozen = Math.max(0, params.maxStoredZones - active.length);
  return [...frozen.slice(-keepFrozen), ...active].sort(
    (left, right) => left.createdAt - right.createdAt,
  );
}

function createZone(candidate: PocCandidate): PocZone {
  return {
    id: `poc:${candidate.barIndex}:${Math.round(candidate.center * 100000)}`,
    createdAt: candidate.barIndex,
    lastSeenIndex: candidate.barIndex,
    center: candidate.center,
    bandLow: candidate.bandLow,
    bandHigh: candidate.bandHigh,
    rowHeight: candidate.rowHeight,
    hitCount: 1,
    projectedScore: candidate.projectedScore,
    activeRank: 0,
    frozen: false,
    lastActiveOrder: 0,
    segments: [
      {
        startIndex: candidate.barIndex,
        endIndex: candidate.barIndex,
        center: candidate.center,
        bandLow: candidate.bandLow,
        bandHigh: candidate.bandHigh,
      },
    ],
  };
}

function updateZone(
  zone: PocZone,
  candidate: PocCandidate,
  params: Params,
): void {
  const center =
    zone.center * params.migrationCenterSmoothing +
    candidate.center * (1 - params.migrationCenterSmoothing);
  const baseHalf = candidate.rowHeight * params.pocBandHalfRows;
  const maxHalf = candidate.rowHeight * params.maxBandExpansionRows;
  zone.center = center;
  zone.bandLow = Math.max(
    center - maxHalf,
    Math.min(center - baseHalf, candidate.bandLow, zone.bandLow),
  );
  zone.bandHigh = Math.min(
    center + maxHalf,
    Math.max(center + baseHalf, candidate.bandHigh, zone.bandHigh),
  );
  zone.rowHeight = candidate.rowHeight;
  zone.lastSeenIndex = candidate.barIndex;
  zone.hitCount += 1;
  zone.projectedScore = candidate.projectedScore;
  zone.frozen = false;
  let segment = zone.segments.at(-1);
  if (segment === undefined || segment.endIndex < candidate.barIndex - 1) {
    segment = {
      startIndex: candidate.barIndex,
      endIndex: candidate.barIndex,
      center,
      bandLow: zone.bandLow,
      bandHigh: zone.bandHigh,
    };
    zone.segments.push(segment);
  }
  segment.endIndex = candidate.barIndex;
  segment.center = center;
  segment.bandLow = zone.bandLow;
  segment.bandHigh = zone.bandHigh;
}

function nearestProjectedScore(
  candidate: PocCandidate,
  priceValue: number,
): number {
  let result = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (const row of candidate.scoreLookup) {
    const currentDistance = Math.abs(row.center - priceValue);
    if (currentDistance < distance) {
      distance = currentDistance;
      result = row.projectedScore;
    }
  }
  return result;
}

function rankZones(
  zones: readonly PocZone[],
  current: PocZone,
  barIndex: number,
  historicalCount: number,
): void {
  const maxOrder = zones.reduce(
    (max, zone) => Math.max(max, zone.lastActiveOrder),
    0,
  );
  current.lastActiveOrder = maxOrder + 1;
  const ranked = [...zones].sort(
    (left, right) => right.lastActiveOrder - left.lastActiveOrder,
  );
  ranked.forEach((zone, index) => {
    zone.activeRank = index;
    if (index > historicalCount) {
      zone.frozen = true;
      const segment = zone.segments.at(-1);
      if (segment !== undefined)
        segment.endIndex = Math.min(segment.endIndex, barIndex);
    } else if (zone === current || index > 0) {
      zone.frozen = false;
    }
  });
}

function extendZones(
  zones: readonly PocZone[],
  current: PocZone,
  barIndex: number,
  historicalCount: number,
): void {
  for (const zone of zones) {
    if (
      zone.frozen ||
      (zone !== current &&
        (zone.activeRank <= 0 || zone.activeRank > historicalCount))
    )
      continue;
    let segment = zone.segments.at(-1);
    if (segment === undefined || segment.endIndex < barIndex - 1) {
      segment = {
        startIndex: barIndex,
        endIndex: barIndex,
        center: zone.center,
        bandLow: zone.bandLow,
        bandHigh: zone.bandHigh,
      };
      zone.segments.push(segment);
    }
    segment.endIndex = barIndex;
    segment.center = zone.center;
    segment.bandLow = zone.bandLow;
    segment.bandHigh = zone.bandHigh;
  }
}

function suppressionBands(
  zones: readonly PocZone[],
  params: Params,
): SuppressionBand[] {
  return zones.flatMap((zone) =>
    zone.segments
      .filter(
        (segment) =>
          !zone.frozen ||
          segment.endIndex - segment.startIndex + 1 >=
            params.minZoneBarsToRender ||
          zone.hitCount >= params.minZoneHitsToRender,
      )
      .map((segment) => ({
        startIndex: segment.startIndex,
        endIndex: segment.endIndex,
        top: segment.bandHigh,
        bottom: segment.bandLow,
      })),
  );
}

function insideBand(
  index: number,
  value: number,
  bands: readonly SuppressionBand[],
): boolean {
  return (
    Number.isFinite(value) &&
    bands.some(
      (band) =>
        index >= band.startIndex &&
        index <= band.endIndex &&
        value >= band.bottom &&
        value <= band.top,
    )
  );
}

function isBlocked(
  index: number,
  params: Params,
  bands: readonly SuppressionBand[],
  close: readonly number[],
  rope: readonly number[],
  stop: readonly number[],
): boolean {
  switch (params.pocBandSignalSuppressLine) {
    case "off":
      return false;
    case "Any":
      return (
        insideBand(index, close[index] ?? Number.NaN, bands) ||
        insideBand(index, rope[index] ?? Number.NaN, bands) ||
        insideBand(index, stop[index] ?? Number.NaN, bands)
      );
    case "ATR Rope":
      return insideBand(index, rope[index] ?? Number.NaN, bands);
    case "UT Bot":
      return insideBand(index, stop[index] ?? Number.NaN, bands);
    case "ATR Rope + UT Bot":
      return (
        insideBand(index, rope[index] ?? Number.NaN, bands) &&
        insideBand(index, stop[index] ?? Number.NaN, bands)
      );
  }
}

function rgbaWithAlpha(color: string, alpha: number): string {
  const match = /^rgba?\(([^,]+),\s*([^,]+),\s*([^,]+)(?:,\s*[^)]*)?\)$/u.exec(
    color,
  );
  if (match === null) return color;
  const red = Number(match[1]);
  const green = Number(match[2]);
  const blue = Number(match[3]);
  if (![red, green, blue].every(Number.isFinite)) return color;
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha))})`;
}

function zoneColor(zone: PocZone, params: Params): string {
  if (zone.frozen) return params.frozenColor;
  return zone.activeRank === 0 ? params.currentColor : params.historicalColor;
}

function renderZones(
  candles: readonly Candle[],
  zones: readonly PocZone[],
  params: Params,
): IndicatorSnapshot["overlays"] {
  const overlays: IndicatorSnapshot["overlays"][number][] = [];
  for (const zone of zones.slice(-params.maxStoredZones)) {
    for (const segment of zone.segments) {
      const length = segment.endIndex - segment.startIndex + 1;
      if (
        zone.frozen &&
        length < params.minZoneBarsToRender &&
        zone.hitCount < params.minZoneHitsToRender
      )
        continue;
      const start = candles[segment.startIndex];
      const end = candles[Math.min(segment.endIndex + 1, candles.length - 1)];
      if (start === undefined || end === undefined) continue;
      const color = zoneColor(zone, params);
      if (params.drawMode === "Band" || params.drawMode === "Line + Band") {
        overlays.push({
          id: `${zone.id}:band:${segment.startIndex}`,
          kind: "box",
          startTimeMs: start.openTimeMs,
          endTimeMs: end.openTimeMs,
          top: segment.bandHigh,
          bottom: segment.bandLow,
          color: rgbaWithAlpha(color, params.bandOpacity),
        });
      }
      if (params.drawMode === "Line" || params.drawMode === "Line + Band") {
        overlays.push({
          id: `${zone.id}:line:${segment.startIndex}`,
          kind: "line-segment",
          startTimeMs: start.openTimeMs,
          endTimeMs: end.openTimeMs,
          startValue: segment.center,
          endValue: segment.center,
          color: rgbaWithAlpha(color, params.lineOpacity),
          width: params.lineWidth,
          style:
            zone.activeRank === 0 && !zone.frozen
              ? "solid"
              : zone.frozen
                ? "dotted"
                : "dashed",
        });
      }
    }
  }
  return overlays.slice(-2_000);
}

function calculateSignals(
  candles: readonly Candle[],
  params: Params,
  rope: RopeResult,
  ut: UtResult,
  bands: readonly SuppressionBand[],
  finalizedBarIndex: number,
): { readonly buy: number[]; readonly sell: number[] } {
  const buy = Array<number>(candles.length).fill(0);
  const sell = Array<number>(candles.length).fill(0);
  const close = candles.map((candle) => candle.close);
  const usesWinFollow =
    params.signalIssueMode === "Win Follow" ||
    params.signalIssueMode === "Win Follow + MG Follow";
  const usesMgFollow =
    (params.signalIssueMode === "MG Follow" ||
      params.signalIssueMode === "Win Follow + MG Follow") &&
    params.mgStepCount > 0;
  let previousUnified = 0;
  let previousBlocked = false;
  let followDirection: "buy" | "sell" | undefined;
  let lastSignalIndex: number | undefined;
  let mgDirection: "buy" | "sell" | undefined;
  let mgStep = 0;
  let mgSignalIndex: number | undefined;
  const won = (
    direction: "buy" | "sell",
    signalIndex: number | undefined,
    currentIndex: number,
  ): boolean | undefined => {
    if (signalIndex === undefined || signalIndex + 1 > currentIndex)
      return undefined;
    const outcome = candles[signalIndex + 1];
    if (outcome === undefined) return undefined;
    return direction === "buy"
      ? outcome.close > outcome.open
      : outcome.close < outcome.open;
  };
  for (let index = 0; index <= finalizedBarIndex; index += 1) {
    const ropeDirection = rope.direction[index] ?? 0;
    const utPosition = ut.position[index] ?? 0;
    const unified = ropeDirection === utPosition ? ropeDirection : 0;
    const blocked = isBlocked(index, params, bands, close, rope.rope, ut.stop);
    const exitedBand = previousBlocked && !blocked;
    const originalBuy =
      !blocked && unified === 1 && (previousUnified !== 1 || exitedBand);
    const originalSell =
      !blocked && unified === -1 && (previousUnified !== -1 || exitedBand);
    const issue = (direction: "buy" | "sell"): void => {
      if (direction === "buy") buy[index] = 1;
      else sell[index] = 1;
      lastSignalIndex = index;
    };
    const clearMg = (): void => {
      mgDirection = undefined;
      mgStep = 0;
      mgSignalIndex = undefined;
    };
    const startMg = (direction: "buy" | "sell"): void => {
      if (usesMgFollow) {
        mgDirection = direction;
        mgStep = 0;
        mgSignalIndex = lastSignalIndex;
      } else clearMg();
    };
    const runMg = (): void => {
      if (!usesMgFollow || mgDirection === undefined) return;
      const result = won(mgDirection, mgSignalIndex, index);
      if (result === undefined) return;
      if (result) {
        const recovered = mgDirection;
        clearMg();
        followDirection = recovered;
        if (
          (recovered === "buy" && unified === 1) ||
          (recovered === "sell" && unified === -1)
        )
          issue(recovered);
        return;
      }
      if (mgStep >= params.mgStepCount) {
        clearMg();
        followDirection = undefined;
        return;
      }
      issue(mgDirection);
      mgSignalIndex = index;
      mgStep += 1;
    };
    if (params.signalIssueMode === "original") {
      if (originalBuy) buy[index] = 1;
      else if (originalSell) sell[index] = 1;
      followDirection = undefined;
      lastSignalIndex = undefined;
      clearMg();
    } else if (params.signalIssueMode === "MG Follow") {
      if (originalBuy) {
        clearMg();
        issue("buy");
        mgDirection = "buy";
        mgSignalIndex = index;
      } else if (originalSell) {
        clearMg();
        issue("sell");
        mgDirection = "sell";
        mgSignalIndex = index;
      } else runMg();
      followDirection = undefined;
    } else if (usesWinFollow) {
      if (followDirection !== undefined) {
        const sameSide =
          (followDirection === "buy" && unified === 1) ||
          (followDirection === "sell" && unified === -1);
        const result = won(followDirection, lastSignalIndex, index);
        if (!sameSide) {
          if (result === false) startMg(followDirection);
          followDirection = undefined;
        } else if (result === true) issue(followDirection);
        else if (result === false) {
          const lost = followDirection;
          followDirection = undefined;
          startMg(lost);
        }
      }
      if (buy[index] !== 1 && sell[index] !== 1) {
        if (originalBuy) {
          issue("buy");
          followDirection = "buy";
          clearMg();
        } else if (originalSell) {
          issue("sell");
          followDirection = "sell";
          clearMg();
        } else runMg();
      }
    }
    previousUnified = unified;
    previousBlocked = blocked;
  }
  return { buy, sell };
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function ropeTailStep(
  state: LiveTailState,
  candles: readonly Candle[],
  index: number,
  params: Params,
  phase: "building" | "finalized",
): RopePoint {
  const candle = candles[index];
  if (candle === undefined) {
    return {
      rope: Number.NaN,
      upper: Number.NaN,
      lower: Number.NaN,
      directionUpper: Number.NaN,
      directionLower: Number.NaN,
      direction: 0,
    };
  }
  const current = priceSeries([candle], params.ropeSource)[0] ?? Number.NaN;
  const currentAtr = state.ropeAtr.update(candle, phase);
  const previousRope = Number.isFinite(state.previousRope)
    ? state.previousRope
    : current;
  const directionInput = index === 0 ? current : previousRope;
  const directionBase = state.directionMa.update(directionInput, phase);
  let ropeValue = previousRope;
  let upper = Number.NaN;
  let lower = Number.NaN;
  let directionUpper = Number.NaN;
  let directionLower = Number.NaN;
  let direction = 0;
  let nextBandAtr = state.bandAtr;

  if (Number.isFinite(current)) {
    if (!Number.isFinite(currentAtr)) {
      ropeValue = current;
    } else {
      const threshold = Math.max(0, currentAtr * params.ropeMultiplier);
      const move = current - previousRope;
      const absMove = Math.abs(move);
      const sign = Math.sign(move);
      let amount = 0;
      switch (params.ropeSensitivityMode) {
        case "original":
          amount = absMove > threshold ? (absMove - threshold) * sign : 0;
          break;
        case "partial":
          amount =
            absMove < threshold ? move * 0.4 : (absMove - threshold) * sign;
          break;
        case "reduced":
          amount =
            absMove > threshold * 0.5 ? (absMove - threshold * 0.5) * sign : 0;
          break;
        case "momentum": {
          const old =
            index >= 3
              ? (priceSeries(
                  [candles[index - 3] as Candle],
                  params.ropeSource,
                )[0] ?? current)
              : current;
          const momentum = Math.abs(current - old);
          const denominator = threshold * 3;
          const normalized =
            denominator > Number.EPSILON ? momentum / denominator : 0;
          const factor = 1 + Math.min(normalized, 1) * 0.5;
          amount =
            absMove < threshold
              ? move * 0.3
              : (absMove - threshold * 0.6) * sign * factor;
          break;
        }
        case "ema":
          amount =
            absMove < threshold
              ? move * 0.15
              : (absMove - threshold * 0.7) * sign + move * 0.075;
          break;
        case "adaptive": {
          const old =
            index >= 5
              ? (priceSeries(
                  [candles[index - 5] as Candle],
                  params.ropeSource,
                )[0] ?? current)
              : current;
          const change = Math.abs(current - old);
          const denominator = threshold * 5;
          const normalized =
            denominator > Number.EPSILON ? change / denominator : 0;
          const adaptiveThreshold =
            threshold * (1 - Math.min(normalized * 0.4, 0.6));
          amount =
            absMove > adaptiveThreshold
              ? (absMove - adaptiveThreshold) * sign
              : 0;
          break;
        }
        case "zerolag": {
          const lag = Math.floor((params.ropePeriod - 1) / 2);
          const lagged =
            lag === 0 || index < lag
              ? current
              : (priceSeries(
                  [candles[index - lag] as Candle],
                  params.ropeSource,
                )[0] ?? current);
          const zeroLag = lag === 0 ? current : current + (current - lagged);
          const lagMove = zeroLag - previousRope;
          const magnitude = Math.abs(lagMove);
          amount =
            magnitude > threshold
              ? (magnitude - threshold) * Math.sign(lagMove)
              : 0;
          break;
        }
      }
      ropeValue = previousRope + (Number.isFinite(amount) ? amount : 0);
      upper = ropeValue + threshold;
      lower = ropeValue - threshold;
      if (Number.isFinite(directionBase)) {
        const bandAtr = Number.isFinite(state.bandAtr)
          ? state.bandAtr
          : currentAtr;
        const band = bandAtr * params.ropeDirectionThreshold;
        directionUpper = directionBase + band;
        directionLower = directionBase - band;
        direction =
          ropeValue > directionUpper ? 1 : ropeValue < directionLower ? -1 : 0;
        nextBandAtr = direction === 0 ? currentAtr : bandAtr;
      }
    }
  }

  if (phase === "finalized") {
    state.previousRope = ropeValue;
    state.previousAtr = currentAtr;
    if (Number.isFinite(nextBandAtr)) state.bandAtr = nextBandAtr;
    state.finalizedCount = Math.max(state.finalizedCount, index + 1);
  }
  return {
    rope: ropeValue,
    upper,
    lower,
    directionUpper,
    directionLower,
    direction,
  };
}

function utTailStep(
  state: LiveTailState,
  candles: readonly Candle[],
  index: number,
  params: Params,
  phase: "building" | "finalized",
): UtPoint {
  const candle = candles[index];
  if (candle === undefined) return { stop: Number.NaN, position: 0 };
  const raw = priceSeries([candle], params.utbotSource)[0] ?? Number.NaN;
  const lag = Math.floor((params.utbotAtrPeriod - 1) / 2);
  const lagged =
    lag === 0 || index < lag
      ? raw
      : (priceSeries([candles[index - lag] as Candle], params.utbotSource)[0] ??
        raw);
  const current =
    params.utbotMode === "0lag" && lag > 0 ? raw + (raw - lagged) : raw;
  const currentAtr = state.utAtr.update(candle, phase);
  if (!Number.isFinite(current) || !Number.isFinite(currentAtr)) {
    if (phase === "finalized" && Number.isFinite(current)) {
      state.previousUtClose = current;
      state.finalizedCount = Math.max(state.finalizedCount, index + 1);
    }
    return { stop: Number.NaN, position: state.previousUtPosition };
  }
  const loss = Math.max(0, currentAtr * params.utbotKeyValue);
  const previousClose = Number.isFinite(state.previousUtClose)
    ? state.previousUtClose
    : current;
  const previousStop = state.previousUtStop;
  const stopPrev = Number.isFinite(previousStop)
    ? previousStop
    : current - loss;
  let stop: number;
  if (!Number.isFinite(previousStop)) stop = current - loss;
  else if (current > previousStop && previousClose > previousStop) {
    stop = Math.max(previousStop, current - loss);
  } else if (current < previousStop && previousClose < previousStop) {
    stop = Math.min(previousStop, current + loss);
  } else {
    stop = current > previousStop ? current - loss : current + loss;
  }
  let position = state.previousUtPosition;
  if (index > 0 && Number.isFinite(stopPrev)) {
    if (previousClose < stopPrev && current > stopPrev) position = 1;
    else if (previousClose > stopPrev && current < stopPrev) position = -1;
  }
  if (phase === "finalized") {
    state.previousUtStop = stop;
    state.previousUtPosition = position;
    state.previousUtClose = current;
    state.finalizedCount = Math.max(state.finalizedCount, index + 1);
  }
  return { stop, position };
}

function createLiveTailState(params: Params): LiveTailState {
  return {
    ropeAtr: ta.createAtrKernel(params.ropePeriod),
    directionMa: ta.createMovingAverageKernel(
      params.ropeDirectionMaType,
      params.ropeDirectionLookback,
    ),
    utAtr: ta.createAtrKernel(params.utbotAtrPeriod),
    finalizedCount: 0,
    previousRope: Number.NaN,
    bandAtr: Number.NaN,
    previousAtr: Number.NaN,
    previousUtStop: Number.NaN,
    previousUtPosition: 0,
    previousUtClose: Number.NaN,
  };
}

function rebuildLiveTailState(
  candles: readonly Candle[],
  finalizedCount: number,
  params: Params,
): LiveTailState {
  const state = createLiveTailState(params);
  const end = Math.min(finalizedCount, candles.length);
  for (let index = 0; index < end; index += 1) {
    ropeTailStep(state, candles, index, params, "finalized");
    utTailStep(state, candles, index, params, "finalized");
  }
  state.finalizedCount = end;
  return state;
}

function livePoint(
  candle: Candle,
  rope: RopePoint,
  ut: UtPoint,
  params: Params,
): IndicatorSnapshot["points"][number] {
  return {
    openTimeMs: candle.openTimeMs,
    values: {
      rope: finiteOrNull(rope.rope),
      directionUpper: finiteOrNull(rope.directionUpper),
      directionLower: finiteOrNull(rope.directionLower),
      utStop: params.showTrailingStop ? finiteOrNull(ut.stop) : null,
      buyMarker: null,
      sellMarker: null,
    },
    colors: {
      rope:
        rope.direction > 0
          ? params.ropeUpColor
          : rope.direction < 0
            ? params.ropeDownColor
            : params.ropeFlatColor,
      utStop:
        ut.position > 0
          ? params.utbotUpTrendColor
          : ut.position < 0
            ? params.utbotDownTrendColor
            : params.utbotTrailingStopColor,
      buyMarker: params.buySignalColor,
      sellMarker: params.sellSignalColor,
    },
    sizes: { rope: params.ropeWidth },
  };
}

function calculate(
  candles: readonly Candle[],
  params: Params,
  context: IndicatorInstanceContext,
  requestedFinalizedBarIndex = Math.max(-1, candles.length - 2),
): CalculationResult {
  if (candles.length === 0)
    return {
      points: [],
      overlays: [],
      signals: [],
      finalizedBarIndex: -1,
      pocZones: [],
    };
  const rope = computeRope(candles, params);
  const ut = computeUtBot(candles, params);
  const finalizedBarIndex = Math.min(
    candles.length - 1,
    Math.max(-1, requestedFinalizedBarIndex),
  );
  const zones = buildPocZones(candles, params, finalizedBarIndex);
  const bands = suppressionBands(zones, params);
  const signalFlags = calculateSignals(
    candles,
    params,
    rope,
    ut,
    bands,
    finalizedBarIndex,
  );
  const markerAtr = ta.atr(
    candles,
    Math.max(params.ropePeriod, params.utbotAtrPeriod),
  );
  const points = candles.map((candle, index) => {
    const ropeValue = rope.rope[index] ?? Number.NaN;
    const direction = rope.direction[index] ?? 0;
    const stop = ut.stop[index] ?? Number.NaN;
    const position = ut.position[index] ?? 0;
    const padding = Number.isFinite(markerAtr[index])
      ? Math.max(markerAtr[index] as number, Number.EPSILON) * 0.35
      : Math.max(Math.abs(candle.close) * 1e-5, Number.EPSILON);
    return {
      openTimeMs: candle.openTimeMs,
      values: {
        rope: finiteOrNull(ropeValue),
        directionUpper: finiteOrNull(rope.directionUpper[index] ?? Number.NaN),
        directionLower: finiteOrNull(rope.directionLower[index] ?? Number.NaN),
        utStop: params.showTrailingStop ? finiteOrNull(stop) : null,
        buyMarker: signalFlags.buy[index] === 1 ? candle.low - padding : null,
        sellMarker:
          signalFlags.sell[index] === 1 ? candle.high + padding : null,
      },
      colors: {
        rope:
          direction > 0
            ? params.ropeUpColor
            : direction < 0
              ? params.ropeDownColor
              : params.ropeFlatColor,
        utStop:
          position > 0
            ? params.utbotUpTrendColor
            : position < 0
              ? params.utbotDownTrendColor
              : params.utbotTrailingStopColor,
        buyMarker: params.buySignalColor,
        sellMarker: params.sellSignalColor,
      },
      sizes: {
        rope: params.ropeWidth,
      },
    };
  });
  const signals: SignalCandidate[] = [];
  for (let index = 0; index <= finalizedBarIndex; index += 1) {
    const candle = candles[index];
    if (candle === undefined) continue;
    const direction =
      signalFlags.buy[index] === 1
        ? "long"
        : signalFlags.sell[index] === 1
          ? "short"
          : undefined;
    if (direction === undefined) continue;
    signals.push({
      signalContractVersion: indicatorContractVersion,
      id: `${definitionId}:${candle.openTimeMs}:${direction}`,
      indicatorId: definitionId,
      instrumentId: context.instrumentId,
      timeframeId: context.timeframeId,
      occurredAtMs: candle.openTimeMs,
      direction,
      finalized: true,
    });
  }
  return {
    points,
    overlays: renderZones(candles, zones, params),
    signals,
    finalizedBarIndex,
    pocZones: zones,
  };
}

function upsertCandle(candles: readonly Candle[], candle: Candle): Candle[] {
  const next = [...candles];
  const index = next.findIndex((item) => item.openTimeMs === candle.openTimeMs);
  if (index >= 0) next[index] = candle;
  else next.push(candle);
  next.sort((left, right) => left.openTimeMs - right.openTimeMs);
  return next;
}

export function createInstance(
  parameterValues: Readonly<Record<string, IndicatorInputValue>>,
  context: IndicatorInstanceContext,
): RuntimeIndicatorInstance {
  const params = toParams(parameterValues);
  let candles: Candle[] = [];
  let points: IndicatorSnapshot["points"][number][] = [];
  let visualRevision = 0;
  let current: CalculationResult = {
    points: [],
    overlays: [],
    signals: [],
    finalizedBarIndex: -1,
    pocZones: [],
  };
  let liveTail = createLiveTailState(params);
  let disposed = false;

  const rebuild = (finalizedBarIndex: number): void => {
    if (disposed) return;
    current = calculate(candles, params, context, finalizedBarIndex);
    visualRevision += 1;
    points = [...current.points];
    current = { ...current, points };
    liveTail = rebuildLiveTailState(
      candles,
      Math.max(0, finalizedBarIndex + 1),
      params,
    );
  };

  return {
    onHistory: (history): void => {
      candles = [...history].sort(
        (left, right) => left.openTimeMs - right.openTimeMs,
      );
      rebuild(Math.max(-1, candles.length - 2));
    },
    onBuildingBar: (candle): void => {
      if (disposed) return;
      const previous = candles.at(-1);
      const sameBuilding = previous?.openTimeMs === candle.openTimeMs;
      if (sameBuilding) candles[candles.length - 1] = candle;
      else if (
        previous === undefined ||
        candle.openTimeMs > previous.openTimeMs
      )
        candles.push(candle);
      else {
        candles = upsertCandle(candles, candle);
        rebuild(Math.max(-1, candles.length - 2));
        return;
      }
      const index = candles.length - 1;
      if (!sameBuilding) visualRevision += 1;
      if (index < 0 || index !== liveTail.finalizedCount) {
        rebuild(Math.max(-1, candles.length - 2));
        return;
      }
      const rope = ropeTailStep(liveTail, candles, index, params, "building");
      const ut = utTailStep(liveTail, candles, index, params, "building");
      points[index] = livePoint(candle, rope, ut, params);
      current = {
        ...current,
        points,
        // Zone geometry depends on finalized bars and the tail timestamp, not its live price.
        overlays: sameBuilding
          ? current.overlays
          : renderZones(candles, current.pocZones, params),
        finalizedBarIndex: index - 1,
      };
    },
    onFinalizedBar: (candle): void => {
      if (disposed) return;
      candles = upsertCandle(candles, candle);
      const index = candles.findIndex(
        (item) => item.openTimeMs === candle.openTimeMs,
      );
      rebuild(index < 0 ? Math.max(-1, candles.length - 2) : index);
    },
    snapshot: (): IndicatorSnapshot => ({
      visualRevision,
      points: current.points,
      overlays: current.overlays,
      ...(current.signals === undefined ? {} : { signals: current.signals }),
    }),
    dispose: (): void => {
      disposed = true;
      candles = [];
      points = [];
      liveTail = createLiveTailState(params);
      current = {
        points: [],
        overlays: [],
        signals: [],
        finalizedBarIndex: -1,
        pocZones: [],
      };
    },
  };
}
const plugin: IndicatorPluginModule = { definition, createInstance };
export default plugin;
