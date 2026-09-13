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
