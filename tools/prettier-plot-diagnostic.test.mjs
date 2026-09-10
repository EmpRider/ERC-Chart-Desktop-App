import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { format } from "prettier";

test("prints canonical plot formatting", async () => {
  const source = await readFile(
    new URL("../packages/indicator-sdk/src/plot.ts", import.meta.url),
    "utf8",
  );
  const formatted = await format(source, { filepath: "plot.ts" });
  assert.fail(`CANONICAL_PLOT_START\n${formatted}CANONICAL_PLOT_END`);
});
