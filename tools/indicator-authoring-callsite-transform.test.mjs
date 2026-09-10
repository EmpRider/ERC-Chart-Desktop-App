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
  assert.doesNotMatch(result.code, /from\s+["']@erc-chart\/indicator-sdk\/internal/u);
  assert.match(result.code, /ta\.ema\([^;]*__ercCallsite_/u);
  assert.match(result.code, /plot\.shape\([^;]*__ercCallsite_/u);
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
  assert.notEqual(spaced.callsites[0]?.source.line, compact.callsites[0]?.source.line);
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
