import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import { buildIndicatorPackage } from "../../../tools/build-indicator-package.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const packageRoot = await mkdtemp(
  path.join(os.tmpdir(), "erc-atr-bands-v2-tests-"),
);
const built = await buildIndicatorPackage({
  source: path.join(repoRoot, "packages/indicator-examples/src/atr-bands.ts"),
  outputRoot: path.join(packageRoot, "package"),
  id: "erc.indicator.atr-bands",
  version: "0.1.0",
});
const entry = await readFile(
  path.join(built.packageRoot, built.manifest.entry),
);
const { default: atrBandsIndicator } = await import(
  `data:text/javascript;base64,${entry.toString("base64")}`
);
after(async () => rm(packageRoot, { recursive: true, force: true }));

function parameters(overrides = {}) {
  const values = Object.fromEntries(
    atrBandsIndicator.definition.inputs.map((input) => [
      input.key,
      input.defaultValue,
    ]),
  );
  for (const [label, value] of Object.entries(overrides)) {
    const input = atrBandsIndicator.definition.inputs.find(
      (candidate) => candidate.label === label,
    );
    assert.ok(input, `Missing ATR Bands input ${label}`);
    values[input.key] = value;
  }
  return values;
}

function outputKey(label) {
  const plot = atrBandsIndicator.definition.plots.find(
    (candidate) => candidate.label === label,
  );
  assert.ok(plot, `Missing ATR Bands plot ${label}`);
  return plot.outputKey ?? plot.key;
}

function fixtureCandles() {
  const closes = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 20, 20];
  return closes.map((close, index) => ({
    instrumentId: "atr-bands.fixture",
    timeframeId: "1m",
    openTimeMs: 1_900_000_000_000 + index * 60_000,
    open: index === 0 ? close : closes[index - 1],
    high: Math.max(index === 0 ? close : closes[index - 1], close) + 1,
    low: Math.min(index === 0 ? close : closes[index - 1], close) - 1,
    close,
    volume: 1,
  }));
}

test("ATR Bands keeps symmetric ATR envelopes and emits the finalized crossover signal", () => {
  const candles = fixtureCandles();
  const instance = atrBandsIndicator.createInstance(
    parameters({ Length: 3, "ATR multiplier": 2 }),
    { instrumentId: "atr-bands.fixture", timeframeId: "1m" },
  );
  try {
    instance.onHistory(candles);
    const snapshot = instance.snapshot();
    const basisKey = outputKey("Basis");
    const upperKey = outputKey("Upper");
    const lowerKey = outputKey("Lower");
    const crossKey = outputKey("Cross up");
    const crossoverPoint = snapshot.points[10];

    assert.equal(snapshot.points.length, candles.length);
    assert.ok(Number.isFinite(crossoverPoint.values[basisKey]));
    assert.ok(Number.isFinite(crossoverPoint.values[upperKey]));
    assert.ok(Number.isFinite(crossoverPoint.values[lowerKey]));
    assert.ok(
      Math.abs(
        crossoverPoint.values[upperKey] -
          crossoverPoint.values[basisKey] -
          (crossoverPoint.values[basisKey] - crossoverPoint.values[lowerKey]),
      ) < 1e-9,
    );
    assert.equal(crossoverPoint.values[crossKey], candles[10].low);
    assert.deepEqual(
      snapshot.signals?.map(({ direction, occurredAtMs, finalized }) => ({
        direction,
        occurredAtMs,
        finalized,
      })),
      [
        {
          direction: "long",
          occurredAtMs: candles[10].openTimeMs,
          finalized: true,
        },
      ],
    );
  } finally {
    instance.dispose();
  }
});
