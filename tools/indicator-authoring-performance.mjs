import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";
import { transformIndicatorAuthoring } from "./indicator-authoring-transform.mjs";
import { transformIndicatorHistory } from "./indicator-authoring/history-transform.mjs";

// Run after npm run build. Synthetic, no renderer, storage, credentials or network.
const transformIterations = 25;
const transformOverheadBudgetMs = 100;
const packageBuildBudgetMs = 5_000;
const authoringRoot = await mkdtemp(
  path.join(import.meta.dirname, ".authoring-performance-source-"),
);
const outputDirectory = await mkdtemp(
  path.join(os.tmpdir(), "erc-authoring-performance-"),
);

const repeatedCalls = Array.from(
  { length: 24 },
  (_, index) => `
    const trend${index} = ta.ema(close[1], ${index + 2});
    plot.line(trend${index}, { key: "trend-${index}" });`,
).join("");
const sourceText = `import { defineIndicator, input, plot, signal, ta } from "@erc-chart/indicator-sdk";

export default defineIndicator(
  { id: "erc.indicator.authoring-performance.main", name: "Authoring performance" },
  ({ close }) => {
    const length = input.int(14, { key: "length" });${repeatedCalls}
    const fast = ta.sma(close, length);
    const slow = ta.sma(close, 28);
    plot.histogram(fast - slow, { key: "spread" });
    signal(fast > slow, "long", { key: "cross" });
  },
);
`;

function averageTransformMs(transform) {
  for (let index = 0; index < 5; index += 1) transform();
  const started = performance.now();
  for (let index = 0; index < transformIterations; index += 1) transform();
  return (performance.now() - started) / transformIterations;
}

try {
  const source = path.join(authoringRoot, "indicator.ts");
  await writeFile(
    path.join(authoringRoot, "package.json"),
    '{"name":"authoring-performance","private":true,"type":"module"}\n',
    "utf8",
  );
  await writeFile(source, sourceText, "utf8");

  const historyOnlyAverageMs = averageTransformMs(() =>
    transformIndicatorHistory(sourceText, source),
  );
  const composedAverageMs = averageTransformMs(() =>
    transformIndicatorAuthoring(sourceText, {
      fileName: source,
      sourceFileId: "indicator.ts",
    }),
  );
  const transformOverheadMs = Math.max(
    0,
    composedAverageMs - historyOnlyAverageMs,
  );
  assert.ok(
    transformOverheadMs < transformOverheadBudgetMs,
    `Authoring transform overhead exceeded the ${transformOverheadBudgetMs} ms budget: ${transformOverheadMs}`,
  );

  const packageStarted = performance.now();
  await buildIndicatorPackage({
    source,
    outputRoot: path.join(outputDirectory, "package"),
    id: "erc.indicator.authoring-performance",
    version: "0.1.0",
  });
  const packageBuildElapsedMs = performance.now() - packageStarted;
  assert.ok(
    packageBuildElapsedMs < packageBuildBudgetMs,
    `Indicator package build exceeded the ${packageBuildBudgetMs} ms budget: ${packageBuildElapsedMs}`,
  );

  console.log(
    JSON.stringify({
      component: "indicator-authoring-package",
      representativeCallsites: 53,
      transformIterations,
      historyOnlyAverageMs,
      composedAverageMs,
      transformOverheadMs,
      transformOverheadBudgetMs,
      packageBuildElapsedMs,
      packageBuildBudgetMs,
    }),
  );
} finally {
  await rm(authoringRoot, { recursive: true, force: true });
  await rm(outputDirectory, { recursive: true, force: true });
}
