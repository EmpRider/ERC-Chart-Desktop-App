import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openStorageDatabase } from "../../storage/dist/index.js";
import {
  createHistoricalCandleCache,
  createProviderDataService,
} from "../dist/index.js";

const alignment = Object.freeze({
  mode: "epoch",
  originMs: 0,
  timeZone: "UTC",
});
const oneMinute = Object.freeze({
  id: "1m",
  seconds: 60,
  historical: true,
  live: true,
  native: true,
  alignment,
});
const threeMinute = Object.freeze({
  id: "3m",
  seconds: 180,
  historical: true,
  live: true,
  native: false,
  derivedFromTimeframeId: "1m",
  alignment,
});

function capabilities() {
  return {
    instruments: true,
    nativeTimeframes: ["1m"],
    liveData: true,
    derivedTimeframes: true,
    derivedTimeframeIds: ["3m"],
    timeframes: [oneMinute, threeMinute],
  };
}

function candle(openTimeMs, timeframeId = "1m") {
  const index = openTimeMs / 60_000;
  return {
    instrumentId: "BTCUSD",
    timeframeId,
    openTimeMs,
    open: 10 + index,
    high: 12 + index,
    low: 9 + index,
    close: 11 + index,
    volume: 1 + index,
  };
}

function historyFor(request) {
  const seconds = request.timeframeId === "3m" ? 180 : 60;
  const step = seconds * 1000;
  const fromMs = request.fromMs ?? 0;
  const count = request.limit ?? 1;
  const toMs = request.toMs ?? fromMs + (count - 1) * step;
  const result = [];
  for (let openTimeMs = fromMs; openTimeMs <= toMs; openTimeMs += step) {
    result.push(candle(openTimeMs, request.timeframeId));
    if (result.length >= count) break;
  }
  return result;
}

function createUpstream() {
  const history = [];
  return {
    history,
    upstream: {
      async getCapabilities() {
        return capabilities();
      },
      async getInstruments() {
        return [];
      },
      async requestHistory(providerProfileId, request) {
        history.push({ providerProfileId, request: { ...request } });
        return historyFor(request);
      },
      async subscribe() {
        return {
          async unsubscribe() {
            /* No resources in this fixture. */
          },
        };
      },
    },
  };
}

function cacheOptions(
  database,
  now,
  fingerprint = "provider-state:v1",
  errors = [],
) {
  return {
    now: () => now,
    historyCache: createHistoricalCandleCache(database),
    cacheFingerprintForProfile: () => fingerprint,
    onCacheError(operation, error) {
      errors.push({ operation, error });
    },
  };
}

async function withDatabase(run) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "erc-cache-backed-history-"),
  );
  const databasePath = path.join(root, "app.sqlite");
  try {
    await run(databasePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function loadWarmInFreshProcess(databasePath, request) {
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import { openStorageDatabase } from ${JSON.stringify(new URL("../../storage/dist/index.js", import.meta.url).href)};
    import { createHistoricalCandleCache, createProviderDataService } from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};
    const database = await openStorageDatabase(${JSON.stringify(databasePath)});
    let historyCalls = 0;
    const service = createProviderDataService({
      async getCapabilities() { return ${JSON.stringify(capabilities())}; },
      async requestHistory() { historyCalls += 1; throw new Error("Warm cache unexpectedly requested provider history."); },
    }, {
      now: () => 600_000,
      historyCache: createHistoricalCandleCache(database),
      cacheFingerprintForProfile: () => "provider-state:v1",
    });
    try {
      const candles = await service.requestHistory("profile-a", ${JSON.stringify(request)});
      console.log(JSON.stringify({ pid: process.pid, historyCalls, candles }));
    } finally {
      await service.shutdown();
      database.close();
    }
  `,
      ],
      { encoding: "utf8", timeout: 10_000, windowsHide: true },
    ),
  );
  assert.notEqual(result.pid, process.pid);
  assert.equal(result.historyCalls, 0);
  return result.candles;
}

test("fresh-process warm explicit finalized range makes zero provider history calls", async () => {
  await withDatabase(async (databasePath) => {
    const request = {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      fromMs: 0,
      toMs: 120_000,
      limit: 3,
    };
    const firstDatabase = await openStorageDatabase(databasePath);
    const firstUpstream = createUpstream();
    const first = createProviderDataService(
      firstUpstream.upstream,
      cacheOptions(firstDatabase, 600_000),
    );
    assert.equal((await first.requestHistory("profile-a", request)).length, 3);
    assert.equal(firstUpstream.history.length, 1);
    await first.shutdown();
    firstDatabase.close();

    assert.deepEqual(
      loadWarmInFreshProcess(databasePath, request),
      historyFor(request),
    );
  });
});

test("partial warm cache requests only the missing bounded gap", async () => {
  await withDatabase(async (databasePath) => {
    const request = {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      fromMs: 0,
      toMs: 120_000,
      limit: 3,
    };
    const firstDatabase = await openStorageDatabase(databasePath);
    const first = createProviderDataService(
      createUpstream().upstream,
      cacheOptions(firstDatabase, 600_000),
    );
    await first.requestHistory("profile-a", request);
    await first.shutdown();
    firstDatabase
      .prepare("DELETE FROM candles WHERE open_time_ms = ?")
      .run(60_000);
    firstDatabase.close();

    const secondDatabase = await openStorageDatabase(databasePath);
    const secondUpstream = createUpstream();
    const second = createProviderDataService(
      secondUpstream.upstream,
      cacheOptions(secondDatabase, 600_000),
    );
    try {
      const result = await second.requestHistory("profile-a", request);
      assert.deepEqual(
        result.map(({ openTimeMs }) => openTimeMs),
        [0, 60_000, 120_000],
      );
      assert.deepEqual(
        secondUpstream.history.map(({ request: value }) => value),
        [
          {
            instrumentId: "BTCUSD",
            timeframeId: "1m",
            fromMs: 60_000,
            toMs: 60_000,
            limit: 1,
          },
        ],
      );
    } finally {
      await second.shutdown();
      secondDatabase.close();
    }
  });
});

test("newest history refreshes the cached finalized tail and current building bucket", async () => {
  await withDatabase(async (databasePath) => {
    const firstDatabase = await openStorageDatabase(databasePath);
    const first = createProviderDataService(
      createUpstream().upstream,
      cacheOptions(firstDatabase, 600_000),
    );
    await first.requestHistory("profile-a", {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      fromMs: 0,
      toMs: 240_000,
      limit: 5,
    });
    await first.shutdown();
    firstDatabase.close();

    const secondDatabase = await openStorageDatabase(databasePath);
    const secondUpstream = createUpstream();
    const second = createProviderDataService(
      secondUpstream.upstream,
      cacheOptions(secondDatabase, 360_000),
    );
    try {
      const result = await second.requestHistory("profile-a", {
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        limit: 3,
      });
      assert.deepEqual(
        secondUpstream.history.map(({ request: value }) => value),
        [
          {
            instrumentId: "BTCUSD",
            timeframeId: "1m",
            fromMs: 240_000,
            toMs: 360_000,
            limit: 3,
          },
        ],
      );
      assert.deepEqual(
        result.map(({ openTimeMs }) => openTimeMs),
        [240_000, 300_000, 360_000],
      );
    } finally {
      await second.shutdown();
      secondDatabase.close();
    }
  });
});

test("derived restart reuses persisted native source constituents without provider history", async () => {
  await withDatabase(async (databasePath) => {
    const request = {
      instrumentId: "BTCUSD",
      timeframeId: "3m",
      fromMs: 0,
      toMs: 300_000,
      limit: 2,
    };
    const firstDatabase = await openStorageDatabase(databasePath);
    const firstUpstream = createUpstream();
    const first = createProviderDataService(
      firstUpstream.upstream,
      cacheOptions(firstDatabase, 600_000),
    );
    const expected = await first.requestHistory("profile-a", request);
    assert.equal(expected.length, 2);
    assert.equal(firstUpstream.history[0].request.timeframeId, "1m");
    await first.shutdown();
    firstDatabase.close();

    assert.deepEqual(loadWarmInFreshProcess(databasePath, request), expected);
  });
});

test("cache read corruption falls back to provider and cache write failure does not reject valid history", async () => {
  const fixture = createUpstream();
  const errors = [];
  const failingCache = {
    newest() {
      throw new Error("corrupt cache row");
    },
    range() {
      throw new Error("corrupt cache row");
    },
    upsert() {
      throw new Error("disk full");
    },
    retain() {
      throw new Error("disk full");
    },
  };
  const service = createProviderDataService(fixture.upstream, {
    now: () => 600_000,
    historyCache: failingCache,
    cacheFingerprintForProfile: () => "provider-state:v1",
    onCacheError(operation, error) {
      errors.push({
        operation,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });
  try {
    const result = await service.requestHistory("profile-a", {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      fromMs: 0,
      toMs: 120_000,
      limit: 3,
    });
    assert.equal(result.length, 3);
    assert.equal(fixture.history.length, 1);
    assert.equal(
      errors.some(({ operation }) => operation === "read"),
      true,
    );
    assert.equal(
      errors.some(({ operation }) => operation === "write"),
      true,
    );
  } finally {
    await service.shutdown();
  }
});

test("real SQLite full cache leaves provider history usable and database intact", async () => {
  await withDatabase(async (databasePath) => {
    const database = await openStorageDatabase(databasePath);
    const pages = database.prepare("PRAGMA page_count").get().page_count;
    database.exec(`PRAGMA max_page_count=${pages}`);
    const fixture = createUpstream();
    const errors = [];
    const service = createProviderDataService(
      fixture.upstream,
      cacheOptions(database, 600_000_000, "provider-state:v1", errors),
    );
    const request = {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      fromMs: 0,
      toMs: 59_940_000,
      limit: 1000,
    };
    try {
      assert.deepEqual(
        await service.requestHistory("profile-a", request),
        historyFor(request),
      );
      assert.ok(
        errors.some(
          ({ operation, error }) =>
            operation === "write" && error.errcode === 13,
        ),
      );
      assert.equal(
        database.prepare("PRAGMA integrity_check").get().integrity_check,
        "ok",
      );
      assert.equal(database.isTransaction, false);
    } finally {
      await service.shutdown();
      database.close();
    }
  });
});

test("building candle is never written to persistent history cache", async () => {
  await withDatabase(async (databasePath) => {
    const database = await openStorageDatabase(databasePath);
    const upstream = createUpstream();
    upstream.upstream.requestHistory = async (providerProfileId, request) => {
      upstream.history.push({ providerProfileId, request: { ...request } });
      return [candle(0), candle(60_000), candle(120_000)];
    };
    const service = createProviderDataService(
      upstream.upstream,
      cacheOptions(database, 120_000),
    );
    try {
      await service.requestHistory("profile-a", {
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        fromMs: 0,
        toMs: 120_000,
        limit: 3,
      });
      assert.deepEqual(
        database
          .prepare(
            "SELECT DISTINCT open_time_ms FROM candles ORDER BY open_time_ms",
          )
          .all()
          .map(({ open_time_ms }) => open_time_ms),
        [0, 60_000],
      );
    } finally {
      await service.shutdown();
      database.close();
    }
  });
});
