import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

test("package declarations match the shipped runtime resolution graph", async () => {
  const sourceDirectory = await mkdtemp(
    path.join(import.meta.dirname, ".conditional-resolution-source-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-conditional-resolution-package-"),
  );
  try {
    await writeFile(
      path.join(sourceDirectory, "package.json"),
      JSON.stringify({
        type: "module",
        imports: {
          "#plot-branch": {
            node: "./node.ts",
            default: "./default.ts",
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(sourceDirectory, "default.ts"),
      `import { plot } from "@erc-chart/indicator-sdk";
export function renderBranch(value) {
  plot.line(value, { key: "default-plot", title: "Default plot" });
}
`,
      "utf8",
    );
    await writeFile(
      path.join(sourceDirectory, "node.ts"),
      `import { plot } from "@erc-chart/indicator-sdk";
export function renderBranch(value) {
  plot.line(value, { key: "node-plot", title: "Node plot" });
}
`,
      "utf8",
    );
    const source = path.join(sourceDirectory, "indicator.ts");
    await writeFile(
      source,
      `import { defineIndicator } from "@erc-chart/indicator-sdk";
import { renderBranch } from "#plot-branch";
export default defineIndicator(
  { id: "erc.indicator.conditional-resolution.main", name: "Conditional resolution" },
  ({ close }) => { renderBranch(close); },
);
`,
      "utf8",
    );

    const result = await buildIndicatorPackage({
      source,
      outputRoot: path.join(outputDirectory, "package"),
      id: "erc.indicator.conditional-resolution",
      version: "0.1.0",
    });
    const plots = result.manifest.capabilities.indicatorDefinition.plots;
    assert.equal(plots.length, 1);
    assert.equal(plots[0]?.outputKey, "default-plot");
    assert.equal(plots[0]?.label, "Default plot");

    const entryUrl = pathToFileURL(
      path.join(result.packageRoot, "dist", "index.js"),
    ).href;
    const entryModule = await import(`${entryUrl}?test=${Date.now()}`);
    const entryPlots = entryModule.default.definition.plots;
    assert.deepEqual(entryPlots, plots);
  } finally {
    await rm(sourceDirectory, { recursive: true, force: true });
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
