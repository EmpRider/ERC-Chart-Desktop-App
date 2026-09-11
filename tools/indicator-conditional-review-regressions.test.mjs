import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

async function buildPackage(sourceText, id) {
  const sourceDirectory = await mkdtemp(
    path.join(import.meta.dirname, ".conditional-review-source-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-conditional-review-package-"),
  );
  try {
    const source = path.join(sourceDirectory, "indicator.ts");
    await writeFile(source, sourceText, "utf8");
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
    callee: "plot.line",
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
