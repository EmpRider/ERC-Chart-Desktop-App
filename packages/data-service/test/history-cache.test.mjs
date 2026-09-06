import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openStorageDatabase } from "../../storage/dist/index.js";
import { createHistoricalCandleCache, findCandleGaps } from "../dist/index.js";

const key = {
  providerProfileId: "profile-a",
  instrumentId: "BTCUSD",
  timeframeId: "1m",
  timeframeSeconds: 60,
};

function canonical(openTimeMs, revision) {
  return {
    instrumentId: "BTCUSD",
    timeframeId: "1m",
    openTimeMs,
    closeTimeMs: openTimeMs + 60_000,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    isFinal: true,
    revision,
  };
}

test("persists canonical history, queries newest/range, and ignores obsolete revisions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-history-cache-"));
  try {
    const database = await openStorageDatabase(path.join(root, "cache.sqlite"));
    try {
      const cache = createHistoricalCandleCache(database);
      cache.upsert(key, [
        canonical(0, 2),
        canonical(60_000, 2),
        canonical(120_000, 2),
      ]);
      cache.upsert(key, [{ ...canonical(60_000, 1), high: 100, close: 99 }]);

      assert.deepEqual(
        cache.newest(key, 2).map(({ openTimeMs }) => openTimeMs),
        [60_000, 120_000],
      );
      assert.equal(cache.range(key, 60_000, 60_000)[0].close, 11);
      assert.equal(cache.retain(key, 2), 1);
      assert.deepEqual(
        cache.range(key, 0, 120_000).map(({ openTimeMs }) => openTimeMs),
        [60_000, 120_000],
      );
    } finally {
      database.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finds bounded deterministic gaps without reporting duplicates", () => {
  assert.deepEqual(
    findCandleGaps(
      [{ openTimeMs: 0 }, { openTimeMs: 120_000 }, { openTimeMs: 120_000 }],
      60,
      { fromOpenTimeMs: 0, toOpenTimeMs: 240_000 },
    ),
    [
      { fromOpenTimeMs: 60_000, toOpenTimeMs: 60_000 },
      { fromOpenTimeMs: 180_000, toOpenTimeMs: 240_000 },
    ],
  );
});
