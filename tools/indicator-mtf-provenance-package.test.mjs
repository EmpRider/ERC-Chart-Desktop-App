import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

async function packagedPlugin(sourceText, id) {
  const sourceDirectory = await mkdtemp(
    path.join(import.meta.dirname, ".mtf-provenance-source-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-mtf-provenance-package-"),
  );
  try {
    const source = path.join(sourceDirectory, "indicator.ts");
    await writeFile(source, sourceText, "utf8");
    const { manifest, packageRoot } = await buildIndicatorPackage({
      source,
      outputRoot: path.join(outputDirectory, "package"),
      id,
      version: "0.1.0",
    });
    const entry = await readFile(path.join(packageRoot, manifest.entry));
    return await import(
      `data:text/javascript;base64,${entry.toString("base64")}`
    );
  } finally {
    await rm(sourceDirectory, { recursive: true, force: true });
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

test("compiled indicator timeframe keeps the selected input identity when defaults match", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, indicator, input, plot } from "@erc-chart/indicator-sdk";
export default defineIndicator(
  { id: "erc.indicator.timeframe-input-identity.main", name: "Timeframe input identity" },
  () => {
    const selected = input.timeframe("1h", { title: "Selected" });
    input.timeframe("1h", { title: "Unrelated" });
    indicator.timeframe(selected);
    plot.line(1, { key: "value" });
  },
);`,
    "erc.indicator.timeframe-input-identity",
  );

  const selected = plugin.definition.inputs.find(
    ({ label }) => label === "Selected",
  );
  assert.ok(selected);
  assert.equal(plugin.definition.source.timeframe.inputKey, selected.key);
});

test("compiled static indicator timeframe does not bind an equal-valued input", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, indicator, input, plot } from "@erc-chart/indicator-sdk";
export default defineIndicator(
  { id: "erc.indicator.static-timeframe.main", name: "Static timeframe" },
  () => {
    input.timeframe("1h", { title: "Unrelated" });
    indicator.timeframe("1h");
    plot.line(1, { key: "value" });
  },
);`,
    "erc.indicator.static-timeframe",
  );

  assert.deepEqual(plugin.definition.source.timeframe, {
    requestedTimeframeId: "1h",
  });
});

function baseCandles() {
  return Array.from({ length: 5 }, (_, index) => ({
    instrumentId: "TEST",
    timeframeId: "15m",
    openTimeMs: index * 15 * 60_000,
    open: 10 + index,
    high: 30 + index,
    low: 5 + index,
    close: 20 + index,
    volume: 1_000 + index,
  }));
}

function higherCandles() {
  return [
    {
      instrumentId: "TEST",
      timeframeId: "1h",
      openTimeMs: 0,
      open: 100,
      high: 300,
      low: 50,
      close: 200,
      volume: 500,
    },
    {
      instrumentId: "TEST",
      timeframeId: "1h",
      openTimeMs: 60 * 60_000,
      open: 101,
      high: 301,
      low: 51,
      close: 201,
      volume: 501,
    },
  ];
}

test("compiled higher-timeframe TA preserves direct open and volume provenance", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, plot, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator(
  { id: "erc.indicator.mtf-series-provenance.main", name: "MTF provenance" },
  ({ open, volume }) => {
    plot.line(ta.ema(open, 1, "1h"), { key: "source_open" });
    plot.line(ta.ema(volume, 1, "1h"), { key: "source_volume" });
  },
);`,
    "erc.indicator.mtf-series-provenance",
  );
  const instance = plugin.createInstance(
    {},
    {
      instrumentId: "TEST",
      timeframeId: "15m",
      sourceCandles: { "1h": higherCandles() },
    },
  );
  try {
    instance.onHistory(baseCandles());
    assert.equal(instance.snapshot().points[3].values.source_open, 100);
    assert.equal(instance.snapshot().points[3].values.source_volume, 500);
  } finally {
    instance.dispose();
  }
});

test("compiled higher-timeframe TA rejects derived expressions instead of guessing provenance", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, plot, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator(
  { id: "erc.indicator.mtf-derived-source.main", name: "MTF derived source" },
  ({ close }) => {
    plot.line(ta.ema(close * 2, 1, "1h"), { key: "derived" });
  },
);`,
    "erc.indicator.mtf-derived-source",
  );
  const instance = plugin.createInstance(
    {},
    {
      instrumentId: "TEST",
      timeframeId: "15m",
      sourceCandles: { "1h": higherCandles() },
    },
  );
  try {
    assert.throws(
      () => instance.onHistory(baseCandles()),
      /direct candle series/u,
    );
  } finally {
    instance.dispose();
  }
});
