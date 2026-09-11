import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as prettier from "prettier";

test("plot formatter probe", async () => {
  const source = await readFile(
    new URL("../src/plot.ts", import.meta.url),
    "utf8",
  );
  const formatted = await prettier.format(source, { parser: "typescript" });
  if (source === formatted) return;
  console.log("PRETTIER_FORMATTED_START");
  console.log(formatted);
  console.log("PRETTIER_FORMATTED_END");
  assert.fail("plot.ts needs Prettier output applied");
});
