import assert from "node:assert/strict";
import test from "node:test";

async function loadTransform() {
  try {
    const module = await import("./indicator-authoring/callsite-transform.mjs");
    return module.transformIndicatorCallsites;
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return undefined;
    throw error;
  }
}

async function transform(source, file = "src/indicator.ts") {
  const transformIndicatorCallsites = await loadTransform();
  assert.equal(
    typeof transformIndicatorCallsites,
    "function",
    "ECDD-219 requires the call-site transform",
  );
  return transformIndicatorCallsites(source, {
    fileName: file,
    sourceFileId: file,
  });
}

function callsiteMap(result) {
  return new Map(result.callsites.map((value) => [value.callee, value.id]));
}

test("injects hidden identities for every in-scope authoring family", async () => {
  const result = await transform(`
import { defineIndicator, input, plot, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator(
  { id: "erc.indicator.callsite.main", name: "Callsite" },
  ({ close }) => {
    const length = input.int(14, { title: "Length" });
    const average = ta.ema(close, length);
    if (average > close) {
      plot.shape(average, { key: "shape" });
    }
    plot.hline(50, { key: "threshold" });
    plot.box({
      id: "legacy-box",
      startTimeMs: 0,
      endTimeMs: 1,
      top: average + 1,
      bottom: average,
      color: "#ffffff"
    });
    signal(average > close, "long");
  },
);
`);

  assert.equal(result.changed, true);
  assert.deepEqual(
    result.callsites.map((value) => [value.kind, value.callee]),
    [
      ["input", "input.int"],
      ["ta", "ta.ema"],
      ["plot", "plot.shape"],
      ["plot", "plot.hline"],
      ["drawing", "plot.box"],
      ["signal", "signal"],
    ],
  );
  assert.match(result.code, /__ercCallsite:\s*"v2"/u);
  assert.doesNotMatch(
    result.code,
    /from\s+["']@erc-chart\/indicator-sdk\/internal/u,
  );
  assert.match(result.code, /ta\.ema\([^;]*__ercCallsite_/u);
  assert.match(result.code, /plot\.shape\([^;]*__ercCallsite_/u);
});

test("reserves compiler-only argument slots without consuming optional author arguments", async () => {
  const result = await transform(`
import { input, plot, signal, ta } from "@erc-chart/indicator-sdk";
const period = input.int(14);
const trend = ta.ema(14);
plot.line(trend);
signal(trend > 0, "long");
void period;
`);

  assert.match(
    result.code,
    /input\.int\(14, undefined, undefined, __ercCallsite_\d+\)/u,
  );
  assert.match(result.code, /ta\.ema\(14, undefined, __ercCallsite_\d+\)/u);
  assert.match(
    result.code,
    /plot\.line\(trend, undefined, __ercCallsite_\d+\)/u,
  );
  assert.match(
    result.code,
    /signal\(trend > 0, "long", undefined, __ercCallsite_\d+\)/u,
  );
});

test("canonicalizes length-first TA overloads before appending hidden callsite identity", async () => {
  const result = await transform(`
import { defineIndicator, input, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ open, close }) => {
  const length = input.int(14, "Length");
  const source = input.source(close, "Source");
  const direct = ta.ema(length, open);
  const higher = ta.ema(length, open, "1h");
  const selected = ta.ema(length, source);
  const strength = ta.rsi(length, open);
  void direct;
  void higher;
  void selected;
  void strength;
});
`);

  assert.match(result.code, /ta\.ema\(open, length, __ercCallsite_\d+\)/u);
  assert.match(
    result.code,
    /ta\.ema\(open, length, "1h", __ercCallsite_\d+\)/u,
  );
  assert.match(result.code, /ta\.ema\(source, length, __ercCallsite_\d+\)/u);
  assert.match(result.code, /ta\.rsi\(open, length, __ercCallsite_\d+\)/u);
  const higher = result.callsites.find(
    (callsite) =>
      callsite.callee === "ta.ema" && callsite.seriesSource === "open",
  );
  assert.ok(higher);
});

test("canonicalizes wrapped TA lengths and history-indexed series", async () => {
  const result = await transform(`
import { defineIndicator, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ open, close }) => {
  const wrappedLength = 14 as const;
  const wrapped = ta.ema(wrappedLength, open);
  const historical = ta.ema(14, close[1]);
  void wrapped;
  void historical;
});
`);

  assert.match(
    result.code,
    /ta\.ema\(open, wrappedLength, __ercCallsite_\d+\)/u,
  );
  assert.match(result.code, /ta\.ema\(close\[1\], 14, __ercCallsite_\d+\)/u);
});

test("preserves titled input options before the compiler-only callsite slot", async () => {
  const result = await transform(`
import { input } from "@erc-chart/indicator-sdk";
const period = input.int(14, "Period", { min: 1, max: 500, group: "ATR Rope" });
void period;
`);

  assert.match(
    result.code,
    /input\.int\(14, "Period", \{[\s\S]*?min: 1[\s\S]*?max: 500[\s\S]*?group: "ATR Rope"[\s\S]*?\}, __ercCallsite_\d+\)/u,
  );
});

test("rejects input declarations inside statically repeated loops", async () => {
  const fixtures = [
    `for (const length of [9, 14]) { input.int(length, "Length"); }`,
    `for (const index in { a: 1, b: 2 }) { input.int(Number(index), "Length"); }`,
    `for (let index = 0; index < 2; index += 1) { input.int(index, "Length"); }`,
    `let index = 0; while (index < 2) { input.int(index++, "Length"); }`,
    `let index = 0; do { input.int(index++, "Length"); } while (index < 2);`,
  ];
  for (const [index, statement] of fixtures.entries()) {
    await assert.rejects(
      () =>
        transform(
          `import { input } from "@erc-chart/indicator-sdk";\n${statement}\n`,
          `src/loop-input-${index}.ts`,
        ),
      /input declarations cannot execute inside loops/u,
    );
  }

  await assert.rejects(
    () =>
      transform(
        `import { input } from "@erc-chart/indicator-sdk";
for (const length of [9, 14]) {
  input.int(length, "Length");
}
`,
        "src/loop-input.ts",
      ),
    /src\/loop-input\.ts:3:3 input declarations cannot execute inside loops/u,
  );
});

test("rejects input declarations inside repeated callbacks", async () => {
  const fixtures = [
    `[9, 14].forEach(() => { input.int(14, "Length"); });`,
    `[9, 14].map(() => input.int(14, "Length"));`,
    `[9, 14].filter(() => input.bool(true, "Enabled"));`,
    `[9, 14].reduce((total) => total + input.int(14, "Length"), 0);`,
    `[9, 14].sort(() => input.int(14, "Length"));`,
    `[9, 14].toSorted(() => input.int(14, "Length"));`,
  ];
  for (const [index, statement] of fixtures.entries()) {
    await assert.rejects(
      () =>
        transform(
          `import { input } from "@erc-chart/indicator-sdk";\n${statement}\n`,
          `src/repeated-callback-input-${index}.ts`,
        ),
      /input declarations cannot execute inside repeated callbacks/u,
    );
  }

  await assert.rejects(
    () =>
      transform(
        `import { input } from "@erc-chart/indicator-sdk";
[9, 14].forEach(() => {
  input.int(14, "Length");
});
`,
        "src/repeated-callback-input.ts",
      ),
    /src\/repeated-callback-input\.ts:2:17 input declarations cannot execute inside repeated callbacks/u,
  );
});

test("rejects input helpers invoked by repeated callbacks", async () => {
  const helperSource = `
import { input } from "@erc-chart/indicator-sdk";
function readLength() {
  return input.int(14, "Length");
}
`;

  await assert.rejects(
    () =>
      transform(`${helperSource}
[9, 14].forEach(() => readLength());
`),
    /input declarations cannot execute inside repeated callbacks/u,
  );

  await assert.rejects(
    () =>
      transform(`${helperSource}
[9, 14].forEach(readLength);
`),
    /input declarations cannot execute inside repeated callbacks/u,
  );
});

test("allows a single-execution IIFE to declare an input", async () => {
  const result = await transform(`
import { input } from "@erc-chart/indicator-sdk";
const length = (() => input.int(14, "Length"))();
void length;
`);

  assert.deepEqual(
    result.callsites.map(({ kind, callee }) => [kind, callee]),
    [["input", "input.int"]],
  );
});

test("allows a statically single-execution helper to declare an input", async () => {
  const result = await transform(`
import { input } from "@erc-chart/indicator-sdk";
function readLength() {
  return input.int(14, "Length");
}
const length = readLength();
void length;
`);

  assert.deepEqual(
    result.callsites.map(({ kind, callee }) => [kind, callee]),
    [["input", "input.int"]],
  );
});

test("rejects an input helper that is reachable more than once", async () => {
  await assert.rejects(
    () =>
      transform(`
import { input } from "@erc-chart/indicator-sdk";
function readLength() {
  return input.int(14, "Length");
}
const first = readLength();
const second = readLength();
void first;
void second;
`),
    /input helpers cannot execute more than once/u,
  );
});

test("rejects an input helper that is reachable more than once from the indicator callback", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, input } from "@erc-chart/indicator-sdk";
function readLength() {
  return input.int(14, "Length");
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, () => {
  const first = readLength();
  const second = readLength();
  void first;
  void second;
});
`),
    /input helpers cannot execute more than once/u,
  );
});

test("allows an input helper once per mutually exclusive indicator callback branch", async () => {
  const result = await transform(`
import { defineIndicator, input } from "@erc-chart/indicator-sdk";
function readLength() {
  return input.int(14, "Length");
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, () => {
  let length;
  if (close > 10) {
    length = readLength();
  } else {
    length = readLength();
  }
  void length;
});
`);

  assert.deepEqual(
    result.callsites.map(({ kind, callee }) => [kind, callee]),
    [["input", "input.int"]],
  );
});

test("rejects helpers containing inputs when the helper executes from a loop", async () => {
  await assert.rejects(
    () =>
      transform(`
import { input } from "@erc-chart/indicator-sdk";
function readLength() {
  return input.int(14, "Length");
}
for (let index = 0; index < 2; index += 1) {
  readLength();
}
`),
    /input declarations cannot execute inside loops/u,
  );
});

test("rejects recursive helpers that can repeat input declarations", async () => {
  await assert.rejects(
    () =>
      transform(`
import { input } from "@erc-chart/indicator-sdk";
function readLength(remaining) {
  const length = input.int(14, "Length");
  return remaining > 0 ? readLength(remaining - 1) : length;
}
const length = readLength(2);
void length;
`),
    /input declarations cannot execute through recursion/u,
  );
});

test("rejects mutually recursive input helper paths", async () => {
  await assert.rejects(
    () =>
      transform(`
import { input } from "@erc-chart/indicator-sdk";
function first(remaining) {
  const length = input.int(14, "Length");
  return remaining > 0 ? second(remaining - 1) : length;
}
function second(remaining) {
  return first(remaining);
}
const length = first(2);
void length;
`),
    /input declarations cannot execute through recursion/u,
  );
});

test("keeps identities stable across unrelated insertion and declaration reordering", async () => {
  const before = await transform(`
import { defineIndicator, input, plot, ta } from "@erc-chart/indicator-sdk";
const helperA = 1;
const helperB = 2;
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const period = input.int(14, { title: "Period" });
  const trend = ta.ema(close, period);
  plot.line(trend, { key: "trend" });
  void helperA;
  void helperB;
});
`);
  const after = await transform(`
import { defineIndicator, input, plot, ta } from "@erc-chart/indicator-sdk";
const helperB = 2;
const unrelated = 42;
const helperA = 1;
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const localUnrelated = close * 2;
  const period = input.int(14, { title: "Period" });
  const trend = ta.ema(close, period);
  void localUnrelated;
  plot.line(trend, { key: "trend" });
  void unrelated;
  void helperA;
  void helperB;
});
`);

  const beforeIds = callsiteMap(before);
  const afterIds = callsiteMap(after);
  assert.equal(afterIds.get("input.int"), beforeIds.get("input.int"));
  assert.equal(afterIds.get("ta.ema"), beforeIds.get("ta.ema"));
  assert.equal(afterIds.get("plot.line"), beforeIds.get("plot.line"));
});

test("keeps identity independent from diagnostic line numbers", async () => {
  const compact = await transform(`
import { defineIndicator, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const trend = ta.ema(close, 14);
});
`);
  const spaced = await transform(`
import { defineIndicator, ta } from "@erc-chart/indicator-sdk";


export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {

  const trend = ta.ema(close, 14);
});
`);

  assert.equal(spaced.callsites[0]?.id, compact.callsites[0]?.id);
  assert.notEqual(
    spaced.callsites[0]?.source.line,
    compact.callsites[0]?.source.line,
  );
});

test("distinguishes adjacent calls by their semantic binding anchor", async () => {
  const result = await transform(`
import { defineIndicator, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const fast = ta.ema(close, 14);
  const slow = ta.ema(close, 14);
  void fast;
  void slow;
});
`);
  assert.equal(result.callsites.length, 2);
  assert.notEqual(result.callsites[0]?.id, result.callsites[1]?.id);
});

test("distinguishes duplicate-looking calls in different semantic scopes", async () => {
  const result = await transform(`
import { ta } from "@erc-chart/indicator-sdk";
function first(close) { return ta.ema(close, 14); }
function second(close) { return ta.ema(close, 14); }
void first;
void second;
`);
  assert.equal(result.callsites.length, 2);
  assert.notEqual(result.callsites[0]?.id, result.callsites[1]?.id);
});

test("fails closed for an ambiguous duplicate semantic call site", async () => {
  const transformIndicatorCallsites = await loadTransform();
  assert.equal(typeof transformIndicatorCallsites, "function");
  assert.throws(
    () =>
      transformIndicatorCallsites(
        `
import { ta } from "@erc-chart/indicator-sdk";
function calculate(close) {
  ta.ema(close, 14);
  ta.ema(close, 14);
}
void calculate;
`,
        { fileName: "src/ambiguous.ts", sourceFileId: "src/ambiguous.ts" },
      ),
    /ambiguous stable call-site identity.*ta\.ema/u,
  );
});

test("honors SDK import aliases and lexical shadowing", async () => {
  const result = await transform(`
import { plot as sdkPlot } from "@erc-chart/indicator-sdk";
function calculate(value) {
  sdkPlot.line(value, { key: "sdk" });
  {
    const sdkPlot = { line() {} };
    sdkPlot.line(value);
  }
}
void calculate;
`);
  assert.equal(result.callsites.length, 1);
  assert.equal(result.callsites[0]?.callee, "plot.line");
});

test("reports unsupported namespace authoring access instead of silently skipping it", async () => {
  const transformIndicatorCallsites = await loadTransform();
  assert.equal(typeof transformIndicatorCallsites, "function");
  assert.throws(
    () =>
      transformIndicatorCallsites(
        `
import * as sdk from "@erc-chart/indicator-sdk";
sdk.plot.line(1);
`,
        { fileName: "src/namespace.ts", sourceFileId: "src/namespace.ts" },
      ),
    /namespace SDK authoring access is unsupported.*named imports/u,
  );
});

test("preserves hidden callsite slots and static metadata for plot.shape overloads", async () => {
  const result = await transform(`
import { location, plot, shape, textSize } from "@erc-chart/indicator-sdk";
const buy = true;
plot.shape(buy, "BUY");
plot.shape(buy, shape.labelUp, "SELL");
plot.shape(buy, {
  shape: shape.labelUp,
  location: location.belowBar,
  text: "ENTRY",
  textColor: "#ffffff",
  textSize: textSize.small
});
`);

  assert.match(
    result.code,
    /plot\.shape\(buy, "BUY", undefined, __ercCallsite_\d+\)/u,
  );
  assert.match(
    result.code,
    /plot\.shape\(buy, shape\.labelUp, "SELL", __ercCallsite_\d+\)/u,
  );
  assert.match(
    result.code,
    /plot\.shape\(buy, \{[\s\S]*?textSize: textSize\.small[\s\S]*?\}, undefined, __ercCallsite_\d+\)/u,
  );
  assert.deepEqual(
    result.plotDeclarations.map(
      ({
        shape: marker,
        location: placement,
        text,
        textColor,
        textSize: size,
      }) => ({
        shape: marker,
        location: placement,
        text,
        textColor,
        textSize: size,
      }),
    ),
    [
      {
        shape: undefined,
        location: undefined,
        text: "BUY",
        textColor: undefined,
        textSize: undefined,
      },
      {
        shape: "label-up",
        location: undefined,
        text: "SELL",
        textColor: undefined,
        textSize: undefined,
      },
      {
        shape: "label-up",
        location: "below-bar",
        text: "ENTRY",
        textColor: "#ffffff",
        textSize: "small",
      },
    ],
  );
});

test("signal callsites capture only the TA and chart-series dependencies used by the condition", async () => {
  const result = await transform(`
import { defineIndicator, plot, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const unrelated = ta.rsi(14);
  const higher = ta.ema(1, "1h");
  const buy = close > higher;
  plot.line(unrelated);
  signal(buy, "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  const higherCallsite = result.callsites.find(
    (value) => value.callee === "ta.ema",
  );
  const unrelatedCallsite = result.callsites.find(
    (value) => value.callee === "ta.rsi",
  );
  assert.ok(signalCallsite);
  assert.ok(higherCallsite);
  assert.ok(unrelatedCallsite);
  assert.deepEqual(signalCallsite.dependencies, [higherCallsite.id]);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
  assert.equal(
    signalCallsite.dependencies.includes(unrelatedCallsite.id),
    false,
  );
});

test("signal dependency tracing fails closed for reassigned condition variables", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  let buy = false;
  buy = !Number.isFinite(ta.ema(close, 14));
  signal(buy, "long");
});
`),
    /signal condition variable buy is reassigned; use a statically traceable const expression/u,
  );
});

test("signal dependency tracing fails closed for mutated condition object properties", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const state = { buy: false };
  state.buy = !Number.isFinite(ta.ema(close, 14));
  signal(state.buy, "long");
});
`),
    /signal condition variable state is reassigned; use a statically traceable const expression/u,
  );
});

test("signal dependency tracing fails closed for mutated condition array elements", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const state = [false];
  state[0] = !Number.isFinite(ta.ema(close, 14));
  signal(state[0], "long");
});
`),
    /signal condition variable state is reassigned; use a statically traceable const expression/u,
  );
});

test("signal dependency tracing fails closed for aliased condition-object mutation", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const state = { buy: false };
  const alias = state;
  alias.buy = !Number.isFinite(ta.ema(close, 14));
  signal(state.buy, "long");
});
`),
    /signal condition variable state is reassigned; use a statically traceable const expression/u,
  );
});

test("signal dependency tracing fails closed for nested condition-object aliases", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const state = { nested: { buy: false } };
  const alias = state.nested;
  alias.buy = !Number.isFinite(ta.ema(close, 14));
  signal(state.nested.buy, "long");
});
`),
    /signal condition variable state is reassigned; use a statically traceable const expression/u,
  );
});

test("signal dependency tracing fails closed for destructured condition-object aliases", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const state = { nested: { buy: false } };
  const { nested } = state;
  nested.buy = !Number.isFinite(ta.ema(close, 14));
  signal(state.nested.buy, "long");
});
`),
    /signal condition variable state is reassigned; use a statically traceable const expression/u,
  );
});

test("signal dependency tracing fails closed for destructuring assignment aliases", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const state = { nested: { buy: false } };
  let alias;
  ({ nested: alias } = state);
  alias.buy = !Number.isFinite(ta.ema(close, 14));
  signal(state.nested.buy, "long");
});
`),
    /signal condition variable state is reassigned; use a statically traceable const expression/u,
  );
});

test("signal dependency tracing follows destructured variable initializers", async () => {
  const result = await transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const state = { buy: ta.ema(close, 14) > close };
  const { buy } = state;
  signal(buy, "long");
});
`);

  const taCallsite = result.callsites.find((value) => value.kind === "ta");
  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(taCallsite);
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.dependencies, [taCallsite.id]);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("signal dependency tracing fails closed when a condition object is passed to a mutating call", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const state = { buy: false };
  Object.assign(state, { buy: !Number.isFinite(ta.ema(close, 14)) });
  signal(state.buy, "long");
});
`),
    /signal condition variable state is reassigned; use a statically traceable const expression/u,
  );
});

test("signal dependency tracing fails closed for condition-array mutator calls", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const state = [false];
  state.splice(0, 1, !Number.isFinite(ta.ema(close, 14)));
  signal(state[0], "long");
});
`),
    /signal condition variable state is reassigned; use a statically traceable const expression/u,
  );
});

test("signal dependency tracing allows condition objects to be read by Object.assign", async () => {
  const result = await transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const state = { buy: close > 0 };
  const clone = Object.assign({}, state);
  void clone;
  signal(state.buy, "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("signal dependency tracing allows read-only array methods before a signal", async () => {
  const result = await transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const state = [close > 0];
  const clone = state.slice();
  void clone;
  signal(state[0], "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("signal dependency tracing allows condition objects through read-only local helpers", async () => {
  const result = await transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
function readState(state) {
  return state.buy;
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const state = { buy: close > 0 };
  void readState(state);
  signal(state.buy, "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("signal dependency tracing fails closed when a local helper mutates condition state", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
function updateState(state, value) {
  state.buy = value;
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const state = { buy: false };
  const average = ta.ema(close, 14);
  updateState(state, !Number.isFinite(average));
  signal(state.buy, "long");
});
`),
    /signal condition variable state is reassigned; use a statically traceable const expression/u,
  );
});

test("signal dependency tracing fails closed when a helper default initializer mutates condition state", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
function updateState(state, ignored = Object.assign(state, { buy: true })) {
  return ignored;
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const state = { buy: close > 0 };
  void updateState(state);
  signal(state.buy, "long");
});
`),
    /signal condition variable state is reassigned; use a statically traceable const expression/u,
  );
});

test("signal dependency tracing fails closed for destructuring reassignment", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  let buy = false;
  [buy] = [!Number.isFinite(ta.ema(close, 14))];
  signal(buy, "long");
});
`),
    /signal condition variable buy is reassigned; use a statically traceable const expression/u,
  );
});

test("explicit-series higher-timeframe TA does not add a chart-candle signal dependency", async () => {
  const result = await transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const higher = ta.ema(close, 1, "1h");
  signal(higher > 0, "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  const higherCallsite = result.callsites.find(
    (value) => value.callee === "ta.ema",
  );
  assert.ok(signalCallsite);
  assert.ok(higherCallsite);
  assert.deepEqual(signalCallsite.dependencies, [higherCallsite.id]);
  assert.deepEqual(signalCallsite.chartSeries, []);
});

test("length-first explicit-series higher-timeframe TA does not add a chart-candle signal dependency", async () => {
  const result = await transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ open }) => {
  const higher = ta.ema(1, open, "1h");
  signal(higher > 0, "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  const higherCallsite = result.callsites.find(
    (value) => value.callee === "ta.ema",
  );
  assert.ok(signalCallsite);
  assert.ok(higherCallsite);
  assert.equal(higherCallsite.seriesSource, "open");
  assert.deepEqual(signalCallsite.dependencies, [higherCallsite.id]);
  assert.deepEqual(signalCallsite.chartSeries, []);
});

test("whole-bar higher-timeframe TA keeps direct series provenance out of chart signal dependencies", async () => {
  const result = await transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, (bar) => {
  const higher = ta.ema(bar.close, 1, "1h");
  signal(higher > 0, "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  const higherCallsite = result.callsites.find(
    (value) => value.callee === "ta.ema",
  );
  assert.ok(signalCallsite);
  assert.ok(higherCallsite);
  assert.equal(higherCallsite.seriesSource, "close");
  assert.deepEqual(signalCallsite.dependencies, [higherCallsite.id]);
  assert.deepEqual(signalCallsite.chartSeries, []);
});

test("bar member signal dependencies include only the accessed chart series", async () => {
  const result = await transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, (bar) => {
  signal(bar.close > 0, "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("non-series bar metadata does not expand into chart-series dependencies", async () => {
  const result = await transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, (bar) => {
  signal(bar.index > 0 && bar.isConfirmed, "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, []);
});

test("bar literal element signal dependencies include only the accessed chart series", async () => {
  const result = await transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, (bar) => {
  signal(bar["close"] > 0, "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("whole-bar literal element higher-timeframe TA preserves direct series provenance", async () => {
  const result = await transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, (bar) => {
  const higher = ta.ema(bar["close"], 1, "1h");
  signal(higher > 0, "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  const higherCallsite = result.callsites.find(
    (value) => value.callee === "ta.ema",
  );
  assert.ok(signalCallsite);
  assert.ok(higherCallsite);
  assert.equal(higherCallsite.seriesSource, "close");
  assert.deepEqual(signalCallsite.dependencies, [higherCallsite.id]);
  assert.deepEqual(signalCallsite.chartSeries, []);
});

test("signal dependency tracing fails closed when a helper hides TA execution", async () => {
  for (const helper of [
    `function buySignal(close) {
  const average = ta.ema(close, 14);
  return close > average;
}`,
    `const buySignal = (close) => {
  const average = ta.ema(close, 14);
  return close > average;
};`,
    `function buySignal(close, average = ta.ema(close, 14)) {
  return close > average;
}`,
  ]) {
    await assert.rejects(
      () =>
        transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
${helper}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  signal(buySignal(close), "long");
});
`),
      /signal condition helper buySignal executes ta\.\* internally; hoist TA calls into the indicator calculation/u,
    );
  }
});

test("signal dependency tracing fails closed for indicator-scope helper closures", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const average = ta.ema(close, 14);
  const buySignal = () => close > average;
  signal(buySignal(), "long");
});
`),
    /signal condition helper buySignal is nested in the indicator calculation; move it to module scope/u,
  );
});

test("signal dependency tracing ignores identifiers used only as property names", async () => {
  const result = await transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const state = { close: 42 };
  signal(state.close > 0, "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, []);
});

test("signal dependency tracing fails closed for indirect helpers that hide TA execution", async () => {
  for (const condition of [
    "helpers.buy(close)",
    "(() => { const average = ta.ema(close, 14); return close > average; })()",
  ]) {
    await assert.rejects(
      () =>
        transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
const helpers = {
  buy(value) {
    const average = ta.ema(value, 14);
    return value > average;
  },
};
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  signal(${condition}, "long");
});
`),
      /signal condition helper .*(?:ta\.\* internally|nested in the indicator calculation)|signal condition callable .*statically traceable/u,
    );
  }
});

test("signal dependency tracing includes whole-bar helper default parameter initializers", async () => {
  const result = await transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
function aboveThreshold(bar, threshold = bar.open) {
  return bar.close > threshold;
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, (bar) => {
  signal(aboveThreshold(bar), "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, ["open", "close"]);
});

test("signal dependency tracing follows whole-bar parameters through module helper chains", async () => {
  const result = await transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
function inner(bar) {
  return bar.index > 0 && bar.close > 0;
}
function outer(bar) {
  return inner(bar);
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, (bar) => {
  signal(outer(bar), "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("signal dependency tracing allows compiler-recognized non-TA calls inside module helpers", async () => {
  const result = await transform(`
import { defineIndicator, input, signal } from "@erc-chart/indicator-sdk";
function readInputs() {
  return { threshold: input.int(10, "Threshold") };
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const params = readInputs();
  signal(close > params.threshold, "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("signal dependency tracing treats SDK drawing-handle mutations as dependency-safe side effects", async () => {
  const result = await transform(`
import { defineIndicator, signal, type BoxHandle } from "@erc-chart/indicator-sdk";
function updateDrawing(handle: BoxHandle | undefined, value: number) {
  handle?.set({ top: value });
  if (value < 0) handle?.delete();
  return value > 0;
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const handle = undefined as BoxHandle | undefined;
  signal(updateDrawing(handle, close), "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("signal dependency tracing does not trust lookalike drawing-handle methods", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
interface BoxHandle { set(value: unknown): void }
function updateDrawing(handle: BoxHandle, value: number) {
  handle.set({ top: value });
  return value > 0;
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  signal(updateDrawing({ set() {} }, close), "long");
});
`),
    /signal condition helper updateDrawing invokes a callable that cannot be resolved/u,
  );
});

test("signal dependency tracing does not trust SDK handle names shadowed by type parameters", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, type BoxHandle } from "@erc-chart/indicator-sdk";
function updateDrawing<BoxHandle extends { set(value: unknown): void }>(handle: BoxHandle, value: number) {
  handle.set({ top: value });
  return value > 0;
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  signal(updateDrawing({ set() {} }, close), "long");
});
`),
    /signal condition helper updateDrawing invokes a callable that cannot be resolved/u,
  );
});

test("signal dependency tracing does not trust SDK handle names shadowed by local type aliases", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, type BoxHandle } from "@erc-chart/indicator-sdk";
function updateDrawing(handle: unknown, value: number) {
  type BoxHandle = { set(value: unknown): void };
  const typedHandle: BoxHandle = handle as BoxHandle;
  typedHandle.set({ top: value });
  return value > 0;
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  signal(updateDrawing({ set() {} }, close), "long");
});
`),
    /signal condition helper updateDrawing invokes a callable that cannot be resolved/u,
  );
});

test("signal dependency tracing allows literal RegExp parsing inside module helpers", async () => {
  const result = await transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
function parsedPositive(value: number) {
  const match = /^([0-9]+)$/u.exec(String(Math.abs(value)));
  return match !== null && value > 0;
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  signal(parsedPositive(close), "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("signal dependency tracing allows direct standard builtin conversions", async () => {
  const result = await transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
function parsedPositive(value: number) {
  return Number(String(value)) > 0;
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  signal(parsedPositive(close), "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("signal dependency tracing does not trust shadowed direct builtin calls", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
function Number(value: number) {
  return ta.ema(value, 14);
}
function blocked(value: number) {
  return Number(value) > 0;
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  signal(blocked(close), "long");
});
`),
    /signal condition helper blocked executes ta\.\* internally/u,
  );
});

test("signal dependency tracing proves standard array methods from parameter and property types", async () => {
  const result = await transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
interface Zone { readonly values: readonly number[] }
function blocked(zones: readonly Zone[]) {
  return zones.some((zone) => (zone.values.at(-1) ?? 0) > 0);
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  signal(blocked([{ values: [close] }]), "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("signal dependency tracing fails closed for unresolved named array types without crashing", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
import type { ExternalZones } from "./external-types.js";
function blocked(zones: ExternalZones, value: number) {
  return zones.some(() => value > 0);
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  signal(blocked([] as unknown as ExternalZones, close), "long");
});
`),
    /signal condition helper blocked invokes a callable that cannot be resolved/u,
  );
});

test("signal dependency tracing follows explicit helper return types for array properties", async () => {
  const result = await transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
interface Candidate { readonly values: readonly number[] }
function makeCandidate(value: number): Candidate | undefined {
  return value > 0 ? { values: [value] } : undefined;
}
function blocked(value: number) {
  const candidate = makeCandidate(value);
  if (candidate === undefined) return false;
  return candidate.values.some((item) => item > 0);
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  signal(blocked(close), "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("signal dependency tracing infers for-of element types for array properties", async () => {
  const result = await transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
interface Zone { readonly segments: readonly number[] }
function blocked(zones: readonly Zone[]) {
  for (const zone of zones) {
    if ((zone.segments.at(-1) ?? 0) > 0) return true;
  }
  return false;
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  signal(blocked([{ segments: [close] }]), "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("signal dependency tracing preserves element types through spread and array-returning methods", async () => {
  const result = await transform(`
import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
interface Zone { readonly segments: readonly number[] }
function blocked(zones: readonly Zone[]) {
  const ranked = [...zones].sort(() => 0);
  let result = false;
  ranked.forEach((zone) => {
    result ||= (zone.segments.at(-1) ?? 0) > 0;
  });
  return result;
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  signal(blocked([{ segments: [close] }]), "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("signal dependency tracing does not preserve element types through transforming array methods", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
interface Zone { readonly values: readonly number[] }
const sneaky = {
  values: {
    some(value) {
      return ta.ema(value, 14) > 0;
    },
  },
};
function blocked(zones: readonly Zone[]) {
  const mapped = [...zones].map(() => sneaky);
  return mapped.some((item) => item.values.some(1));
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  signal(blocked([{ values: [close] }]), "long");
});
`),
    /signal condition helper blocked invokes a callable that cannot be resolved/u,
  );
});

test("signal dependency tracing does not infer array receivers from unrelated same-named properties", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
interface Zone { readonly values: readonly number[] }
const sneaky = {
  values: {
    some(value) {
      return ta.ema(value, 14) > 0;
    },
  },
};
function blocked(value) {
  return sneaky.values.some(value);
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  signal(blocked(close), "long");
});
`),
    /signal condition helper blocked invokes a callable that cannot be resolved/u,
  );
});

test("signal dependency tracing does not trust shadowed builtin call roots", async () => {
  await assert.rejects(
    () =>
      transform(`
import { defineIndicator, signal, ta } from "@erc-chart/indicator-sdk";
const Math = {
  max(value) {
    return ta.ema(value, 14);
  },
};
function blocked(value) {
  return Math.max(value) > 0;
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  signal(blocked(close), "long");
});
`),
    /signal condition helper blocked executes ta\.\* internally/u,
  );
});
