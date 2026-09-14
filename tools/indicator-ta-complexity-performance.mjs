import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  createAtrKernel,
  createCrossoverKernel,
  createHighestKernel,
  createLowestKernel,
  createMovingAverageKernel,
  createRsiKernel,
} from "../packages/indicator-sdk/dist/ta.js";

// Run after npm run build. Synthetic, no renderer, storage or network.
const steadyStateUpdates = 100_000;
const largePeriod = 50_000;
const perKernelBudgetMs = 1_000;

function measure(name, run) {
  const started = performance.now();
  run();
  const elapsedMs = performance.now() - started;
  assert.ok(
    elapsedMs < perKernelBudgetMs,
    `${name} steady-state path exceeded ${perKernelBudgetMs} ms: ${elapsedMs}`,
  );
  return elapsedMs;
}

function seedNumeric(kernel, count, valueAt) {
  for (let index = 0; index < count; index += 1) {
    kernel.update(valueAt(index), "finalized");
  }
}

const sma = createMovingAverageKernel("sma", largePeriod);
seedNumeric(sma, largePeriod, (index) => index + 1);
const smaMs = measure("SMA", () => {
  for (let index = 0; index < steadyStateUpdates; index += 1) {
    sma.update(index, "building");
  }
});

const ema = createMovingAverageKernel("ema", largePeriod);
seedNumeric(ema, largePeriod, (index) => index + 1);
const emaMs = measure("EMA", () => {
  for (let index = 0; index < steadyStateUpdates; index += 1) {
    ema.update(index, "building");
  }
});

const rsi = createRsiKernel(14);
seedNumeric(rsi, 20, (index) => 100 + index);
const rsiMs = measure("RSI", () => {
  for (let index = 0; index < steadyStateUpdates; index += 1) {
    rsi.update(120 + (index % 3), "building");
  }
});

const atr = createAtrKernel(14);
for (let index = 0; index < 20; index += 1) {
  atr.update(
    {
      instrumentId: "PERF",
      timeframeId: "1m",
      openTimeMs: index * 60_000,
      open: 100,
      high: 102,
      low: 99,
      close: 101,
    },
    "finalized",
  );
}
const atrMs = measure("ATR", () => {
  for (let index = 0; index < steadyStateUpdates; index += 1) {
    atr.update(
      {
        instrumentId: "PERF",
        timeframeId: "1m",
        openTimeMs: (20 + index) * 60_000,
        open: 101,
        high: 103,
        low: 100,
        close: 102,
      },
      "building",
    );
  }
});

const crossover = createCrossoverKernel();
crossover.update(1, 2, "finalized");
const crossoverMs = measure("crossover", () => {
  for (let index = 0; index < steadyStateUpdates; index += 1) {
    crossover.update(index % 2, (index + 1) % 2, "building");
  }
});

function measureExtremum(name, factory, direction) {
  const kernel = factory(largePeriod);
  return measure(name, () => {
    for (let index = 0; index < steadyStateUpdates; index += 1) {
      const value =
        direction === "descending"
          ? steadyStateUpdates - index
          : index - steadyStateUpdates;
      kernel.update(value, "finalized");
    }
  });
}

const highestMs = measureExtremum("highest", createHighestKernel, "descending");
const lowestMs = measureExtremum("lowest", createLowestKernel, "ascending");

console.log(
  JSON.stringify({
    component: "indicator-ta-complexity",
    steadyStateUpdates,
    largePeriod,
    perKernelBudgetMs,
    elapsedMs: {
      sma: smaMs,
      ema: emaMs,
      rsi: rsiMs,
      atr: atrMs,
      crossover: crossoverMs,
      highest: highestMs,
      lowest: lowestMs,
    },
  }),
);
