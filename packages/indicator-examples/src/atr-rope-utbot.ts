import {
  appendSeries,
  defineIndicator,
  input,
  laggedValue,
  movingAverageTypes,
  plot,
  priceSources,
  priceValue,
  series,
  signal,
  ta,
  type DmiPoint,
  type IndicatorBar,
  type IndicatorPluginModule,
} from "@erc-chart/indicator-sdk";

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

type BandMergeMode = (typeof bandMergeModes)[number];
type Direction = -1 | 0 | 1;
type SignalSide = "buy" | "sell";

interface RopeState {
  readonly previousRope: number;
  readonly rope: number;
  readonly directionInput: number;
  readonly sources: readonly number[];
}

interface RopeDirectionState {
  readonly bandAtr: number;
  readonly upper: number;
  readonly lower: number;
  readonly direction: Direction;
}

interface UtState {
  readonly previousStop: number;
  readonly previousClose: number;
  readonly stop: number;
  readonly position: Direction;
  readonly sources: readonly number[];
}

interface PocBar {
  readonly index: number;
  readonly openTimeMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly dmi: DmiPoint;
}

interface PocCandidate {
  readonly barIndex: number;
  readonly openTimeMs: number;
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
  startTimeMs: number;
  endTimeMs: number;
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

interface PocState {
  readonly bars: readonly PocBar[];
  readonly zones: readonly PocZone[];
  readonly currentZoneId?: string;
  readonly previousScores: readonly {
    readonly center: number;
    readonly score: number;
  }[];
  readonly pendingMigration?: {
    readonly candidate: PocCandidate;
    readonly hitCount: number;
  };
}

interface SignalOutcome {
  readonly index: number;
  readonly open: number;
  readonly close: number;
}

interface SignalState {
  previousUnified: Direction;
  previousBlocked: boolean;
  followDirection: SignalSide | undefined;
  lastSignalIndex: number | undefined;
  mgDirection: SignalSide | undefined;
  mgStep: number;
  mgSignalIndex: number | undefined;
  outcomes: readonly SignalOutcome[];
  buy: boolean;
  sell: boolean;
}

const emptyRopeState: RopeState = {
  previousRope: Number.NaN,
  rope: Number.NaN,
  directionInput: Number.NaN,
  sources: [],
};
const emptyRopeDirectionState: RopeDirectionState = {
  bandAtr: Number.NaN,
  upper: Number.NaN,
  lower: Number.NaN,
  direction: 0,
};
const emptyUtState: UtState = {
  previousStop: Number.NaN,
  previousClose: Number.NaN,
  stop: Number.NaN,
  position: 0,
  sources: [],
};
const emptyPocState: PocState = {
  bars: [],
  zones: [],
  previousScores: [],
};
const emptySignalState: SignalState = {
  previousUnified: 0,
  previousBlocked: false,
  followDirection: undefined,
  lastSignalIndex: undefined,
  mgDirection: undefined,
  mgStep: 0,
  mgSignalIndex: undefined,
  outcomes: [],
  buy: false,
  sell: false,
};

function readInputs() {
  return {
    ropePeriod: input.int(14, {
      key: "ropePeriod",
      title: "ATR period",
      group: "ATR Rope",
      min: 1,
      max: 500,
    }),
    ropeMultiplier: input.float(1.5, {
      key: "ropeMultiplier",
      title: "Sensitivity multiplier",
      group: "ATR Rope",
      min: 0.1,
      max: 10,
      step: 0.1,
    }),
    ropeSource: input.string("close", {
      key: "ropeSource",
      title: "Price source",
      group: "ATR Rope",
      options: priceSources,
    }),
    ropeSensitivityMode: input.string("original", {
      key: "ropeSensitivityMode",
      title: "Sensitivity mode",
      group: "ATR Rope",
      options: ropeModes,
    }),
    ropeDirectionMaType: input.string("sma", {
      key: "ropeDirectionMaType",
      title: "Direction MA",
      group: "ATR Rope Direction",
      options: movingAverageTypes,
    }),
    ropeDirectionLookback: input.int(2, {
      key: "ropeDirectionLookback",
      title: "Direction lookback",
      group: "ATR Rope Direction",
      min: 1,
      max: 20,
    }),
    ropeDirectionThreshold: input.float(0.05, {
      key: "ropeDirectionThreshold",
      title: "Direction threshold",
      group: "ATR Rope Direction",
      min: 0,
      max: 500,
      step: 0.01,
    }),
    utbotKeyValue: input.float(1, {
      key: "utbotKeyValue",
      title: "ATR multiplier",
      group: "UT Bot",
      min: 0.1,
      max: 10,
      step: 0.1,
    }),
    utbotAtrPeriod: input.int(10, {
      key: "utbotAtrPeriod",
      title: "ATR period",
      group: "UT Bot",
      min: 1,
      max: 500,
    }),
    utbotSource: input.string("close", {
      key: "utbotSource",
      title: "Price source",
      group: "UT Bot",
      options: priceSources,
    }),
    utbotMode: input.string("original", {
      key: "utbotMode",
      title: "Mode",
      group: "UT Bot",
      options: utModes,
    }),
    signalIssueMode: input.string("original", {
      key: "signalIssueMode",
      title: "Signal mode",
      group: "Signals",
      options: signalModes,
    }),
    mgStepCount: input.int(0, {
      key: "mgStepCount",
      title: "MG follow steps",
      group: "Signals",
      min: 0,
      max: 20,
    }),
    buySignalColor: input.color("#089981", {
      key: "buySignalColor",
      title: "Buy color",
      group: "Signals",
      effect: "presentation",
    }),
    sellSignalColor: input.color("#F23645", {
      key: "sellSignalColor",
      title: "Sell color",
      group: "Signals",
      effect: "presentation",
    }),
    adxPocSource: input.string("close", {
      key: "adxPocSource",
      title: "Price source",
      group: "ADX POC",
      options: priceSources,
    }),
    profilePeriod: input.int(30, {
      key: "profilePeriod",
      title: "Profile period",
      group: "ADX POC",
      min: 5,
      max: 500,
    }),
    fastPocPeriod: input.int(10, {
      key: "fastPocPeriod",
      title: "Fast POC period",
      group: "ADX POC",
      min: 3,
      max: 100,
    }),
    rowCount: input.int(24, {
      key: "rowCount",
      title: "Price rows",
      group: "ADX POC",
      min: 10,
      max: 100,
    }),
    dmiLength: input.int(14, {
      key: "dmiLength",
      title: "ADX / DI length",
      group: "ADX POC",
      min: 1,
      max: 500,
    }),
    minEarlyBars: input.int(5, {
      key: "minEarlyBars",
      title: "Minimum early bars",
      group: "ADX POC",
      min: 2,
      max: 100,
    }),
    projectionBars: input.int(5, {
      key: "projectionBars",
      title: "Projection bars",
      group: "ADX POC Migration",
      min: 1,
      max: 50,
    }),
    bodyWeight: input.float(0.7, {
      key: "bodyWeight",
      title: "Body weight",
      group: "ADX POC",
      min: 0,
      max: 1,
      step: 0.05,
    }),
    migrationStrength: input.float(1.1, {
      key: "migrationStrength",
      title: "Migration strength",
      group: "ADX POC Migration",
      min: 1,
      max: 3,
      step: 0.05,
    }),
    migrationConfirmBars: input.int(1, {
      key: "migrationConfirmBars",
      title: "Migration confirmations",
      group: "ADX POC Migration",
      min: 1,
      max: 5,
    }),
    migrationCenterSmoothing: input.float(0.1, {
      key: "migrationCenterSmoothing",
      title: "Center smoothing",
      group: "ADX POC Migration",
      min: 0,
      max: 0.95,
      step: 0.05,
    }),
    activeHistoricalPocCount: input.int(1, {
      key: "activeHistoricalPocCount",
      title: "Active historical POCs",
      group: "ADX POC Zones",
      min: 0,
      max: 20,
    }),
    minZoneBarsToRender: input.int(3, {
      key: "minZoneBarsToRender",
      title: "Minimum zone bars",
      group: "ADX POC Zones",
      min: 1,
      max: 20,
    }),
    minZoneHitsToRender: input.int(2, {
      key: "minZoneHitsToRender",
      title: "Minimum zone hits",
      group: "ADX POC Zones",
      min: 1,
      max: 20,
    }),
    maxStoredZones: input.int(300, {
      key: "maxStoredZones",
      title: "Maximum stored zones",
      group: "ADX POC Zones",
      min: 20,
      max: 1000,
      step: 10,
    }),
    pocBandHalfRows: input.float(1.5, {
      key: "pocBandHalfRows",
      title: "Band half rows",
      group: "ADX POC Band",
      min: 0.1,
      max: 20,
      step: 0.1,
    }),
    bandMergeMode: input.string("Inside Band", {
      key: "bandMergeMode",
      title: "Band merge mode",
      group: "ADX POC Band",
      options: bandMergeModes,
    }),
    maxBandExpansionRows: input.float(2, {
      key: "maxBandExpansionRows",
      title: "Maximum band expansion",
      group: "ADX POC Band",
      min: 0.5,
      max: 20,
      step: 0.25,
    }),
    pocBandSignalSuppressLine: input.string("off", {
      key: "pocBandSignalSuppressLine",
      title: "Signal suppression",
      group: "ADX POC Suppression",
      options: suppressionModes,
    }),
    drawMode: input.string("Line + Band", {
      key: "drawMode",
      title: "POC draw mode",
      group: "ADX POC Style",
      options: drawModes,
      effect: "presentation",
    }),
    currentColor: input.color("rgba(255, 255, 0, 1)", {
      key: "currentColor",
      title: "Current POC",
      group: "ADX POC Style",
      effect: "presentation",
    }),
    historicalColor: input.color("rgba(255, 213, 79, 0.75)", {
      key: "historicalColor",
      title: "Historical POC",
      group: "ADX POC Style",
      effect: "presentation",
    }),
    frozenColor: input.color("rgba(255, 255, 0, 0.35)", {
      key: "frozenColor",
      title: "Frozen POC",
      group: "ADX POC Style",
      effect: "presentation",
    }),
    bandOpacity: input.float(0.18, {
      key: "bandOpacity",
      title: "Band opacity",
      group: "ADX POC Style",
      min: 0,
      max: 1,
      step: 0.05,
      effect: "presentation",
    }),
    lineOpacity: input.float(0.95, {
      key: "lineOpacity",
      title: "Line opacity",
      group: "ADX POC Style",
      min: 0,
      max: 1,
      step: 0.05,
      effect: "presentation",
    }),
    lineWidth: input.int(2, {
      key: "lineWidth",
      title: "Line width",
      group: "ADX POC Style",
      min: 1,
      max: 5,
      effect: "presentation",
    }),
    ropeUpColor: input.color("#3daa45", {
      key: "ropeUpColor",
      title: "Rope up color",
      group: "Display",
      effect: "presentation",
    }),
    ropeDownColor: input.color("#ff033e", {
      key: "ropeDownColor",
      title: "Rope down color",
      group: "Display",
      effect: "presentation",
    }),
    ropeFlatColor: input.color("#004d92", {
      key: "ropeFlatColor",
      title: "Rope flat color",
      group: "Display",
      effect: "presentation",
    }),
    ropeWidth: input.int(3, {
      key: "ropeWidth",
      title: "Rope width",
      group: "Display",
      min: 1,
      max: 10,
      effect: "presentation",
    }),
    showTrailingStop: input.bool(true, {
      key: "showTrailingStop",
      title: "Show trailing stop",
      group: "Display",
      effect: "presentation",
    }),
    utbotTrailingStopColor: input.color("#787B86", {
      key: "utbotTrailingStopColor",
      title: "UT neutral color",
      group: "Display",
      effect: "presentation",
    }),
    utbotUpTrendColor: input.color("#089981", {
      key: "utbotUpTrendColor",
      title: "UT up color",
      group: "Display",
      effect: "presentation",
    }),
    utbotDownTrendColor: input.color("#F23645", {
      key: "utbotDownTrendColor",
      title: "UT down color",
      group: "Display",
      effect: "presentation",
    }),
  };
}

type Params = ReturnType<typeof readInputs>;

function stepRope(
  previous: Readonly<RopeState>,
  current: number,
  currentAtr: number,
  params: Params,
): RopeState {
  const lag = Math.floor((params.ropePeriod - 1) / 2);
  const previousRope = Number.isFinite(previous.previousRope)
    ? previous.previousRope
    : current;
  const directionInput = Number.isFinite(previous.previousRope)
    ? previous.previousRope
    : current;
  const sources = appendSeries(previous.sources, current, Math.max(6, lag + 1));
  if (!Number.isFinite(current)) {
    return { previousRope, rope: previousRope, directionInput, sources };
  }
  if (!Number.isFinite(currentAtr)) {
    return { previousRope: current, rope: current, directionInput, sources };
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
      amount = absMove < threshold ? move * 0.4 : (absMove - threshold) * sign;
      break;
    case "reduced":
      amount =
        absMove > threshold * 0.5 ? (absMove - threshold * 0.5) * sign : 0;
      break;
    case "momentum": {
      const old = laggedValue(previous.sources, current, 3);
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
      const old = laggedValue(previous.sources, current, 5);
      const change = Math.abs(current - old);
      const denominator = threshold * 5;
      const normalized =
        denominator > Number.EPSILON ? change / denominator : 0;
      const adaptiveThreshold =
        threshold * (1 - Math.min(normalized * 0.4, 0.6));
      amount =
        absMove > adaptiveThreshold ? (absMove - adaptiveThreshold) * sign : 0;
      break;
    }
    case "zerolag": {
      const lagged = laggedValue(previous.sources, current, lag);
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
  const rope = previousRope + (Number.isFinite(amount) ? amount : 0);
  return { previousRope: rope, rope, directionInput, sources };
}

function stepRopeDirection(
  previous: Readonly<RopeDirectionState>,
  rope: number,
  currentAtr: number,
  base: number,
  threshold: number,
): RopeDirectionState {
  if (![rope, currentAtr, base].every(Number.isFinite)) {
    return {
      bandAtr: previous.bandAtr,
      upper: Number.NaN,
      lower: Number.NaN,
      direction: 0,
    };
  }
  const bandAtr = Number.isFinite(previous.bandAtr)
    ? previous.bandAtr
    : currentAtr;
  const band = bandAtr * threshold;
  const upper = base + band;
  const lower = base - band;
  const direction: Direction = rope > upper ? 1 : rope < lower ? -1 : 0;
  return {
    bandAtr: direction === 0 ? currentAtr : bandAtr,
    upper,
    lower,
    direction,
  };
}

function stepUtBot(
  previous: Readonly<UtState>,
  raw: number,
  currentAtr: number,
  index: number,
  params: Params,
): UtState {
  const lag = Math.floor((params.utbotAtrPeriod - 1) / 2);
  const lagged = laggedValue(previous.sources, raw, lag);
  const current =
    params.utbotMode === "0lag" && lag > 0 ? raw + (raw - lagged) : raw;
  const sources = appendSeries(previous.sources, raw, lag + 1);
  if (!Number.isFinite(current) || !Number.isFinite(currentAtr)) {
    return {
      ...previous,
      previousClose: Number.isFinite(current)
        ? current
        : previous.previousClose,
      stop: Number.NaN,
      sources,
    };
  }

  const loss = Math.max(0, currentAtr * params.utbotKeyValue);
  const previousClose = Number.isFinite(previous.previousClose)
    ? previous.previousClose
    : current;
  const stopPrev = Number.isFinite(previous.previousStop)
    ? previous.previousStop
    : current - loss;
  let stop: number;
  if (!Number.isFinite(previous.previousStop)) stop = current - loss;
  else if (
    current > previous.previousStop &&
    previousClose > previous.previousStop
  )
    stop = Math.max(previous.previousStop, current - loss);
  else if (
    current < previous.previousStop &&
    previousClose < previous.previousStop
  )
    stop = Math.min(previous.previousStop, current + loss);
  else stop = current > previous.previousStop ? current - loss : current + loss;

  let position = previous.position;
  if (index > 0 && Number.isFinite(stopPrev)) {
    if (previousClose < stopPrev && current > stopPrev) position = 1;
    else if (previousClose > stopPrev && current < stopPrev) position = -1;
  }
  return {
    previousStop: stop,
    previousClose: current,
    stop,
    position,
    sources,
  };
}

function cloneZone(zone: PocZone): PocZone {
  return {
    ...zone,
    segments: [...zone.segments],
  };
}

function projectedPocCandidate(
  bars: readonly PocBar[],
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
  const profileBars = bars.filter((bar) => bar.index >= profileStart);
  const fastBars = bars.filter((bar) => bar.index >= start);
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const bar of profileBars) {
    low = Math.min(low, bar.low);
    high = Math.max(high, bar.high);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return undefined;
  const currentBar = bars.at(-1);
  if (currentBar === undefined) return undefined;
  if (high <= low) {
    const tick = Math.max(Math.abs(currentBar.close) * 1e-8, Number.EPSILON);
    low = currentBar.close - tick * 5;
    high = currentBar.close + tick * 5;
  }
  const rowHeight = (high - low) / params.rowCount;
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) return undefined;
  const rows = Array.from({ length: params.rowCount }, (_, row) => ({
    center: low + (row + 0.5) * rowHeight,
    score: 0,
  }));
  const relMax = Math.max(barIndex - start, 1);
  for (const bar of fastBars) {
    const { plusDI: plus, minusDI: minus, adx } = bar.dmi;
    if (![plus, minus, adx].every(Number.isFinite)) continue;
    const total = Math.max(plus + minus, 0.000001);
    const dominance = Math.abs(plus - minus) / total;
    const recency = 0.25 + 0.75 * ((bar.index - start) / relMax);
    const candleScore = adx * dominance * recency;
    const startRow = Math.max(
      0,
      Math.min(params.rowCount - 1, Math.floor((bar.low - low) / rowHeight)),
    );
    const endRow = Math.max(
      0,
      Math.min(params.rowCount - 1, Math.floor((bar.high - low) / rowHeight)),
    );
    const bodyLow = Math.min(bar.open, bar.close);
    const bodyHigh = Math.max(bar.open, bar.close);
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
      const contribution =
        (candleScore * (1 - params.bodyWeight)) / totalRows +
        (bodyRows.includes(row)
          ? (candleScore * params.bodyWeight) / bodyCount
          : 0);
      target.score += contribution;
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
    let oldScore = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const old of previousScores) {
      const distance = Math.abs(old.center - row.center);
      if (distance < bestDistance) {
        bestDistance = distance;
        oldScore = old.score;
      }
    }
    const velocity = row.score - oldScore;
    const projected = Math.max(0, row.score + velocity * params.projectionBars);
    if (best === undefined || projected > best.projected)
      best = { row: rowIndex, projected, previous: oldScore };
    return { center: row.center, score: row.score, projectedScore: projected };
  });
  if (best === undefined || best.projected <= 0) return undefined;
  const row = rows[best.row];
  if (row === undefined) return undefined;
  const half = rowHeight * params.pocBandHalfRows;
  return {
    barIndex,
    openTimeMs: currentBar.openTimeMs,
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
        startTimeMs: candidate.openTimeMs,
        endTimeMs: candidate.openTimeMs,
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
      startTimeMs: candidate.openTimeMs,
      endTimeMs: candidate.openTimeMs,
      center,
      bandLow: zone.bandLow,
      bandHigh: zone.bandHigh,
    };
    zone.segments.push(segment);
  } else {
    segment = { ...segment };
    zone.segments[zone.segments.length - 1] = segment;
  }
  segment.endIndex = candidate.barIndex;
  segment.endTimeMs = candidate.openTimeMs;
  segment.center = center;
  segment.bandLow = zone.bandLow;
  segment.bandHigh = zone.bandHigh;
}

function nearestProjectedScore(candidate: PocCandidate, value: number): number {
  let result = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (const row of candidate.scoreLookup) {
    const currentDistance = Math.abs(row.center - value);
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
      const priorSegment = zone.segments.at(-1);
      if (priorSegment !== undefined) {
        const segment = { ...priorSegment };
        zone.segments[zone.segments.length - 1] = segment;
        segment.endIndex = Math.min(segment.endIndex, barIndex);
      }
    } else if (zone === current || index > 0) zone.frozen = false;
  });
}

function extendZones(
  zones: readonly PocZone[],
  current: PocZone,
  barIndex: number,
  openTimeMs: number,
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
        startTimeMs: openTimeMs,
        endTimeMs: openTimeMs,
        center: zone.center,
        bandLow: zone.bandLow,
        bandHigh: zone.bandHigh,
      };
      zone.segments.push(segment);
    } else {
      segment = { ...segment };
      zone.segments[zone.segments.length - 1] = segment;
    }
    segment.endIndex = barIndex;
    segment.endTimeMs = openTimeMs;
    segment.center = zone.center;
    segment.bandLow = zone.bandLow;
    segment.bandHigh = zone.bandHigh;
  }
}

function advanceSegmentEnds(
  zones: readonly PocZone[],
  bar: IndicatorBar,
): void {
  for (const zone of zones) {
    const priorSegment = zone.segments.at(-1);
    if (priorSegment?.endIndex !== bar.index - 1) continue;
    const segment = { ...priorSegment, endTimeMs: bar.openTimeMs };
    zone.segments[zone.segments.length - 1] = segment;
  }
}

function zoneIsRenderable(
  zone: PocZone,
  segment: PocSegment,
  params: Params,
): boolean {
  return (
    !zone.frozen ||
    segment.endIndex - segment.startIndex + 1 >= params.minZoneBarsToRender ||
    zone.hitCount >= params.minZoneHitsToRender
  );
}

function drawZones(
  zones: readonly PocZone[],
  params: Params,
  bar: IndicatorBar,
): void {
  for (const zone of zones) {
    for (const segment of zone.segments) {
      if (!zoneIsRenderable(zone, segment, params)) continue;
      const endTimeMs =
        segment.endIndex + 1 === bar.index ? bar.openTimeMs : segment.endTimeMs;
      const color = zoneColor(zone, params);
      if (params.drawMode === "Band" || params.drawMode === "Line + Band") {
        plot.box({
          left: segment.startTimeMs,
          right: endTimeMs,
          top: segment.bandHigh,
          bottom: segment.bandLow,
          color: rgbaWithAlpha(color, params.bandOpacity),
        });
      }
      if (params.drawMode === "Line" || params.drawMode === "Line + Band") {
        plot.segment({
          left: segment.startTimeMs,
          right: endTimeMs,
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
}

function trimZones(zones: readonly PocZone[], params: Params): PocZone[] {
  const active = zones.filter((zone) => !zone.frozen);
  const frozen = zones
    .filter((zone) => zone.frozen)
    .sort((left, right) => left.lastSeenIndex - right.lastSeenIndex);
  const keepFrozen = Math.max(0, params.maxStoredZones - active.length);
  return [...frozen.slice(-keepFrozen), ...active].sort(
    (left, right) => left.createdAt - right.createdAt,
  );
}

function stepPoc(
  previous: Readonly<PocState>,
  bar: IndicatorBar,
  dmi: DmiPoint,
  params: Params,
): PocState {
  if (!bar.isConfirmed) return { ...previous };
  const pocBar: PocBar = {
    index: bar.index,
    openTimeMs: bar.openTimeMs,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: priceValue(bar, params.adxPocSource),
    dmi,
  };
  const bars = [...previous.bars, pocBar].filter(
    (item) => item.index >= bar.index - params.profilePeriod + 1,
  );
  // Retained history is replayed once from a fresh series kernel, so its prior
  // POC state will never be revisited. Reuse those zone objects during replay
  // instead of copying an ever-growing segment history on every candle. Live
  // finalized updates still use copy-on-write state for building-bar rollback.
  let zones = bar.isHistory
    ? [...previous.zones]
    : previous.zones.map(cloneZone);
  advanceSegmentEnds(zones, bar);
  let current = previous.currentZoneId
    ? zones.find((zone) => zone.id === previous.currentZoneId)
    : undefined;
  let previousScores = previous.previousScores;
  let pendingMigration = previous.pendingMigration;

  if (bar.index >= Math.max(params.dmiLength, params.minEarlyBars) - 1) {
    const candidate = projectedPocCandidate(
      bars,
      params,
      bar.index,
      previousScores,
    );
    if (candidate !== undefined) {
      previousScores = candidate.scoreLookup.map((item) => ({
        center: item.center,
        score: item.score,
      }));
      if (current === undefined) {
        current = createZone(candidate);
        zones.push(current);
        rankZones(zones, current, bar.index, params.activeHistoricalPocCount);
      } else if (zoneMatches(candidate, current, params.bandMergeMode)) {
        updateZone(current, candidate, params);
        pendingMigration = undefined;
        rankZones(zones, current, bar.index, params.activeHistoricalPocCount);
        extendZones(
          zones,
          current,
          bar.index,
          bar.openTimeMs,
          params.activeHistoricalPocCount,
        );
      } else {
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
          const priorPendingMigration = pendingMigration;
          const nextPendingMigration =
            priorPendingMigration !== undefined &&
            candidateMatchesBand(
              candidate,
              priorPendingMigration.candidate,
              params.bandMergeMode,
            )
              ? {
                  candidate: {
                    ...candidate,
                    bandLow: Math.min(
                      priorPendingMigration.candidate.bandLow,
                      candidate.bandLow,
                    ),
                    bandHigh: Math.max(
                      priorPendingMigration.candidate.bandHigh,
                      candidate.bandHigh,
                    ),
                  },
                  hitCount: priorPendingMigration.hitCount + 1,
                }
              : { candidate, hitCount: 1 };
          pendingMigration = nextPendingMigration;
          if (nextPendingMigration.hitCount >= params.migrationConfirmBars) {
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
            rankZones(
              zones,
              current,
              bar.index,
              params.activeHistoricalPocCount,
            );
          }
        } else pendingMigration = undefined;
        extendZones(
          zones,
          current,
          bar.index,
          bar.openTimeMs,
          params.activeHistoricalPocCount,
        );
      }
    }
  }

  zones = trimZones(zones, params);
  if (bar.isHistory && !bar.isHistoryFinalizedTail) {
    return {
      bars,
      zones,
      ...(current === undefined ? {} : { currentZoneId: current.id }),
      previousScores,
      ...(pendingMigration === undefined ? {} : { pendingMigration }),
    };
  }
  return {
    bars,
    zones,
    ...(current === undefined ? {} : { currentZoneId: current.id }),
    previousScores,
    ...(pendingMigration === undefined ? {} : { pendingMigration }),
  };
}

function insidePocBand(
  index: number,
  value: number,
  zones: readonly PocZone[],
  params: Params,
): boolean {
  if (!Number.isFinite(value)) return false;
  return zones.some((zone) => {
    // Segments are chronological and non-overlapping. A signal on the current
    // candle can only intersect the zone's newest segment, so scanning frozen
    // historical segments makes retained-history rebuilds unnecessarily
    // quadratic without changing the result.
    const segment = zone.segments.at(-1);
    return (
      segment !== undefined &&
      zoneIsRenderable(zone, segment, params) &&
      index >= segment.startIndex &&
      index <= segment.endIndex &&
      value >= segment.bandLow &&
      value <= segment.bandHigh
    );
  });
}

function signalBlocked(
  index: number,
  params: Params,
  zones: readonly PocZone[],
  close: number,
  rope: number,
  stop: number,
): boolean {
  switch (params.pocBandSignalSuppressLine) {
    case "off":
      return false;
    case "Any":
      return (
        insidePocBand(index, close, zones, params) ||
        insidePocBand(index, rope, zones, params) ||
        insidePocBand(index, stop, zones, params)
      );
    case "ATR Rope":
      return insidePocBand(index, rope, zones, params);
    case "UT Bot":
      return insidePocBand(index, stop, zones, params);
    case "ATR Rope + UT Bot":
      return (
        insidePocBand(index, rope, zones, params) &&
        insidePocBand(index, stop, zones, params)
      );
  }
}

function stepSignals(
  previous: Readonly<SignalState>,
  bar: IndicatorBar,
  unified: Direction,
  blocked: boolean,
  params: Params,
): SignalState {
  if (!bar.isConfirmed) return { ...previous, buy: false, sell: false };
  const outcomes = [
    ...previous.outcomes,
    { index: bar.index, open: bar.open, close: bar.close },
  ].slice(-64);
  const next: SignalState = {
    ...previous,
    outcomes,
    buy: false,
    sell: false,
  };
  const usesWinFollow =
    params.signalIssueMode === "Win Follow" ||
    params.signalIssueMode === "Win Follow + MG Follow";
  const usesMgFollow =
    (params.signalIssueMode === "MG Follow" ||
      params.signalIssueMode === "Win Follow + MG Follow") &&
    params.mgStepCount > 0;
  const exitedBand = previous.previousBlocked && !blocked;
  const originalBuy =
    !blocked && unified === 1 && (previous.previousUnified !== 1 || exitedBand);
  const originalSell =
    !blocked &&
    unified === -1 &&
    (previous.previousUnified !== -1 || exitedBand);
  const won = (
    direction: SignalSide,
    signalIndex: number | undefined,
  ): boolean | undefined => {
    if (signalIndex === undefined || signalIndex + 1 > bar.index)
      return undefined;
    const outcome = outcomes.find((item) => item.index === signalIndex + 1);
    if (outcome === undefined) return undefined;
    return direction === "buy"
      ? outcome.close > outcome.open
      : outcome.close < outcome.open;
  };
  const issue = (direction: SignalSide): void => {
    next.buy = direction === "buy";
    next.sell = direction === "sell";
    next.lastSignalIndex = bar.index;
  };
  const clearMg = (): void => {
    next.mgDirection = undefined;
    next.mgStep = 0;
    next.mgSignalIndex = undefined;
  };
  const startMg = (direction: SignalSide): void => {
    if (usesMgFollow) {
      next.mgDirection = direction;
      next.mgStep = 0;
      next.mgSignalIndex = next.lastSignalIndex;
    } else clearMg();
  };
  const runMg = (): void => {
    if (!usesMgFollow || next.mgDirection === undefined) return;
    const result = won(next.mgDirection, next.mgSignalIndex);
    if (result === undefined) return;
    if (result) {
      const recovered = next.mgDirection;
      clearMg();
      next.followDirection = recovered;
      if (
        (recovered === "buy" && unified === 1) ||
        (recovered === "sell" && unified === -1)
      )
        issue(recovered);
      return;
    }
    if (next.mgStep >= params.mgStepCount) {
      clearMg();
      next.followDirection = undefined;
      return;
    }
    const direction = next.mgDirection;
    issue(direction);
    next.mgSignalIndex = bar.index;
    next.mgStep += 1;
  };

  if (params.signalIssueMode === "original") {
    if (originalBuy) next.buy = true;
    else if (originalSell) next.sell = true;
    next.followDirection = undefined;
    next.lastSignalIndex = undefined;
    clearMg();
  } else if (params.signalIssueMode === "MG Follow") {
    if (originalBuy) {
      clearMg();
      issue("buy");
      next.mgDirection = "buy";
      next.mgSignalIndex = bar.index;
    } else if (originalSell) {
      clearMg();
      issue("sell");
      next.mgDirection = "sell";
      next.mgSignalIndex = bar.index;
    } else runMg();
    next.followDirection = undefined;
  } else if (usesWinFollow) {
    if (next.followDirection !== undefined) {
      const sameSide =
        (next.followDirection === "buy" && unified === 1) ||
        (next.followDirection === "sell" && unified === -1);
      const result = won(next.followDirection, next.lastSignalIndex);
      if (!sameSide) {
        if (result === false) startMg(next.followDirection);
        next.followDirection = undefined;
      } else if (result === true) issue(next.followDirection);
      else if (result === false) {
        const lost = next.followDirection;
        next.followDirection = undefined;
        startMg(lost);
      }
    }
    if (!next.buy && !next.sell) {
      if (originalBuy) {
        issue("buy");
        next.followDirection = "buy";
        clearMg();
      } else if (originalSell) {
        issue("sell");
        next.followDirection = "sell";
        clearMg();
      } else runMg();
    }
  }
  next.previousUnified = unified;
  next.previousBlocked = blocked;
  return next;
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

function renderZones(state: PocState, bar: IndicatorBar, params: Params): void {
  const skipHistoricalIntermediate =
    bar.isHistory && bar.isConfirmed && !bar.isHistoryFinalizedTail;
  if (skipHistoricalIntermediate) return;
  drawZones(state.zones, params, bar);
}

const indicator: IndicatorPluginModule = defineIndicator(
  {
    id: "erc.indicator.atr-rope-utbot.unified",
    name: "ATR Rope + UT Bot Unified",
    description:
      "ATR Rope + UT Bot with follow signals and rolling ADX POC migration. Uses chart-timeframe candles until explicit MTF inputs are available.",
    placement: "overlay",
  },
  (bar) => {
    const params = readInputs();

    const ropeSource = priceValue(bar, params.ropeSource);
    const ropeAtr = ta.atr(params.ropePeriod);
    const ropeState = series(emptyRopeState, (previous) =>
      stepRope(previous, ropeSource, ropeAtr, params),
    );
    const directionBase = ta.movingAverage(
      ropeState.directionInput,
      params.ropeDirectionMaType,
      params.ropeDirectionLookback,
    );
    const ropeDirection = series(emptyRopeDirectionState, (previous) =>
      stepRopeDirection(
        previous,
        ropeState.rope,
        ropeAtr,
        directionBase,
        params.ropeDirectionThreshold,
      ),
    );

    const utSource = priceValue(bar, params.utbotSource);
    const utAtr = ta.atr(params.utbotAtrPeriod);
    const ut = series(emptyUtState, (previous) =>
      stepUtBot(previous, utSource, utAtr, bar.index, params),
    );

    const dmi = ta.dmi(params.dmiLength);
    const poc = series(emptyPocState, (previous) =>
      stepPoc(previous, bar, dmi, params),
    );
    const unified: Direction =
      ropeDirection.direction === ut.position ? ropeDirection.direction : 0;
    const blocked = signalBlocked(
      bar.index,
      params,
      poc.zones,
      bar.close,
      ropeState.rope,
      ut.stop,
    );
    const signalState = series(emptySignalState, (previous) =>
      stepSignals(previous, bar, unified, blocked, params),
    );
    const markerAtr = ta.atr(
      Math.max(params.ropePeriod, params.utbotAtrPeriod),
    );
    const padding = Number.isFinite(markerAtr)
      ? Math.max(markerAtr, Number.EPSILON) * 0.35
      : Math.max(Math.abs(bar.close) * 1e-5, Number.EPSILON);
    const ropeColor =
      ropeDirection.direction > 0
        ? params.ropeUpColor
        : ropeDirection.direction < 0
          ? params.ropeDownColor
          : params.ropeFlatColor;
    const utColor =
      ut.position > 0
        ? params.utbotUpTrendColor
        : ut.position < 0
          ? params.utbotDownTrendColor
          : params.utbotTrailingStopColor;

    plot.line(ropeState.rope, {
      key: "rope",
      title: "ATR Rope",
      color: ropeColor,
      width: params.ropeWidth,
    });
    plot.line(ropeDirection.upper, {
      key: "directionUpper",
      title: "Direction Upper",
      color: "#3daa45",
    });
    plot.line(ropeDirection.lower, {
      key: "directionLower",
      title: "Direction Lower",
      color: "#ff033e",
    });
    plot.line(params.showTrailingStop ? ut.stop : null, {
      key: "utStop",
      title: "UT Stop",
      color: utColor,
      width: 2,
    });
    plot.shape(signalState.buy ? bar.low - padding : null, {
      key: "buyMarker",
      title: "Buy",
      direction: "up",
      color: params.buySignalColor,
    });
    plot.shape(signalState.sell ? bar.high + padding : null, {
      key: "sellMarker",
      title: "Sell",
      direction: "down",
      color: params.sellSignalColor,
    });
    renderZones(poc, bar, params);
    signal(signalState.buy, "long");
    signal(signalState.sell, "short");
  },
);

export const definition: IndicatorPluginModule["definition"] =
  indicator.definition;
export const createInstance: IndicatorPluginModule["createInstance"] =
  indicator.createInstance;
export default indicator;
