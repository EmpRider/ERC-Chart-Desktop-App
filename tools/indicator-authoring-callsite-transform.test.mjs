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
import { defineIndicator, input, plot, series, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator(
  { id: "erc.indicator.callsite.main", name: "Callsite" },
  ({ close }) => {
    const length = input.int(14, { title: "Length" });
    const average = ta.ema(close, length);
    const count = series(0, (previous) => previous + 1);
    if (average > close) {
      plot.shape(average, { key: "shape" });
    }
    plot.hline(50, { key: "threshold" });
    plot.box({
      id: "legacy-box",
      startTimeMs: 0,
      endTimeMs: 1,
      top: count + 1,
      bottom: count,
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
      ["state", "series"],
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

  assert.match(result.code, /input\.int\(14, undefined, __ercCallsite_\d+\)/u);
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

test("signal dependency tracing follows state callbacks that capture outer TA and chart sources", async () => {
  const result = await transform(`
import { defineIndicator, series, signal, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, (bar) => {
  const higher = ta.ema(1, "1h");
  const state = series({ buy: false }, () => ({ buy: bar.close > higher }));
  signal(state.buy, "long");
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
  assert.ok(signalCallsite.chartSeries.includes("close"));
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

test("signal dependency tracing allows provable array helpers inside module signal-state helpers", async () => {
  const result = await transform(`
import { defineIndicator, series, signal, ta } from "@erc-chart/indicator-sdk";
function step(previous, close, higher) {
  const outcomes = [...previous.outcomes, close].slice(-4);
  const prior = outcomes.find((value) => value > higher);
  return { outcomes, buy: prior !== undefined && close > higher };
}
export default defineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => {
  const higher = ta.ema(1, "1h");
  const state = series({ outcomes: [], buy: false }, (previous) =>
    step(previous, close, higher),
  );
  signal(state.buy, "long");
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
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("signal dependency tracing recognizes pure SDK helpers and traces their arguments", async () => {
  const result = await transform(`
import { defineIndicator, history, priceValue, signal } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" }, (bar) => {
  const source = priceValue(bar, "close");
  const previous = history(source, 1);
  signal(previous > 0, "long");
});
`);

  const signalCallsite = result.callsites.find(
    (value) => value.kind === "signal",
  );
  assert.ok(signalCallsite);
  assert.ok(signalCallsite.chartSeries.includes("close"));
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
