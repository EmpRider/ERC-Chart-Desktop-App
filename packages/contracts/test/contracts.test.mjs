import assert from "node:assert/strict";
import test from "node:test";
import { contractVersion } from "../dist/index.js";

test("accepts positive safe integer contract versions", () => {
  assert.equal(contractVersion(1), 1);
  assert.equal(
    contractVersion(Number.MAX_SAFE_INTEGER),
    Number.MAX_SAFE_INTEGER,
  );
});

for (const invalid of [
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
]) {
  test(`rejects invalid contract version ${invalid}`, () => {
    assert.throws(
      () => contractVersion(invalid),
      new RangeError("Contract version must be a positive safe integer."),
    );
  });
}
