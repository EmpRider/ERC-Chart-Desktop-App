import assert from "node:assert/strict";
import test from "node:test";
import { contractVersion } from "../dist/index.js";

test("accepts a positive integer contract version", () => {
  assert.equal(contractVersion(1), 1);
});

for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  test(`rejects invalid contract version ${invalid}`, () => {
    assert.throws(
      () => contractVersion(invalid),
      new RangeError("Contract version must be a positive safe integer."),
    );
  });
}
