import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

const context = { instrumentId: "TEST", timeframeId: "1m" };

const candle = (index, close) => ({
  ...context,
  openTimeMs: index * 60_000,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: index + 1,
});

async function packagedPlugin(sourceText, id) {
  const sourceDirectory = await mkdtemp(
    path.join(import.meta.dirname, ".output-identity-source-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-output-identity-package-"),
  );
  try {
    const source = path.join(sourceDirectory, "indicator.ts");
    await writeFile(source, sourceText, "utf8");
    const result = await buildIndicatorPackage({
      source,
      outputRoot: path.join(outputDirectory, "package"),
      id,
      version: "0.1.0",
    });
    const entry = await readFile(
      path.join(result.packageRoot, result.manifest.entry),
    );
    return await import(
      `data:text/javascript;base64,${entry.toString("base64")}`
    );
  } finally {
    await rm(sourceDirectory, { recursive: true, force: true });
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

test("plot identity survives reordering", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
function fast(value) { plot.line(value, { key: "fast", title: "Fast" }); }
function slow(value) { plot.line(value * 10, { key: "slow", title: "Slow" }); }
export default defineIndicator(
  { id: "erc.indicator.output-identity.main", name: "Output identity" },
  ({ close }) => {
    if (close > 15) { slow(close); fast(close); }
    else { fast(close); slow(close); }
  },
);
`,
    "erc.indicator.output-identity",
  );

  const fast = plugin.definition.plots.find(
    (value) => value.outputKey === "fast",
  );
  const slow = plugin.definition.plots.find(
    (value) => value.outputKey === "slow",
  );
  assert.match(fast.key, /^erc-v2-plot-[0-9a-f]{24}$/u);
  assert.match(slow.key, /^erc-v2-plot-[0-9a-f]{24}$/u);

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 20), candle(2, 10)]);
    const points = instance.snapshot().points;
    assert.deepEqual(
      points.map((point) => point.values.fast),
      [10, 20, 10],
    );
    assert.deepEqual(
      points.map((point) => point.values.slow),
      [100, 200, 100],
    );
  } finally {
    instance.dispose();
  }
});

test("drawing scope state survives reordering", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
function fast(value, openTimeMs) {
  plot.drawings("fast", () => {
    plot.box({ id: "fast-zone", startTimeMs: openTimeMs, endTimeMs: openTimeMs + 60_000, top: value, bottom: value - 1, color: "#008800" });
  });
}
function slow(value, openTimeMs) {
  plot.drawings("slow", () => {
    plot.box({ id: "slow-zone", startTimeMs: openTimeMs, endTimeMs: openTimeMs + 60_000, top: value * 10, bottom: value * 10 - 1, color: "#880000" });
  });
}
export default defineIndicator(
  { id: "erc.indicator.drawing-identity.main", name: "Drawing identity" },
  ({ close, openTimeMs }) => {
    if (close > 15) { slow(close, openTimeMs); fast(close, openTimeMs); }
    else { fast(close, openTimeMs); slow(close, openTimeMs); }
  },
);
`,
    "erc.indicator.drawing-identity",
  );

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 20), candle(2, 10)]);
    const overlays = instance.snapshot().overlays;
    assert.equal(
      overlays.find((overlay) => overlay.id === "fast-zone")?.top,
      10,
    );
    assert.equal(
      overlays.find((overlay) => overlay.id === "slow-zone")?.top,
      100,
    );
  } finally {
    instance.dispose();
  }
});
