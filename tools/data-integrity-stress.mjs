import assert from "node:assert/strict";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { createProviderDataService } from "../packages/data-service/dist/index.js";

// ponytail: Domain-only stress; add Electron paint/process metrics on the approved benchmark machine.
const barCount = 100_000;
const baseTimeMs = barCount * 60_000;
const request = { instrumentId: "BTCUSD", timeframeId: "1m" };
const active = new Set();
let acquisitions = 0;
let releases = 0;
let historyCalls = 0;
let tickSequence = 0;
let nowMs = baseTimeMs;
const errors = [];
const delivered = [0, 0, 0, 0];
const upstream = {
  async getCapabilities() {
    return {
      instruments: true,
      nativeTimeframes: ["1m"],
      liveData: true,
      derivedTimeframes: false,
    };
  },
  async getInstruments() {
    return [];
  },
  async requestHistory(_profileId, input) {
    historyCalls += 1;
    const fromMs = input.fromMs ?? 0;
    const toMs = input.toMs ?? baseTimeMs - 60_000;
    const length = Math.min(
      input.limit ?? barCount,
      Math.floor((toMs - fromMs) / 60_000) + 1,
    );
    return Array.from({ length }, (_, index) => ({
      ...request,
      openTimeMs: fromMs + index * 60_000,
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 1,
    }));
  },
  async subscribe(_profileId, _request, sink) {
    acquisitions += 1;
    active.add(sink);
    return {
      async unsubscribe() {
        assert.equal(
          active.delete(sink),
          true,
          "Each upstream must release exactly once.",
        );
        releases += 1;
      },
    };
  },
};
const service = createProviderDataService(upstream, { now: () => nowMs });
const sinkFor = (index) => ({
  onCandles() {
    /* Tick delivery and the final canonical snapshot are checked below. */
  },
  onTicks(ticks) {
    delivered[index] += ticks.length;
  },
  onError(code) {
    errors.push(code);
  },
});
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
const startMemory = process.memoryUsage();
const started = performance.now();
const rates = [];
const retainedHeap = [];
const sampleHeap = (phase, cycle) => {
  if (typeof globalThis.gc !== "function") return;
  globalThis.gc();
  retainedHeap.push({ phase, cycle, heapUsed: process.memoryUsage().heapUsed });
};
let snapshot;
try {
  loopDelay.enable();
  const historyStarted = performance.now();
  const history = await service.requestHistory("profile-stress", {
    ...request,
    fromMs: 0,
    toMs: baseTimeMs - 60_000,
    limit: barCount,
  });
  assert.equal(history.length, barCount);
  const historyMs = performance.now() - historyStarted;
  const handles = await Promise.all(
    delivered.map((_, index) =>
      service.subscribe("profile-stress", request, sinkFor(index)),
    ),
  );
  assert.equal(active.size, 1);

  for (const ticksPerSecond of [100, 1_000]) {
    const rateStarted = performance.now();
    let maximumDispatchMs = 0;
    let maximumScheduleLagMs = 0;
    // 1,000 scheduled batches at 10 ms: ten seconds per rate, without dropping late work.
    for (let batch = 0; batch < 1_000; batch += 1) {
      const due = rateStarted + batch * 10;
      const waitMs = due - performance.now();
      if (waitMs > 0) await delay(waitMs);
      maximumScheduleLagMs = Math.max(
        maximumScheduleLagMs,
        performance.now() - due,
      );
      const ticks = Array.from({ length: ticksPerSecond / 100 }, () => {
        tickSequence += 1;
        nowMs = baseTimeMs + tickSequence;
        return {
          instrumentId: request.instrumentId,
          timestampMs: nowMs,
          price: 100 + (tickSequence % 7),
          volume: 1,
        };
      });
      const dispatchStarted = performance.now();
      for (const sink of active) sink.onTicks(ticks);
      maximumDispatchMs = Math.max(
        maximumDispatchMs,
        performance.now() - dispatchStarted,
      );
    }
    const elapsedMs = performance.now() - rateStarted;
    rates.push({
      ticksPerSecond,
      ticks: ticksPerSecond * 10,
      elapsedMs,
      deliveredTicksPerSecond: (ticksPerSecond * 10 * 1_000) / elapsedMs,
      maximumDispatchMs,
      maximumScheduleLagMs,
    });
  }
  assert.deepEqual(delivered, [11_000, 11_000, 11_000, 11_000]);
  snapshot = await service.seriesSnapshot("profile-stress", request);
  assert.equal(snapshot.building?.close, 100 + (tickSequence % 7));
  assert.equal(snapshot.building?.volume, 11_000);
  assert.ok(
    service.tickSnapshot("profile-stress", request.instrumentId).length <= 4096,
  );
  await Promise.all(handles.map((handle) => handle.unsubscribe()));
  assert.equal(active.size, 0);

  sampleHeap("acquire-release", 0);
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const handle = await service.subscribe(
      "profile-stress",
      request,
      sinkFor(0),
    );
    await handle.unsubscribe();
    assert.equal(active.size, 0);
    if ((cycle + 1) % 25 === 0) sampleHeap("acquire-release", cycle + 1);
  }
  const handle = await service.subscribe("profile-stress", request, sinkFor(0));
  sampleHeap("invalidate-restore", 0);
  for (let cycle = 0; cycle < 20; cycle += 1) {
    await service.invalidateProfile("profile-stress");
    assert.equal(active.size, 0);
    await service.restoreProfile("profile-stress");
    assert.equal(active.size, 1);
    if ((cycle + 1) % 5 === 0) sampleHeap("invalidate-restore", cycle + 1);
  }
  await handle.unsubscribe();
  await service.shutdown();
  assert.equal(active.size, 0);
  assert.equal(acquisitions, releases);
  assert.deepEqual(errors, []);
  loopDelay.disable();
  console.log(
    JSON.stringify(
      {
        scope:
          "Synthetic Node data service only; no renderer, workers, cache or before-cutover comparison.",
        barCount,
        logicalConsumers: 4,
        historyMs,
        rates,
        delivered,
        acquireReleaseCycles: 100,
        invalidateRestoreCycles: 20,
        acquisitions,
        releases,
        activeUpstreams: active.size,
        historyCalls,
        finalizedBars: snapshot.timeMs.length,
        buildingBars: snapshot.building === undefined ? 0 : 1,
        elapsedMs: performance.now() - started,
        eventLoopDelayP95Ms: loopDelay.percentile(95) / 1_000_000,
        startMemory,
        endMemory: process.memoryUsage(),
        retainedHeap,
        activeResourceTypesAfterShutdown: process.getActiveResourcesInfo(),
      },
      null,
      2,
    ),
  );
  assert.ok(
    snapshot.timeMs.length + (snapshot.building === undefined ? 0 : 1) <=
      barCount,
    "The 100,000-active-candle limit includes the building candle.",
  );
} finally {
  loopDelay.disable();
  await service.shutdown();
}
