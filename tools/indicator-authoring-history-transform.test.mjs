import assert from "node:assert/strict";
import test from "node:test";
import { transformIndicatorHistory } from "./indicator-authoring/history-transform.mjs";

test("lowers built-in bracket and at history access without boxing current values", () => {
  const source = `
const current = close + 10;
const indexed = close[1];
const method = close.at(2);
const explicit = history(close, 3);
const values = [1, 2, 3];
const ordinary = values.at(0);
`;
  const transformed = transformIndicatorHistory(source, "fixture.ts");
  assert.equal(transformed.changed, true);
  assert.match(
    transformed.code,
    /import \{ history as __ercHistory \} from "@erc-chart\/indicator-sdk";/u,
  );
  assert.match(transformed.code, /__ercHistory\(close, 1\)/u);
  assert.match(transformed.code, /__ercHistory\(close, 2\)/u);
  assert.match(transformed.code, /const current = close \+ 10;/u);
  assert.match(transformed.code, /history\(close, 3\)/u);
  assert.match(transformed.code, /values\.at\(0\)/u);
});

test("rejects invalid literal history offsets during authoring transform", () => {
  for (const source of ["close[-1]", "close.at(1.5)", "history(close, -2)"]) {
    assert.throws(
      () => transformIndicatorHistory(source, "invalid.ts"),
      /history offsets must be non-negative safe integers/u,
    );
  }
});
