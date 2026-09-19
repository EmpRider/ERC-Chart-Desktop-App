import assert from "node:assert/strict";
import test from "node:test";
import { transformIndicatorHistory } from "./indicator-authoring/history-transform.mjs";

test("lowers indicator source history access without boxing current values", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
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

test("lowers history access for derived series locals without touching arrays", () => {
  const source = `
import { defineIndicator, ta } from "@erc-chart/indicator-sdk";
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const fast = ta.ema(close, 9);
  const previousFast = fast[1];
  const doubled = fast * 2;
  const previousDoubled = doubled[2];
  const values = [10, 20, 30];
  const ordinary = values[1];
  return previousFast + previousDoubled + ordinary;
});
`;
  const transformed = transformIndicatorHistory(source, "derived-series.ts");

  assert.equal(transformed.changed, true);
  assert.match(transformed.code, /__ercHistory\(fast, 1\)/u);
  assert.match(transformed.code, /__ercHistory\(doubled, 2\)/u);
  assert.match(transformed.code, /const ordinary = values\[1\];/u);
});

test("keeps values derived from history access series-capable", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const bracketPrior = close[1];
  const bracketOlder = bracketPrior[1];
  const methodPrior = close.at(1);
  const methodOlder = methodPrior.at(1);
  return bracketOlder + methodOlder;
});
`;
  const transformed = transformIndicatorHistory(
    source,
    "derived-history-series.ts",
  );

  assert.equal(transformed.changed, true);
  assert.match(transformed.code, /__ercHistory\(bracketPrior, 1\)/u);
  assert.match(transformed.code, /__ercHistory\(methodPrior, 1\)/u);
});

test("keeps scalar conditionals series-capable when their condition depends on series", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close, open }) => {
  const direction = close > open ? 1 : -1;
  const previousDirection = direction[1];
  return previousDirection;
});
`;
  const transformed = transformIndicatorHistory(
    source,
    "scalar-conditional.ts",
  );

  assert.equal(transformed.changed, true);
  assert.match(transformed.code, /__ercHistory\(direction, 1\)/u);
});

test("preserves element indexing for conditional array values", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close, open }) => {
  const values = close > open ? [10, 20, 30] : [40, 50, 60];
  const ordinary = values[1];
  return ordinary;
});
`;
  const transformed = transformIndicatorHistory(source, "array-conditional.ts");

  assert.equal(transformed.changed, false);
  assert.equal(transformed.code, source);
});

test("preserves element indexing for conditional named array values", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close, open }) => {
  const risingValues = [10, 20, 30] satisfies number[];
  const fallingValues = [40, 50, 60] satisfies number[];
  const values = close > open ? risingValues : fallingValues;
  const ordinary = values[1];
  return ordinary;
});
`;
  const transformed = transformIndicatorHistory(
    source,
    "named-array-conditional.ts",
  );

  assert.equal(transformed.changed, false);
  assert.equal(transformed.code, source);
});

test("preserves element indexing for conditional local helper array values", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
function risingValues() {
  return [10, 20, 30];
}
function fallingValues() {
  return [40, 50, 60];
}
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close, open }) => {
  const values = close > open ? risingValues() : fallingValues();
  const ordinary = values[1];
  return ordinary;
});
`;
  const transformed = transformIndicatorHistory(
    source,
    "helper-array-conditional.ts",
  );

  assert.equal(transformed.changed, false);
  assert.equal(transformed.code, source);
});

test("keeps mixed-shape local helper returns out of array classification", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
function maybeValues(useArray) {
  if (useArray) return [10, 20, 30];
  return 40;
}
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close, open }) => {
  const values = close > open ? maybeValues(true) : maybeValues(false);
  const previous = values[1];
  return previous;
});
`;
  const transformed = transformIndicatorHistory(
    source,
    "mixed-helper-return-shapes.ts",
  );

  assert.equal(transformed.changed, true);
  assert.match(transformed.code, /__ercHistory\(values, 1\)/u);
});

test("lowers history access for input source and explicit history derived locals", () => {
  const source = `
import { defineIndicator, history, input } from "@erc-chart/indicator-sdk";
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const selected = input.source(close, "Source");
  const previousSelected = selected[1];
  const priorClose = history(close, 1);
  const doubledPrior = priorClose * 2;
  const previousDoubledPrior = doubledPrior[1];
  return previousSelected + previousDoubledPrior;
});
`;
  const transformed = transformIndicatorHistory(
    source,
    "input-history-series.ts",
  );

  assert.equal(transformed.changed, true);
  assert.match(transformed.code, /__ercHistory\(selected, 1\)/u);
  assert.match(transformed.code, /__ercHistory\(doubledPrior, 1\)/u);
});

test("resolves SDK defineIndicator aliases before lowering source history", () => {
  const source = `
import { defineIndicator as define } from "@erc-chart/indicator-sdk";
define({ id: "fixture", name: "Fixture" }, ({ close }) => {
  return close[1];
});
`;
  const transformed = transformIndicatorHistory(source, "aliased-define.ts");
  assert.equal(transformed.changed, true);
  assert.match(transformed.code, /__ercHistory\(close, 1\)/u);
});

test("does not rewrite callbacks owned by an unrelated defineIndicator binding", () => {
  const source = `
function defineIndicator(_options, calculate) {
  return calculate({ close: [10, 20, 30] });
}
defineIndicator({ id: "fixture" }, ({ close }) => close[1]);
`;
  const transformed = transformIndicatorHistory(source, "unrelated-define.ts");
  assert.equal(transformed.changed, false);
  assert.equal(transformed.code, source);
});

test("does not rewrite a lexically shadowed SDK defineIndicator binding", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
{
  const defineIndicator = (_options, calculate) => calculate({ close: [10, 20, 30] });
  defineIndicator({ id: "fixture" }, ({ close }) => close[1]);
}
`;
  const transformed = transformIndicatorHistory(source, "shadowed-define.ts");
  assert.equal(transformed.changed, false);
  assert.equal(transformed.code, source);
});

test("does not rewrite same-named locals outside or inside shadowing scopes", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
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
import { defineIndicator } from "@erc-chart/indicator-sdk";
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

test("preserves nested var source shadowing", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const historical = close[1];
  const nested = () => {
    const local = close[1];
    if (historical) {
      var close = [10, 20, 30];
    }
    return local + close[1];
  };
  return historical + nested();
});
`;
  const transformed = transformIndicatorHistory(source, "var-source.ts");
  assert.equal(transformed.changed, true);
  assert.match(
    transformed.code,
    /const historical = __ercHistory\(close, 1\);/u,
  );
  assert.match(transformed.code, /const local = close\[1\];/u);
  assert.match(transformed.code, /return local \+ close\[1\];/u);
});

test("preserves nested var history shadowing", () => {
  const source = `
import { defineIndicator, history } from "@erc-chart/indicator-sdk";
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const historical = close[1];
  const nested = () => {
    const local = history(close, -2);
    for (let index = 0; index < 1; index += 1) {
      var history = (value, offset) => value + offset;
    }
    return local;
  };
  return historical + nested();
});
`;
  const transformed = transformIndicatorHistory(source, "var-history.ts");
  assert.equal(transformed.changed, true);
  assert.match(transformed.code, /history\(close, -2\)/u);
});

test("preserves nested var defineIndicator shadowing", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
function wrapper() {
  defineIndicator({ id: "local" }, ({ close }) => close[1]);
  for (let index = 0; index < 1; index += 1) {
    var defineIndicator = (_options, calculate) => calculate({ close: [10, 20, 30] });
  }
}
wrapper();
`;
  const transformed = transformIndicatorHistory(source, "var-define.ts");
  assert.equal(transformed.changed, false);
  assert.equal(transformed.code, source);
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

test("lowers history access for series-derived local helper returns", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
function range(high, low) {
  return high - low;
}
defineIndicator({ id: "fixture", name: "Fixture" }, ({ high, low }) => {
  const spread = range(high, low);
  const prior = spread[1];
  return prior;
});
`;
  const transformed = transformIndicatorHistory(
    source,
    "local-helper-series.ts",
  );

  assert.equal(transformed.changed, true);
  assert.match(transformed.code, /__ercHistory\(spread, 1\)/u);
});

test("lowers history access when an omitted helper argument defaults to a series", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const selected = close;
  function value(source = selected) {
    return source;
  }
  const derived = value();
  const prior = derived[1];
  return prior;
});
`;
  const transformed = transformIndicatorHistory(
    source,
    "local-helper-default-series.ts",
  );

  assert.equal(transformed.changed, true);
  assert.match(transformed.code, /__ercHistory\(derived, 1\)/u);
});

test("resolves omitted helper defaults in the helper declaration scope", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
const close = 5;
function value(source = close) {
  return source;
}
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const derived = value();
  const prior = derived[1];
  return prior;
});
`;
  const transformed = transformIndicatorHistory(
    source,
    "local-helper-default-shadow.ts",
  );

  assert.equal(transformed.changed, false);
  assert.equal(transformed.code, source);
});

test("resolves omitted helper defaults through the helper declaration closure", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const selected = close;
  function value(source = selected) {
    return source;
  }
  function nested() {
    const selected = 5;
    return value();
  }
  const derived = nested();
  const prior = derived[1];
  return prior;
});
`;
  const transformed = transformIndicatorHistory(
    source,
    "local-helper-default-closure.ts",
  );

  assert.equal(transformed.changed, true);
  assert.match(transformed.code, /__ercHistory\(derived, 1\)/u);
});

test("does not classify scalar local helper returns as series-derived", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
function constant(_value) {
  return 5;
}
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const scalar = constant(close);
  const ordinary = [scalar, 10];
  return ordinary[1];
});
`;
  const transformed = transformIndicatorHistory(
    source,
    "local-helper-scalar.ts",
  );

  assert.equal(transformed.changed, false);
  assert.equal(transformed.code, source);
});

test("keeps helper fallthrough out of array classification", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
function maybeValues(useArray) {
  if (useArray) return [10, 20, 30];
}
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close, open }) => {
  const values = close > open ? maybeValues(true) : maybeValues(false);
  const previous = values[1];
  return previous;
});
`;
  const transformed = transformIndicatorHistory(
    source,
    "helper-array-fallthrough.ts",
  );
  assert.equal(transformed.changed, true);
  assert.match(transformed.code, /__ercHistory\(values, 1\)/u);
});

test("maps destructured array parameters by element value", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
function firstValue([first]) {
  return first;
}
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close, open }) => {
  const value = close > open ? firstValue([10, 20]) : firstValue([30, 40]);
  const previous = value[1];
  return previous;
});
`;
  const transformed = transformIndicatorHistory(
    source,
    "helper-array-destructuring.ts",
  );
  assert.equal(transformed.changed, true);
  assert.match(transformed.code, /__ercHistory\(value, 1\)/u);
});

test("treats identifier rest parameters as array-valued", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
function collectValues(...values) {
  return values;
}
defineIndicator({ id: "fixture", name: "Fixture" }, ({ close, open }) => {
  const values = close > open ? collectValues(10, 20, 30) : collectValues(40, 50, 60);
  const ordinary = values[1];
  return ordinary;
});
`;
  const transformed = transformIndicatorHistory(
    source,
    "helper-array-rest-parameter.ts",
  );
  assert.equal(transformed.changed, false);
  assert.equal(transformed.code, source);
});
