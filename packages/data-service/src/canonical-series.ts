import type { Candle, InstrumentId, TimeframeId } from "@erc-chart/contracts";
import { normalizeCandle } from "./market-data-validation.js";

export interface CanonicalSeriesKey {
  readonly providerProfileId: string;
  readonly instrumentId: InstrumentId;
  readonly timeframeId: TimeframeId;
  readonly timeframeSeconds: number;
}

export interface CanonicalCandle extends Candle {
  readonly closeTimeMs: number;
  readonly isFinal: boolean;
  readonly revision: number;
}

export interface CanonicalSeriesSnapshot {
  readonly key: CanonicalSeriesKey;
  readonly generation: number;
  readonly revision: number;
  readonly baseIndex: number;
  readonly timeMs: Float64Array;
  readonly open: Float64Array;
  readonly high: Float64Array;
  readonly low: Float64Array;
  readonly close: Float64Array;
  readonly volume?: Float64Array;
  readonly hl2: Float64Array;
  readonly hlc3: Float64Array;
  readonly ohlc4: Float64Array;
  readonly candleRevision: Float64Array;
  readonly building?: CanonicalCandle;
}

export type CanonicalSeriesDeltaKind =
  | "history-replaced"
  | "building-updated"
  | "bar-finalized"
  | "bar-revised"
  | "retention-trimmed";

export interface CanonicalSeriesDelta {
  readonly kind: CanonicalSeriesDeltaKind;
  readonly generation: number;
  readonly revision: number;
  readonly candle?: CanonicalCandle;
}

export interface CanonicalSeriesStore {
  readonly replaceHistory: (
    key: CanonicalSeriesKey,
    finalized: readonly Candle[],
    building?: Candle,
  ) => CanonicalSeriesDelta;
  readonly upsertFinalized: (
    key: CanonicalSeriesKey,
    candle: Candle,
  ) => CanonicalSeriesDelta | undefined;
  readonly updateBuilding: (
    key: CanonicalSeriesKey,
    candle: Candle,
  ) => CanonicalSeriesDelta | undefined;
  readonly finalizeBuilding: (
    key: CanonicalSeriesKey,
    candle?: Candle,
  ) => CanonicalSeriesDelta | undefined;
  readonly trimFinalized: (
    key: CanonicalSeriesKey,
    maximumBars: number,
  ) => CanonicalSeriesDelta | undefined;
  readonly snapshot: (key: CanonicalSeriesKey) => CanonicalSeriesSnapshot;
  readonly finalizedCandles: (
    key: CanonicalSeriesKey,
  ) => readonly CanonicalCandle[];
  readonly latestFinalized: (
    key: CanonicalSeriesKey,
  ) => CanonicalCandle | undefined;
  readonly buildingCandle: (
    key: CanonicalSeriesKey,
  ) => CanonicalCandle | undefined;
  readonly clearProfile: (providerProfileId: string) => void;
}

interface SeriesState {
  readonly key: CanonicalSeriesKey;
  readonly finalized: TypedCandleSeries;
  generation: number;
  revision: number;
  baseIndex: number;
  building: CanonicalCandle | undefined;
}

const initialCapacity = 16;

function typedValue(
  array: Float64Array<ArrayBufferLike>,
  index: number,
): number {
  const value = array[index];
  if (value === undefined)
    throw new RangeError("Typed series index is invalid.");
  return value;
}

function validateProfileId(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value.trim() !== value
  ) {
    throw new RangeError("Provider profile ID is invalid.");
  }
  return value;
}

function validateKey(input: CanonicalSeriesKey): CanonicalSeriesKey {
  const providerProfileId = validateProfileId(input.providerProfileId);
  if (
    typeof input.instrumentId !== "string" ||
    input.instrumentId.length === 0 ||
    typeof input.timeframeId !== "string" ||
    input.timeframeId.length === 0 ||
    !Number.isSafeInteger(input.timeframeSeconds) ||
    input.timeframeSeconds <= 0
  ) {
    throw new RangeError("Canonical series key is invalid.");
  }
  return Object.freeze({
    providerProfileId,
    instrumentId: input.instrumentId,
    timeframeId: input.timeframeId,
    timeframeSeconds: input.timeframeSeconds,
  });
}

function keyId(key: CanonicalSeriesKey): string {
  return JSON.stringify([
    key.providerProfileId,
    key.instrumentId,
    key.timeframeId,
    key.timeframeSeconds,
  ]);
}

function sameCandle(left: Candle, right: Candle): boolean {
  return (
    left.instrumentId === right.instrumentId &&
    left.timeframeId === right.timeframeId &&
    left.openTimeMs === right.openTimeMs &&
    left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.close === right.close &&
    left.volume === right.volume
  );
}

function normalizedForKey(key: CanonicalSeriesKey, candle: Candle): Candle {
  return normalizeCandle(candle, {
    instrumentId: key.instrumentId,
    timeframeId: key.timeframeId,
  });
}

function canonicalCandle(
  key: CanonicalSeriesKey,
  candle: Candle,
  revision: number,
  isFinal: boolean,
): CanonicalCandle {
  return Object.freeze({
    ...candle,
    closeTimeMs: candle.openTimeMs + key.timeframeSeconds * 1000,
    isFinal,
    revision,
  });
}

class TypedCandleSeries {
  private capacity = initialCapacity;
  private count = 0;
  private timeMs: Float64Array<ArrayBufferLike> = new Float64Array(
    this.capacity,
  );
  private open: Float64Array<ArrayBufferLike> = new Float64Array(this.capacity);
  private high: Float64Array<ArrayBufferLike> = new Float64Array(this.capacity);
  private low: Float64Array<ArrayBufferLike> = new Float64Array(this.capacity);
  private close: Float64Array<ArrayBufferLike> = new Float64Array(
    this.capacity,
  );
  private volume: Float64Array<ArrayBufferLike> = new Float64Array(
    this.capacity,
  ).fill(Number.NaN);
  private hl2: Float64Array<ArrayBufferLike> = new Float64Array(this.capacity);
  private hlc3: Float64Array<ArrayBufferLike> = new Float64Array(this.capacity);
  private ohlc4: Float64Array<ArrayBufferLike> = new Float64Array(
    this.capacity,
  );
  private revisions: Float64Array<ArrayBufferLike> = new Float64Array(
    this.capacity,
  );
  private hasVolume = false;

  get length(): number {
    return this.count;
  }

  private grow(minimum: number): void {
    if (minimum <= this.capacity) return;
    let nextCapacity = this.capacity;
    while (nextCapacity < minimum) nextCapacity *= 2;
    const resize = (
      source: Float64Array<ArrayBufferLike>,
      fillNaN = false,
    ): Float64Array<ArrayBufferLike> => {
      const next = new Float64Array(nextCapacity);
      if (fillNaN) next.fill(Number.NaN);
      next.set(source.subarray(0, this.count));
      return next;
    };
    this.timeMs = resize(this.timeMs);
    this.open = resize(this.open);
    this.high = resize(this.high);
    this.low = resize(this.low);
    this.close = resize(this.close);
    this.volume = resize(this.volume, true);
    this.hl2 = resize(this.hl2);
    this.hlc3 = resize(this.hlc3);
    this.ohlc4 = resize(this.ohlc4);
    this.revisions = resize(this.revisions);
    this.capacity = nextCapacity;
  }

  private write(index: number, candle: Candle, revision: number): void {
    this.timeMs[index] = candle.openTimeMs;
    this.open[index] = candle.open;
    this.high[index] = candle.high;
    this.low[index] = candle.low;
    this.close[index] = candle.close;
    this.volume[index] = candle.volume ?? Number.NaN;
    this.hasVolume ||= candle.volume !== undefined;
    this.hl2[index] = (candle.high + candle.low) / 2;
    this.hlc3[index] = (candle.high + candle.low + candle.close) / 3;
    this.ohlc4[index] =
      (candle.open + candle.high + candle.low + candle.close) / 4;
    this.revisions[index] = revision;
  }

  private locate(openTimeMs: number): {
    readonly found: boolean;
    readonly index: number;
  } {
    let low = 0;
    let high = this.count;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (typedValue(this.timeMs, middle) < openTimeMs) low = middle + 1;
      else high = middle;
    }
    return {
      found: low < this.count && this.timeMs[low] === openTimeMs,
      index: low,
    };
  }

  get(index: number, key: CanonicalSeriesKey): CanonicalCandle | undefined {
    if (index < 0 || index >= this.count) return undefined;
    const openTimeMs = typedValue(this.timeMs, index);
    const volume = typedValue(this.volume, index);
    return Object.freeze({
      instrumentId: key.instrumentId,
      timeframeId: key.timeframeId,
      openTimeMs,
      closeTimeMs: openTimeMs + key.timeframeSeconds * 1000,
      open: typedValue(this.open, index),
      high: typedValue(this.high, index),
      low: typedValue(this.low, index),
      close: typedValue(this.close, index),
      ...(Number.isNaN(volume) ? {} : { volume }),
      isFinal: true,
      revision: typedValue(this.revisions, index),
    });
  }

  getByOpenTime(
    openTimeMs: number,
    key: CanonicalSeriesKey,
  ): CanonicalCandle | undefined {
    const location = this.locate(openTimeMs);
    return location.found ? this.get(location.index, key) : undefined;
  }

  upsert(
    candle: Candle,
    revision: number,
  ): "inserted" | "revised" | "unchanged" {
    const location = this.locate(candle.openTimeMs);
    if (location.found) {
      const existing: Candle = {
        instrumentId: candle.instrumentId,
        timeframeId: candle.timeframeId,
        openTimeMs: typedValue(this.timeMs, location.index),
        open: typedValue(this.open, location.index),
        high: typedValue(this.high, location.index),
        low: typedValue(this.low, location.index),
        close: typedValue(this.close, location.index),
        ...(Number.isNaN(typedValue(this.volume, location.index))
          ? {}
          : { volume: typedValue(this.volume, location.index) }),
      };
      if (sameCandle(existing, candle)) return "unchanged";
      this.write(location.index, candle, revision);
      return "revised";
    }

    this.grow(this.count + 1);
    const move = (array: Float64Array): void => {
      array.copyWithin(location.index + 1, location.index, this.count);
    };
    move(this.timeMs);
    move(this.open);
    move(this.high);
    move(this.low);
    move(this.close);
    move(this.volume);
    move(this.hl2);
    move(this.hlc3);
    move(this.ohlc4);
    move(this.revisions);
    this.count += 1;
    this.write(location.index, candle, revision);
    return "inserted";
  }

  replace(candles: readonly Candle[], revision: number): void {
    const deduplicated = new Map<number, Candle>();
    for (const candle of candles) deduplicated.set(candle.openTimeMs, candle);
    const ordered = [...deduplicated.values()].sort(
      (left, right) => left.openTimeMs - right.openTimeMs,
    );
    this.count = 0;
    this.hasVolume = false;
    this.grow(Math.max(initialCapacity, ordered.length));
    this.volume.fill(Number.NaN);
    for (const candle of ordered) {
      this.write(this.count, candle, revision);
      this.count += 1;
    }
  }

  trimOldest(count: number): void {
    if (count <= 0) return;
    if (count >= this.count) {
      this.count = 0;
      this.hasVolume = false;
      return;
    }
    const remaining = this.count - count;
    const move = (array: Float64Array): void => {
      array.copyWithin(0, count, this.count);
    };
    move(this.timeMs);
    move(this.open);
    move(this.high);
    move(this.low);
    move(this.close);
    move(this.volume);
    move(this.hl2);
    move(this.hlc3);
    move(this.ohlc4);
    move(this.revisions);
    this.count = remaining;
    this.hasVolume = this.volume
      .subarray(0, this.count)
      .some((value) => !Number.isNaN(value));
  }

  snapshot(): Omit<
    CanonicalSeriesSnapshot,
    "key" | "generation" | "revision" | "baseIndex" | "building"
  > {
    return {
      timeMs: this.timeMs.slice(0, this.count),
      open: this.open.slice(0, this.count),
      high: this.high.slice(0, this.count),
      low: this.low.slice(0, this.count),
      close: this.close.slice(0, this.count),
      ...(this.hasVolume ? { volume: this.volume.slice(0, this.count) } : {}),
      hl2: this.hl2.slice(0, this.count),
      hlc3: this.hlc3.slice(0, this.count),
      ohlc4: this.ohlc4.slice(0, this.count),
      candleRevision: this.revisions.slice(0, this.count),
    };
  }
}

export function createCanonicalSeriesStore(): CanonicalSeriesStore {
  const series = new Map<string, SeriesState>();

  const stateFor = (input: CanonicalSeriesKey): SeriesState => {
    const key = validateKey(input);
    const id = keyId(key);
    let state = series.get(id);
    if (state === undefined) {
      state = {
        key,
        finalized: new TypedCandleSeries(),
        generation: 0,
        revision: 0,
        baseIndex: 0,
        building: undefined,
      };
      series.set(id, state);
    }
    return state;
  };

  const nextRevision = (state: SeriesState): number => {
    state.revision += 1;
    return state.revision;
  };

  const replaceHistory = (
    inputKey: CanonicalSeriesKey,
    finalized: readonly Candle[],
    building?: Candle,
  ): CanonicalSeriesDelta => {
    const state = stateFor(inputKey);
    const checkedFinalized = finalized.map((candle) =>
      normalizedForKey(state.key, candle),
    );
    const checkedBuilding =
      building === undefined
        ? undefined
        : normalizedForKey(state.key, building);
    if (
      checkedBuilding !== undefined &&
      checkedFinalized.some(
        (candle) => candle.openTimeMs === checkedBuilding.openTimeMs,
      )
    ) {
      throw new Error("Building candle cannot duplicate finalized history.");
    }
    state.generation += 1;
    state.baseIndex = 0;
    const revision = nextRevision(state);
    state.finalized.replace(checkedFinalized, revision);
    state.building =
      checkedBuilding === undefined
        ? undefined
        : canonicalCandle(state.key, checkedBuilding, revision, false);
    return Object.freeze({
      kind: "history-replaced",
      generation: state.generation,
      revision,
      ...(state.building === undefined ? {} : { candle: state.building }),
    });
  };

  const upsertFinalized = (
    inputKey: CanonicalSeriesKey,
    inputCandle: Candle,
  ): CanonicalSeriesDelta | undefined => {
    const state = stateFor(inputKey);
    const candle = normalizedForKey(state.key, inputCandle);
    const existing = state.finalized.getByOpenTime(
      candle.openTimeMs,
      state.key,
    );
    if (existing !== undefined && sameCandle(existing, candle))
      return undefined;
    const revision = nextRevision(state);
    const outcome = state.finalized.upsert(candle, revision);
    if (outcome === "unchanged") {
      state.revision -= 1;
      return undefined;
    }
    if (state.building?.openTimeMs === candle.openTimeMs)
      state.building = undefined;
    const canonical = canonicalCandle(state.key, candle, revision, true);
    return Object.freeze({
      kind: outcome === "revised" ? "bar-revised" : "bar-finalized",
      generation: state.generation,
      revision,
      candle: canonical,
    });
  };

  const updateBuilding = (
    inputKey: CanonicalSeriesKey,
    inputCandle: Candle,
  ): CanonicalSeriesDelta | undefined => {
    const state = stateFor(inputKey);
    const candle = normalizedForKey(state.key, inputCandle);
    if (
      state.finalized.getByOpenTime(candle.openTimeMs, state.key) !== undefined
    ) {
      return undefined;
    }
    if (state.building !== undefined) {
      if (candle.openTimeMs < state.building.openTimeMs) return undefined;
      if (candle.openTimeMs > state.building.openTimeMs) {
        throw new Error("Building candle must be finalized before advancing.");
      }
      if (sameCandle(state.building, candle)) return undefined;
    }
    const revision = nextRevision(state);
    state.building = canonicalCandle(state.key, candle, revision, false);
    return Object.freeze({
      kind: "building-updated",
      generation: state.generation,
      revision,
      candle: state.building,
    });
  };

  const finalizeBuilding = (
    inputKey: CanonicalSeriesKey,
    replacement?: Candle,
  ): CanonicalSeriesDelta | undefined => {
    const state = stateFor(inputKey);
    if (state.building === undefined) return undefined;
    const candle =
      replacement === undefined
        ? state.building
        : normalizedForKey(state.key, replacement);
    if (candle.openTimeMs !== state.building.openTimeMs) {
      throw new Error(
        "Finalized candle must match the building candle timestamp.",
      );
    }
    const revision = nextRevision(state);
    state.finalized.upsert(candle, revision);
    const finalized = canonicalCandle(state.key, candle, revision, true);
    state.building = undefined;
    return Object.freeze({
      kind: "bar-finalized",
      generation: state.generation,
      revision,
      candle: finalized,
    });
  };

  const trimFinalized = (
    inputKey: CanonicalSeriesKey,
    maximumBars: number,
  ): CanonicalSeriesDelta | undefined => {
    if (!Number.isSafeInteger(maximumBars) || maximumBars < 0) {
      throw new RangeError("Maximum finalized bar count must be non-negative.");
    }
    const state = stateFor(inputKey);
    const removeCount = state.finalized.length - maximumBars;
    if (removeCount <= 0) return undefined;
    state.finalized.trimOldest(removeCount);
    state.baseIndex += removeCount;
    const revision = nextRevision(state);
    return Object.freeze({
      kind: "retention-trimmed",
      generation: state.generation,
      revision,
    });
  };

  const snapshot = (inputKey: CanonicalSeriesKey): CanonicalSeriesSnapshot => {
    const state = stateFor(inputKey);
    return Object.freeze({
      key: state.key,
      generation: state.generation,
      revision: state.revision,
      baseIndex: state.baseIndex,
      ...state.finalized.snapshot(),
      ...(state.building === undefined ? {} : { building: state.building }),
    });
  };

  const finalizedCandles = (
    inputKey: CanonicalSeriesKey,
  ): readonly CanonicalCandle[] => {
    const state = stateFor(inputKey);
    const result: CanonicalCandle[] = [];
    for (let index = 0; index < state.finalized.length; index += 1) {
      const candle = state.finalized.get(index, state.key);
      if (candle !== undefined) result.push(candle);
    }
    return Object.freeze(result);
  };

  const latestFinalized = (
    inputKey: CanonicalSeriesKey,
  ): CanonicalCandle | undefined => {
    const state = stateFor(inputKey);
    return state.finalized.get(state.finalized.length - 1, state.key);
  };

  const buildingCandle = (
    inputKey: CanonicalSeriesKey,
  ): CanonicalCandle | undefined => stateFor(inputKey).building;

  const clearProfile = (providerProfileIdValue: string): void => {
    const providerProfileId = validateProfileId(providerProfileIdValue);
    for (const [id, state] of series) {
      if (state.key.providerProfileId === providerProfileId) series.delete(id);
    }
  };

  return {
    replaceHistory,
    upsertFinalized,
    updateBuilding,
    finalizeBuilding,
    trimFinalized,
    snapshot,
    finalizedCandles,
    latestFinalized,
    buildingCandle,
    clearProfile,
  };
}
