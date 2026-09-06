import assert from "node:assert/strict";
import test from "node:test";

import { assertDenseSnapshotTimeline } from "../dist/result-validation.js";

test("requires one timestamp-aligned point per candle so warm-up stays null in place", () => {
  const expected = [60_000, 120_000, 180_000];
  assert.doesNotThrow(() =>
    assertDenseSnapshotTimeline(
      {
        points: [
          { openTimeMs: 60_000, values: { line: null } },
          { openTimeMs: 120_000, values: { line: null } },
          { openTimeMs: 180_000, values: { line: 42 } },
        ],
        overlays: [],
        signals: [],
      },
      expected,
    ),
  );

  assert.throws(
    () =>
      assertDenseSnapshotTimeline(
        {
          points: [{ openTimeMs: 180_000, values: { line: 42 } }],
          overlays: [],
          signals: [],
        },
        expected,
      ),
    /one timestamp-aligned point per candle/,
  );
  assert.throws(
    () =>
      assertDenseSnapshotTimeline(
        {
          points: [
            { openTimeMs: 60_000, values: { line: null } },
            { openTimeMs: 180_000, values: { line: null } },
            { openTimeMs: 120_000, values: { line: 42 } },
          ],
          overlays: [],
          signals: [],
        },
        expected,
      ),
    /canonical candle timeline/,
  );
});
