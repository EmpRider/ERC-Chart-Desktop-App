import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { format } from "prettier";

test("prints the pinned Prettier output for the conditional plot implementation", async () => {
  const source = await readFile(
    new URL("../packages/indicator-sdk/src/plot.ts", import.meta.url),
    "utf8",
  );
  const formatted = await format(source, {
    filepath: "packages/indicator-sdk/src/plot.ts",
  });
  console.error("FORMATTER_OUTPUT_BEGIN");
  console.error(formatted);
  console.error("FORMATTER_OUTPUT_END");
  assert.fail("formatter probe");
});
