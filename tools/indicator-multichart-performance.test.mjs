import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);

test("test:performance includes the authored multi-chart live-update gate", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("package.json", repositoryRoot), "utf8"),
  );

  assert.match(
    packageJson.scripts["test:performance"],
    /(?:^|&&\s*)node tools\/indicator-multichart-performance\.mjs(?:\s*&&|$)/,
    "ECDD-229 requires the authored multi-chart live-update benchmark to run in the enforced test:performance gate",
  );
});

test("multi-chart performance gate exercises production chart and worker orchestration", async () => {
  const benchmark = await readFile(
    new URL("tools/indicator-multichart-performance.mjs", repositoryRoot),
    "utf8",
  );

  assert.match(
    benchmark,
    /reconcilePluginIndicators/,
    "ECDD-229 must exercise production chart-scoped plugin reconciliation instead of raw indicator instances",
  );
  assert.match(
    benchmark,
    /createBrowserIndicatorRuntime/,
    "ECDD-229 must exercise production browser-runtime worker supervision",
  );
  assert.match(
    benchmark,
    /node:worker_threads/,
    "ECDD-229 must execute the production worker entry through isolated worker instances",
  );
});
