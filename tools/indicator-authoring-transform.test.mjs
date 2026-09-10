import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

async function loadTransform() {
  try {
    return await import("./indicator-authoring-transform.mjs");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return undefined;
    throw error;
  }
}

function cleanup(t, directory) {
  t.after(() => rm(directory, { recursive: true, force: true }));
}

test("composes call-site identity before source-history lowering", async () => {
  const module = await loadTransform();
  assert.equal(
    typeof module?.transformIndicatorAuthoring,
    "function",
    "ECDD-219 requires the composed authoring transform",
  );
  const source = `
import { defineIndicator, plot, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const prior = close[1];
  const trend = ta.ema(prior, 14);
  plot.line(trend, { key: "trend" });
});
`;
  const result = module.transformIndicatorAuthoring(source, {
    fileName: "src/index.ts",
    sourceFileId: "src/index.ts",
  });

  assert.equal(result.changed, true);
  assert.deepEqual(
    result.callsites.map((value) => value.callee),
    ["ta.ema", "plot.line"],
  );
  assert.equal(result.callsites[0]?.source.line, 5);
  assert.doesNotMatch(result.code, /\bclose\[1\]/u);
  assert.match(result.code, /__ercHistory\(close, 1\)/u);
  assert.match(result.code, /__ercCallsite:\s*"v2"/u);
});

test("package build applies the composed authoring transform", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-callsite-source-"));
  const output = await mkdtemp(path.join(os.tmpdir(), "erc-callsite-output-"));
  cleanup(t, root);
  cleanup(t, output);
  await writeFile(
    path.join(root, "package.json"),
    '{"name":"callsite-fixture","private":true,"type":"module"}\n',
    "utf8",
  );
  const source = path.join(root, "index.ts");
  await writeFile(
    source,
    `
import { defineIndicator, plot, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator(
  { id: "erc.indicator.callsite-build.main", name: "Callsite build" },
  ({ close }) => {
    const trend = ta.ema(close[1], 14);
    plot.line(trend, { key: "trend" });
  },
);
`,
    "utf8",
  );

  const result = await buildIndicatorPackage({
    source,
    outputRoot: path.join(output, "package"),
    id: "erc.indicator.callsite-build",
    version: "0.1.0",
  });
  const entry = await readFile(
    path.join(result.packageRoot, result.manifest.entry),
    "utf8",
  );
  assert.doesNotMatch(entry, /\bclose\[1\]/u);
  assert.match(entry, /__ercCallsite:\s*["']v2["']/u);
  assert.match(entry, /erc-v2-ta-[a-f0-9]{24}/u);
  assert.match(entry, /erc-v2-plot-[a-f0-9]{24}/u);
});
