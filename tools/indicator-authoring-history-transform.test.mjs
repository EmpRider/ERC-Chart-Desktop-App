import assert from "node:assert/strict";
import test from "node:test";
import { transformIndicatorHistory } from "./indicator-authoring/history-transform.mjs";

test("lowers indicator source history access without boxing current values", () => {
  const source = `
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close, high: sourceHigh }) => {
  const current = close + 10;
  const indexed = close[1];
  const method = close.at(2);
  const aliased = sourceHigh[1];
  const explicit = history(close, 3);
  const values = [1, 2, 3];
  const ordinary = values.at(0);
});
`;
  const transformed = transformIndicatorHistory(source, "fixture.ts");
  assert.equal(transformed.changed, true);
  assert.match(
    transformed.code,
    /import \{ history as __ercHistory \} from "@erc-chart\/indicator-sdk";/u,
  );
  assert.match(transformed.code, /__ercHistory\(close, 1\)/u);
  assert.match(transformed.code, /__ercHistory\(close, 2\)/u);
  assert.match(transformed.code, /__ercHistory\(sourceHigh, 1\)/u);
  assert.match(transformed.code, /const current = close \+ 10;/u);
  assert.match(transformed.code, /history\(close, 3\)/u);
  assert.match(transformed.code, /values\.at\(0\)/u);
});

test("does not rewrite same-named locals outside or inside shadowing scopes", () => {
  const source = `
const close = [1, 2, 3];
const outside = close[1];
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close: sourceClose }) => {
  const historical = sourceClose[1];
  const nested = () => {
    const sourceClose = [4, 5, 6];
    return sourceClose[1];
  };
  return nested() + historical;
});
`;
  const transformed = transformIndicatorHistory(source, "shadowed.ts");
  assert.equal(transformed.changed, true);
  assert.match(transformed.code, /const outside = close\[1\];/u);
  assert.match(transformed.code, /__ercHistory\(sourceClose, 1\)/u);
  assert.match(transformed.code, /return sourceClose\[1\];/u);
});

test("does not validate lexically shadowed history helpers", () => {
  const source = `
import { defineIndicator, history } from "@erc-chart/indicator-sdk";
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const historical = close[1];
  if (historical) {
    function history(value, offset) {
      return value + offset;
    }
    return history(close, -2);
  }
  return historical;
});
`;
  const transformed = transformIndicatorHistory(source, "shadowed-history.ts");
  assert.equal(transformed.changed, true);
  assert.match(transformed.code, /__ercHistory\(close, 1\)/u);
  assert.match(transformed.code, /history\(close, -2\)/u);
});

test("preserves switch-case lexical shadowing for source bindings", () => {
  const source = `
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const historical = close[1];
  switch (historical) {
    case 1:
      const close = [10, 20, 30];
      return close[1];
    default:
      return historical;
  }
});
`;
  const transformed = transformIndicatorHistory(source, "switch-shadowed.ts");
  assert.equal(transformed.changed, true);
  assert.match(
    transformed.code,
    /const historical = __ercHistory\(close, 1\);/u,
  );
  assert.match(transformed.code, /return close\[1\];/u);
});

test("rejects invalid literal history offsets during authoring transform", () => {
  for (const expression of [
    "close[-1]",
    "close.at(1.5)",
    "history(close, -2)",
  ]) {
    const source = `import { defineIndicator, history, plot } from "@erc-chart/indicator-sdk";\ndefineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => { plot.line(${expression}); });`;
    assert.throws(
      () => transformIndicatorHistory(source, "invalid.ts"),
      /history offsets must be non-negative safe integers/u,
    );
  }
});
