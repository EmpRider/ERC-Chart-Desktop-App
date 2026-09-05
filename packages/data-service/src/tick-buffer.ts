import type { Tick } from "@erc-chart/contracts";
import { normalizeTicks } from "./market-data-validation.js";

export interface TickBufferKey {
  readonly providerProfileId: string;
  readonly instrumentId: string;
}

export interface BoundedTickBuffer {
  readonly append: (
    key: TickBufferKey,
    ticks: readonly Tick[],
  ) => readonly Tick[];
  readonly snapshot: (key: TickBufferKey) => readonly Tick[];
  readonly clearProfile: (providerProfileId: string) => void;
}

interface TickSeries {
  readonly values: Tick[];
  latestTimestampMs: number;
}

function validateKey(key: TickBufferKey): TickBufferKey {
  if (
    typeof key.providerProfileId !== "string" ||
    key.providerProfileId.length === 0 ||
    key.providerProfileId.length > 128 ||
    key.providerProfileId.trim() !== key.providerProfileId ||
    typeof key.instrumentId !== "string" ||
    key.instrumentId.length === 0 ||
    key.instrumentId.length > 128 ||
    key.instrumentId.trim() !== key.instrumentId
  ) {
    throw new RangeError("Tick-buffer key is invalid.");
  }
  return key;
}

function keyId(key: TickBufferKey): string {
  return JSON.stringify([key.providerProfileId, key.instrumentId]);
}

export function createBoundedTickBuffer(capacity = 4096): BoundedTickBuffer {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1_000_000) {
    throw new RangeError(
      "Tick-buffer capacity must be a positive bounded integer.",
    );
  }
  const series = new Map<
    string,
    { readonly key: TickBufferKey; readonly state: TickSeries }
  >();

  const stateFor = (input: TickBufferKey): TickSeries => {
    const key = validateKey(input);
    const id = keyId(key);
    let item = series.get(id);
    if (item === undefined) {
      item = {
        key: Object.freeze({ ...key }),
        state: { values: [], latestTimestampMs: -1 },
      };
      series.set(id, item);
    }
    return item.state;
  };

  return {
    append: (key, input) => {
      const state = stateFor(key);
      const accepted: Tick[] = [];
      const ticks = [
        ...normalizeTicks(input, { instrumentId: key.instrumentId }),
      ].sort((left, right) => left.timestampMs - right.timestampMs);
      for (const tick of ticks) {
        if (tick.timestampMs < state.latestTimestampMs) continue;
        const frozen = Object.freeze({ ...tick });
        state.values.push(frozen);
        state.latestTimestampMs = tick.timestampMs;
        accepted.push(frozen);
      }
      if (state.values.length > capacity) {
        state.values.splice(0, state.values.length - capacity);
      }
      return Object.freeze(accepted);
    },
    snapshot: (key) => Object.freeze([...stateFor(key).values]),
    clearProfile: (providerProfileId) => {
      for (const [id, item] of series) {
        if (item.key.providerProfileId === providerProfileId) series.delete(id);
      }
    },
  };
}
