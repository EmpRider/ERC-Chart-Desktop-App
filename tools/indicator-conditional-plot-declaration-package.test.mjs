import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

test("compiler rejects dynamic declaration metadata for a conditional plot", async () => {
  const sourceDirectory = await mkdtemp(
    path.join(import.meta.dirname, ".conditional-plot-declaration-source-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-conditional-plot-declaration-package-"),
  );
  try {
    const source = path.join(sourceDirectory, "indicator.ts");
    await writeFile(
      source,
      `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

function latePlot(value) {
  plot.line(value, {
    key: "late",
    title: value > 20 ? "Late high" : "Late low",
    style: "dotted",
  });
}

export default defineIndicator(
  { id: "erc.indicator.dynamic-late-plot.main", name: "Dynamic late plot" },
  ({ close }) => {
    if (close > 15) latePlot(close);
  },
);
`,
      "utf8",
    );

    await assert.rejects(
      buildIndicatorPackage({
        source,
        outputRoot: path.join(outputDirectory, "package"),
        id: "erc.indicator.dynamic-late-plot",
        version: "0.1.0",
      }),
      /Plot declaration option "title" must use a static string literal/u,
    );
  } finally {
    await rm(sourceDirectory, { recursive: true, force: true });
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
