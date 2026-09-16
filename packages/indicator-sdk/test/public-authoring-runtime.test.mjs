import assert from "node:assert/strict";
import test from "node:test";
import { defineIndicator } from "../dist/index.js";

test("public SDK runtime does not expose the hidden callback constructor", () => {
  assert.throws(
    () =>
      defineIndicator(
        { id: "erc.indicator.public-runtime.main", name: "Public runtime" },
        () => undefined,
      ),
    /indicator source must be compiled/u,
  );
});
