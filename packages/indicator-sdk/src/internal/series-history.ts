import { authoringFrame, useKernel } from "../authoring-context.js";

interface SeriesHistoryState {
  readonly committed: number[];
}

export function normalizeHistoryOffset(barsBack: number): number {
  if (!Number.isSafeInteger(barsBack) || barsBack < 0) {
    throw new RangeError("History offset must be a non-negative safe integer.");
  }
  return barsBack;
}

/**
 * Canonical scalar history operation.
 *
 * Finalized bars advance committed history exactly once. Building bars read from
 * the last committed state and never mutate it, so replacements remain
 * provisional. Missing history is represented by NaN, which existing plot/TA
 * boundaries already treat as unavailable.
 */
export function historyValue(currentValue: number, barsBack: number): number {
  const frame = authoringFrame();
  const offset = normalizeHistoryOffset(barsBack);
  const state = useKernel<SeriesHistoryState>("series-history", () => ({
    committed: [],
  }));
  const value =
    offset === 0 ? currentValue : (state.committed.at(-offset) ?? Number.NaN);
  if (frame.phase === "finalized") state.committed.push(currentValue);
  return value;
}
