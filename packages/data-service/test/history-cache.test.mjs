import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openStorageDatabase } from "../../storage/dist/index.js";
import { createHistoricalCandleCache, findCandleGaps } from "../dist/index.js";

function cacheIdentity({
  timeframeId = "1m",
  alignmentOriginMs = 0,
  providerFingerprint = "provider-state:v1",
} = {}) {
  return {
    version: 1,
    providerFingerprint,
    targetTimeframeId: timeframeId,
    targetTimeframeSeconds: 60,
    targetAlignmentMode: "epoch",
    targetAlignmentOriginMs: alignmentOriginMs,
    targetAlignmentTimeZone: "UTC",
    sourceTimeframeId: timeframeId,
    sourceTimeframeSeconds: 60,
    sourceAlignmentMode: "epoch",
    sourceAlignmentOriginMs: alignmentOriginMs,
    sourceAlignmentTimeZone: "UTC",
  };
}

const key = {
  providerProfileId: "profile-a",
  instrumentId: "BTCUSD",
  timeframeId: "1m",
  timeframeSeconds: 60,
  cacheIdentity: cacheIdentity(),
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

test("persists canonical history and treats process-local revisions as non-global", async () => {
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
      assert.equal(cache.range(key, 60_000, 60_000)[0].close, 99);
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

test("isolates equal-second cache rows by timeframe, alignment, and provider fingerprint", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-history-identity-"));
  try {
    const database = await openStorageDatabase(path.join(root, "cache.sqlite"));
    try {
      const cache = createHistoricalCandleCache(database);
      const variants = [
        key,
        {
          ...key,
          timeframeId: "60s-alt",
          cacheIdentity: cacheIdentity({ timeframeId: "60s-alt" }),
        },
        {
          ...key,
          cacheIdentity: cacheIdentity({ alignmentOriginMs: 30_000 }),
        },
        {
          ...key,
          cacheIdentity: cacheIdentity({
            providerFingerprint: "provider-state:v2",
          }),
        },
      ];
      variants.forEach((variant, index) =>
        cache.upsert(variant, [
          {
            ...canonical(0, index + 1),
            timeframeId: variant.timeframeId,
            high: 30,
            close: 20 + index,
          },
        ]),
      );
      assert.deepEqual(
        variants.map((variant) => cache.range(variant, 0, 0)[0]?.close),
        [20, 21, 22, 23],
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
