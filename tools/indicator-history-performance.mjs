import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

// Run after npm run build. Synthetic, no renderer, storage, credentials or network.
const context = { instrumentId: "PERF", timeframeId: "1m" };
const candle = (index, close = 11 + (index % 10) / 10) => ({
  ...context,
  openTimeMs: index * 60_000,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: index + 1,
});

const sourceDirectory = await mkdtemp(
  path.join(import.meta.dirname, ".history-performance-source-"),
);
const outputDirectory = await mkdtemp(
  path.join(os.tmpdir(), "erc-history-performance-"),
);

try {
  const source = path.join(sourceDirectory, "indicator.ts");
  await writeFile(
    source,
    `import { defineIndicator, history, plot } from "@erc-chart/indicator-sdk";

export default defineIndicator(
  { id: "erc.indicator.history-performance.main", name: "History performance" },
  ({ close }) => {
    plot.line(close[1], { key: "indexed" });
    plot.line(close.at(1), { key: "at" });
    plot.line(history(close, 1), { key: "explicit" });
    plot.line(history(close * 2, 1), { key: "derived" });
  },
);
`,
    "utf8",
  );

  const { manifest, packageRoot } = await buildIndicatorPackage({
    source,
    outputRoot: path.join(outputDirectory, "package"),
    id: "erc.indicator.history-performance",
    version: "0.1.0",
  });
  const entry = await readFile(path.join(packageRoot, manifest.entry));
  const { default: plugin } = await import(
    `data:text/javascript;base64,${entry.toString("base64")}`
  );

  for (const historyBars of [1_000, 100_000]) {
    const instance = plugin.createInstance({}, context);
    try {
      const candles = Array.from({ length: historyBars }, (_, index) =>
        candle(index),
      );
      const historyStarted = performance.now();
      instance.onHistory(candles);
      const historyElapsedMs = performance.now() - historyStarted;
      assert.ok(
        historyElapsedMs < 60_000,
        `History replay exceeded the 60,000 ms worker budget: ${historyElapsedMs}`,
      );
      assert.equal(instance.snapshot().points.length, historyBars);

      for (let index = 0; index < 20; index += 1) {
        instance.onBuildingBar(
          candle(historyBars - 1, 20 + (index % 10) / 10),
        );
      }
      let maximumBuildingMs = 0;
      const buildingStarted = performance.now();
      for (let index = 0; index < 1_000; index += 1) {
        const updateStarted = performance.now();
        instance.onBuildingBar(
          candle(historyBars - 1, 30 + (index % 100) / 100),
        );
        maximumBuildingMs = Math.max(
          maximumBuildingMs,
          performance.now() - updateStarted,
        );
      }
      const buildingElapsedMs = performance.now() - buildingStarted;
      assert.ok(
        maximumBuildingMs < 100,
        `History building update exceeded the 100 ms worker budget: ${maximumBuildingMs}`,
      );

      const finalizedStarted = performance.now();
      instance.onFinalizedBar(candle(historyBars - 1, 40));
      const finalizedElapsedMs = performance.now() - finalizedStarted;
      assert.ok(
        finalizedElapsedMs < 100,
        `History finalization exceeded the 100 ms worker budget: ${finalizedElapsedMs}`,
      );

      console.log(
        JSON.stringify({
          component: "indicator-history",
          historyBars,
          historyElapsedMs,
          buildingUpdates: 1_000,
          buildingElapsedMs,
          maximumBuildingMs,
          finalizedElapsedMs,
        }),
      );
    } finally {
      instance.dispose();
    }
  }
} finally {
  await rm(sourceDirectory, { recursive: true, force: true });
  await rm(outputDirectory, { recursive: true, force: true });
}
