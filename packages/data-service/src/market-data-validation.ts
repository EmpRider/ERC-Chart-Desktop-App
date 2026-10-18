import type { Candle, Tick } from "@erc-chart/contracts";

export type MarketDataValidationCode =
  "MARKET_DATA_INVALID_CANDLE" | "MARKET_DATA_INVALID_TICK";

export class MarketDataValidationError extends TypeError {
  readonly code: MarketDataValidationCode;

  constructor(code: MarketDataValidationCode, message: string) {
    super(message);
    this.name = "MarketDataValidationError";
    this.code = code;
  }
}

export interface CandleIdentityExpectation {
  readonly instrumentId: string;
  readonly timeframeId: string;
}

export interface TickIdentityExpectation {
  readonly instrumentId: string;
}

const candleFields = new Set([
  "instrumentId",
  "timeframeId",
  "openTimeMs",
  "open",
  "high",
  "low",
  "close",
  "volume",
]);
const tickFields = new Set(["instrumentId", "timestampMs", "price", "volume"]);

function invalid(
  code: MarketDataValidationCode,
  message: string,
): MarketDataValidationError {
  return new MarketDataValidationError(code, message);
}

function requirePlainObject(
  value: unknown,
  code: MarketDataValidationCode,
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw invalid(code, `${label} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnexpectedFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  code: MarketDataValidationCode,
  label: string,
): void {
  if (Object.keys(value).some((field) => !allowed.has(field))) {
    throw invalid(code, `${label} contains unsupported fields.`);
  }
}

function requireIdentifier(
  value: unknown,
  code: MarketDataValidationCode,
  field: string,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value.trim() !== value
  ) {
    throw invalid(code, `${field} must be a non-empty normalized identifier.`);
  }
  return value;
}

function requireTimestamp(
  value: unknown,
  code: MarketDataValidationCode,
  field: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalid(code, `${field} must be a non-negative safe integer.`);
  }
  return value as number;
}

function requireFiniteNumber(
  value: unknown,
  code: MarketDataValidationCode,
  field: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(code, `${field} must be a finite number.`);
  }
  return value;
}

function optionalFiniteNumber(
  value: unknown,
  code: MarketDataValidationCode,
  field: string,
): number | undefined {
  return value === undefined
    ? undefined
    : requireFiniteNumber(value, code, field);
}

export function normalizeCandle(
  input: unknown,
  expected?: CandleIdentityExpectation,
): Candle {
  const code = "MARKET_DATA_INVALID_CANDLE" as const;
  const value = requirePlainObject(input, code, "Candle");
  rejectUnexpectedFields(value, candleFields, code, "Candle");

  const instrumentId = requireIdentifier(
    value.instrumentId,
    code,
    "instrumentId",
  );
  const timeframeId = requireIdentifier(value.timeframeId, code, "timeframeId");
  if (
    expected !== undefined &&
    (instrumentId !== expected.instrumentId ||
      timeframeId !== expected.timeframeId)
  ) {
    throw invalid(code, "Candle identity does not match the requested series.");
  }

  const openTimeMs = requireTimestamp(value.openTimeMs, code, "openTimeMs");
  const open = requireFiniteNumber(value.open, code, "open");
  const high = requireFiniteNumber(value.high, code, "high");
  const low = requireFiniteNumber(value.low, code, "low");
  const close = requireFiniteNumber(value.close, code, "close");
  const volume = optionalFiniteNumber(value.volume, code, "volume");

  if (high < Math.max(open, close) || low > Math.min(open, close)) {
    throw invalid(code, "Candle high and low must contain open and close.");
  }

  return Object.freeze({
    instrumentId: instrumentId as Candle["instrumentId"],
    timeframeId: timeframeId as Candle["timeframeId"],
    openTimeMs,
    open,
    high,
    low,
    close,
    ...(volume === undefined ? {} : { volume }),
  });
}

export function normalizeCandles(
  input: unknown,
  expected?: CandleIdentityExpectation,
): readonly Candle[] {
  if (!Array.isArray(input)) {
    throw invalid("MARKET_DATA_INVALID_CANDLE", "Candles must be an array.");
  }
  return Object.freeze(
    input.map((candle) => normalizeCandle(candle, expected)),
  );
}

export function normalizeTick(
  input: unknown,
  expected?: TickIdentityExpectation,
): Tick {
  const code = "MARKET_DATA_INVALID_TICK" as const;
  const value = requirePlainObject(input, code, "Tick");
  rejectUnexpectedFields(value, tickFields, code, "Tick");

  const instrumentId = requireIdentifier(
    value.instrumentId,
    code,
    "instrumentId",
  );
  if (expected !== undefined && instrumentId !== expected.instrumentId) {
    throw invalid(
      code,
      "Tick identity does not match the requested instrument.",
    );
  }
  const timestampMs = requireTimestamp(value.timestampMs, code, "timestampMs");
  const price = requireFiniteNumber(value.price, code, "price");
  const volume = optionalFiniteNumber(value.volume, code, "volume");

  return Object.freeze({
    instrumentId: instrumentId as Tick["instrumentId"],
    timestampMs,
    price,
    ...(volume === undefined ? {} : { volume }),
  });
}

export function normalizeTicks(
  input: unknown,
  expected?: TickIdentityExpectation,
): readonly Tick[] {
  if (!Array.isArray(input)) {
    throw invalid("MARKET_DATA_INVALID_TICK", "Ticks must be an array.");
  }
  return Object.freeze(input.map((tick) => normalizeTick(tick, expected)));
}
