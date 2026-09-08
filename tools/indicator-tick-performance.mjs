import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  createCanonicalCandleState,
  createProviderDataService,
} from "../packages/data-service/dist/index.js";
import { atrRopeUtBotIndicator } from "../packages/indicator-examples/dist/index.js";

// Run after npm run build. Synthetic, no storage, credentials or network.
// Times are observations; operation-count assertions are the regression gates.
const candle = (index) => ({
  instrumentId: "PERF",
  timeframeId: "1m",
  openTimeMs: index * 60_000,
  open: 10,
  high: 12,
  low: 9,
  close: 11,
});
const alignment = { mode: "epoch", originMs: 0, timeZone: "UTC" };
for (const size of [1_000, 100_000]) {
  for (const timeframeId of ["1m", "2m"]) {
    const now = size * 60_000 + 1_000;
    let live;
    let measuring = false;
    let historicalObjects = 0;
    const canonical = createCanonicalCandleState();
    const service = createProviderDataService(
      {
        async getCapabilities() {
          return {
            instruments: true,
            nativeTimeframes: ["1m"],
            derivedTimeframes: true,
            liveData: true,
            timeframes: [
              {
                id: "1m",
                seconds: 60,
                native: true,
                historical: true,
                live: true,
                alignment,
              },
              {
                id: "2m",
                seconds: 120,
                native: false,
                derivedFromTimeframeId: "1m",
                historical: true,
                live: true,
                alignment,
              },
            ],
          };
        },
        async getInstruments() {
          return [];
        },
        async requestHistory(_profile, request) {
          const start = request.fromMs ?? 0;
          const end = request.toMs ?? now;
          return Array.from(
            {
              length: Math.min(
                request.limit ?? size,
                Math.floor((end - start) / 60_000) + 1,
              ),
            },
            (_, index) => candle(start / 60_000 + index),
          );
        },
        async subscribe(_profile, _request, sink) {
          live = sink;
          return {
            async unsubscribe() {
              return undefined;
            },
          };
        },
      },
      {
        now: () => now,
        candleState: {
          ...canonical,
          finalizedCandles(key) {
            const rows = canonical.finalizedCandles(key);
            if (measuring) historicalObjects += rows.length;
            return rows;
          },
        },
      },
    );
    let handle;
    const errors = [];
    try {
      await service.requestHistory("perf", {
        instrumentId: "PERF",
        timeframeId,
        fromMs: 0,
        toMs: (size - 1) * 60_000,
        limit: timeframeId === "1m" ? size : size / 2,
      });
      handle = await service.subscribe(
        "perf",
        { instrumentId: "PERF", timeframeId },
        {
          onCandles() {
            /* Delivery is measured upstream; no renderer in this fixture. */
          },
          onTicks() {
            /* No tick consumer workload in this fixture. */
          },
          onError(code) {
            errors.push(code);
          },
        },
      );
      for (let index = 0; index < 20; index += 1)
        live.onTicks([
          {
            instrumentId: "PERF",
            timestampMs: now + index,
            price: 10 + index / 100,
          },
        ]);
      measuring = true;
      const started = performance.now();
      for (let index = 0; index < 100; index += 1)
        live.onTicks([
          {
            instrumentId: "PERF",
            timestampMs: now + 100 + index,
            price: 10 + index / 100,
          },
        ]);
      const elapsedMs = performance.now() - started;
      assert.deepEqual(errors, []);
      assert.equal(
        historicalObjects,
        0,
        "ordinary ticks must not materialize finalized history",
      );
      console.log(
        JSON.stringify({
          component: "data-service",
          sourceBars: size,
          timeframeId,
          ticks: 100,
          elapsedMs,
          historicalObjects,
        }),
      );
    } finally {
      await handle?.unsubscribe();
      await service.shutdown();
    }
  }
}

const parameters = Object.fromEntries(
  atrRopeUtBotIndicator.definition.inputs.map((input) => [
    input.key,
    input.defaultValue,
  ]),
);
for (const size of [1_000, 100_000]) {
  const instance = atrRopeUtBotIndicator.createInstance(parameters, {
    instrumentId: "PERF",
    timeframeId: "1m",
  });
  try {
    instance.onHistory(
      Array.from({ length: size }, (_, index) => candle(index)),
    );
    const points = instance.snapshot().points;
    const overlays = instance.snapshot().overlays;
    for (let index = 0; index < 20; index += 1)
      instance.onBuildingBar({ ...candle(size - 1), close: 10 + index / 100 });
    const started = performance.now();
    for (let index = 0; index < 1_000; index += 1)
      instance.onBuildingBar({
        ...candle(size - 1),
        close: 10 + (index % 100) / 100,
      });
    const elapsedMs = performance.now() - started;
    assert.strictEqual(
      instance.snapshot().points,
      points,
      "building updates must not clone historical points",
    );
    assert.strictEqual(
      instance.snapshot().overlays,
      overlays,
      "unchanged finalized geometry must be reused",
    );
    console.log(
      JSON.stringify({
        component: "atr-rope-utbot",
        historyBars: size,
        ticks: 1_000,
        elapsedMs,
      }),
    );
  } finally {
    instance.dispose();
  }
}
