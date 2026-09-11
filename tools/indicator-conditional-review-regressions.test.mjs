import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";
import { transformIndicatorCallsites } from "./indicator-authoring/callsite-transform.mjs";

async function buildPackage(sourceText, id, additionalFiles = {}) {
  const sourceDirectory = await mkdtemp(
    path.join(import.meta.dirname, ".conditional-review-source-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-conditional-review-package-"),
  );
  try {
    const source = path.join(sourceDirectory, "indicator.ts");
    await writeFile(source, sourceText, "utf8");
    for (const [fileName, contents] of Object.entries(additionalFiles))
      await writeFile(path.join(sourceDirectory, fileName), contents, "utf8");
    return await buildIndicatorPackage({
      source,
      outputRoot: path.join(outputDirectory, "package"),
      id,
      version: "0.1.0",
    });
  } finally {
    await rm(sourceDirectory, { recursive: true, force: true });
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

test("compiler rejects method and accessor plot declaration metadata", async () => {
  for (const declaration of [
    `title() { return "Dynamic"; }`,
    `get title() { return "Dynamic"; }`,
  ]) {
    await assert.rejects(
      () =>
        buildPackage(
          `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
export default defineIndicator(
  { id: "erc.indicator.static-plot-member.main", name: "Static plot member" },
  ({ close }) => {
    plot.line(close, { ${declaration} });
  },
);
`,
          "erc.indicator.static-plot-member",
        ),
      /Plot declaration option "title" must use a static literal\./u,
    );
  }
});

test("a positional plot cannot extend 128 predeclared compiler plots", async () => {
  const declarations = Array.from({ length: 128 }, (_, index) => ({
    id: `erc-v2-plot-${index.toString(16).padStart(24, "0")}`,
    kind: "line",
    outputKey: `compiled_${index}`,
    label: `Compiled ${index + 1}`,
    keyExplicit: true,
    titleExplicit: true,
  }));
  const result = await build({
    stdin: {
      contents: `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
export default defineIndicator(
  { id: "erc.indicator.plot-capacity.main", name: "Plot capacity" },
  () => { plot.line(1, { key: "positional", title: "Positional" }); },
);
`,
      resolveDir: process.cwd(),
      sourcefile: "plot-capacity.mjs",
      loader: "js",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node24",
    define: {
      __ERC_INDICATOR_COMPILED__: "false",
      __ERC_INDICATOR_PLOT_DECLARATIONS__: JSON.stringify(declarations),
    },
  });
  const source = result.outputFiles[0]?.text;
  assert.equal(typeof source, "string");
  await assert.rejects(
    () =>
      import(
        `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
      ),
    /An indicator may declare at most 128 plots\./u,
  );
});

test("positional replay resolves definitions appended after compiler plots", async () => {
  const declarations = [
    {
      id: "erc-v2-plot-000000000000000000000001",
      kind: "line",
      outputKey: "compiled",
      label: "Compiled",
      keyExplicit: true,
      titleExplicit: true,
    },
  ];
  const result = await build({
    stdin: {
      contents: `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
export default defineIndicator(
  { id: "erc.indicator.positional-replay.main", name: "Positional replay" },
  () => { plot.line(7, { key: "positional", title: "Positional" }); },
);
`,
      resolveDir: process.cwd(),
      sourcefile: "positional-replay.mjs",
      loader: "js",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node24",
    define: {
      __ERC_INDICATOR_COMPILED__: "false",
      __ERC_INDICATOR_PLOT_DECLARATIONS__: JSON.stringify(declarations),
    },
  });
  const source = result.outputFiles[0]?.text;
  assert.equal(typeof source, "string");
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  const instance = module.default.createInstance(
    {},
    { instrumentId: "TEST", timeframeId: "1m" },
  );
  instance.onHistory([
    {
      instrumentId: "TEST",
      timeframeId: "1m",
      openTimeMs: 0,
      open: 7,
      high: 7,
      low: 7,
      close: 7,
      volume: 1,
    },
    {
      instrumentId: "TEST",
      timeframeId: "1m",
      openTimeMs: 60_000,
      open: 7,
      high: 7,
      low: 7,
      close: 7,
      volume: 1,
    },
  ]);
  assert.equal(instance.snapshot().points[0]?.values.positional, 7);
  instance.dispose();
});

test("tree-shaken plot callsites do not become compiler declarations", async () => {
  const result = await buildPackage(
    `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
import { liveValue } from "./helper.ts";
export default defineIndicator(
  { id: "erc.indicator.reachable-plots.main", name: "Reachable plots" },
  () => { plot.line(liveValue, { title: "Live" }); },
);
`,
    "erc.indicator.reachable-plots",
    {
      "helper.ts": `import { plot } from "@erc-chart/indicator-sdk";
export const liveValue = 1;
export function treeShakenPlot() {
  plot.line(2, { title: "Dead" });
}
`,
    },
  );
  const plots = result.manifest.capabilities.indicatorDefinition.plots;
  assert.equal(plots.length, 1);
  assert.equal(plots[0]?.label, "Live");
});

test("compiler plot declarations exclude runtime-only callsite metadata", () => {
  const result = transformIndicatorCallsites(
    `import { plot } from "@erc-chart/indicator-sdk";
plot.line(1, { title: "Line" });
`,
    { fileName: "indicator.ts", sourceFileId: "indicator.ts" },
  );
  assert.equal(result.plotDeclarations.length, 1);
  assert.equal(Object.hasOwn(result.plotDeclarations[0], "callee"), false);
});
