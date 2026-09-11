import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

const context = { instrumentId: "TEST", timeframeId: "1m" };
const candle = (index) => ({
  ...context,
  openTimeMs: index * 60_000,
  open: 10,
  high: 12,
  low: 9,
  close: 11,
  volume: index + 1,
});

async function packagedPlugin(sourceText, id) {
  const sourceDirectory = await mkdtemp(
    path.join(import.meta.dirname, ".conditional-kernel-capacity-source-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-conditional-kernel-capacity-package-"),
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

function conditionalSeriesCalls(count, { repeatFirstAt } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const condition =
      index === 0 && repeatFirstAt !== undefined
        ? `bar.index === 0 || bar.index === ${repeatFirstAt}`
        : `bar.index === ${index}`;
    return `    if (${condition}) series(${index}, (previous) => previous + 1);`;
  }).join("\n");
}

function sourceWithConditionalSeries(count, options = {}) {
  return `import { defineIndicator, plot, series } from "@erc-chart/indicator-sdk";

export default defineIndicator(
  { id: "erc.indicator.kernel-capacity.main", name: "Kernel capacity" },
  (bar) => {
${conditionalSeriesCalls(count, options)}
    plot.line(bar.close, { key: "close", title: "Close" });
  },
);
`;
}

test("conditional compiler kernels enforce the 256-slot persistent limit across bars", async () => {
  const { default: plugin } = await packagedPlugin(
    sourceWithConditionalSeries(257),
    "erc.indicator.kernel-capacity-overflow",
  );
  const instance = plugin.createInstance({}, context);
  try {
    assert.throws(
      () =>
        instance.onHistory(
          Array.from({ length: 258 }, (_, index) => candle(index)),
        ),
      /An indicator may use at most 256 TA calls/u,
    );
  } finally {
    instance.dispose();
  }
});

test("conditional compiler kernels may reuse an existing slot at the 256-slot limit", async () => {
  const { default: plugin } = await packagedPlugin(
    sourceWithConditionalSeries(256, { repeatFirstAt: 256 }),
    "erc.indicator.kernel-capacity-reuse",
  );
  const instance = plugin.createInstance({}, context);
  try {
    assert.doesNotThrow(() =>
      instance.onHistory(
        Array.from({ length: 258 }, (_, index) => candle(index)),
      ),
    );
  } finally {
    instance.dispose();
  }
});
