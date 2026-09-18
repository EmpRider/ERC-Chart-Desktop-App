import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

const context = { instrumentId: "TEST", timeframeId: "1m" };

const candle = (index, close) => ({
  ...context,
  openTimeMs: index * 60_000,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: index + 1,
});

async function packagedPlugin(sourceText, extraFiles = {}) {
  const sourceDirectory = await mkdtemp(
    path.join(import.meta.dirname, ".top-level-authoring-source-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-top-level-authoring-package-"),
  );
  try {
    const source = path.join(sourceDirectory, "indicator.ts");
    await writeFile(source, sourceText, "utf8");
    for (const [relativePath, contents] of Object.entries(extraFiles)) {
      const target = path.join(sourceDirectory, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents, "utf8");
    }
    const { manifest, packageRoot } = await buildIndicatorPackage({
      source,
      outputRoot: path.join(outputDirectory, "package"),
      id: "erc.indicator.top-level-authoring",
      version: "0.1.0",
    });
    const entry = await readFile(path.join(packageRoot, manifest.entry));
    return await import(
      `data:text/javascript;base64,${entry.toString("base64")}`
    );
  } finally {
    await rm(sourceDirectory, { recursive: true, force: true });
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

test("package build rejects callback-shaped defineIndicator assigned before default export", async () => {
  await assert.rejects(
    () =>
      packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

const indicator = defineIndicator(
  { id: "erc.indicator.top-level-authoring.legacy-assigned", name: "Legacy assigned" },
  ({ close }) => {
    plot.line(close);
  },
);

export default indicator;
`),
    /metadata-only defineIndicator declaration/u,
  );
});

test("package build rejects callback-shaped defineIndicator reached through a local alias", async () => {
  await assert.rejects(
    () =>
      packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

const define = defineIndicator;
export default define(
  { id: "erc.indicator.top-level-authoring.legacy-local-alias", name: "Legacy local alias" },
  ({ close }) => {
    plot.line(close);
  },
);
`),
    /defineIndicator binding cannot be aliased or escaped/u,
  );
});

test("package build rejects defineIndicator escaped through an object and destructuring", async () => {
  await assert.rejects(
    () =>
      packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

const holder = { define: defineIndicator };
const { define } = holder;
export default define(
  { id: "erc.indicator.top-level-authoring.legacy-object-alias", name: "Legacy object alias" },
  ({ close }) => {
    plot.line(close);
  },
);
`),
    /defineIndicator binding cannot be aliased or escaped/u,
  );
});

test("package build allows type-only defineIndicator references", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

type DefineIndicatorType = typeof defineIndicator;

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.type-only-define",
  name: "Type-only defineIndicator",
});

plot.line(close);
`);

  assert.equal(typeof plugin.createInstance, "function");
});

test("package build allows namespace-local defineIndicator shadowing", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

namespace Local {
  export function defineIndicator(value: number) {
    return value;
  }
  export const value = defineIndicator(1);
}

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.namespace-shadow",
  name: "Namespace shadow",
});

plot.line(close);
`);

  assert.equal(typeof plugin.createInstance, "function");
});

test("package build allows namespace-local import-equals defineIndicator shadowing", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

namespace Helpers {
  export function defineIndicator(value: number) {
    return value;
  }
}

namespace Local {
  import defineIndicator = Helpers.defineIndicator;
  export const value = defineIndicator(1);
}

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.namespace-import-equals-shadow",
  name: "Namespace import-equals shadow",
});

plot.line(close);
`);

  assert.equal(typeof plugin.createInstance, "function");
});

test("package build rejects CommonJS access to the indicator SDK", async () => {
  await assert.rejects(
    () =>
      packagedPlugin(`
const { defineIndicator } = require("@erc-chart/indicator-sdk");
export default defineIndicator(
  { id: "erc.indicator.top-level-authoring.legacy-commonjs", name: "Legacy CommonJS" },
  ({ close }) => close,
);
`),
    /indicator SDK must use static named imports/u,
  );
});

test("package build rejects constant-derived CommonJS access to the indicator SDK", async () => {
  await assert.rejects(
    () =>
      packagedPlugin(`
const sdkName = "@erc-chart/indicator-sdk";
const { defineIndicator } = require(sdkName);
export default defineIndicator(
  { id: "erc.indicator.top-level-authoring.legacy-commonjs-const", name: "Legacy CommonJS const" },
  ({ close }) => close,
);
`),
    /indicator SDK must use static named imports/u,
  );
});

test("package build rejects shadowed constant-derived CommonJS SDK access", async () => {
  await assert.rejects(
    () =>
      packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

const sdkName = "./unrelated-module.js";
function loadSdk() {
  const sdkName = "@erc-chart/indicator-sdk";
  return require(sdkName);
}

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.shadowed-commonjs-const",
  name: "Shadowed CommonJS const",
});
plot.line(close);
`),
    /indicator SDK must use static named imports/u,
  );
});

test("package build allows a lexically shadowed local require function", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

function loadLocal(require: (name: string) => unknown) {
  const sdkName = "@erc-chart/indicator-sdk";
  return require(sdkName);
}

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.shadowed-require",
  name: "Shadowed require",
});

plot.line(close);
`);

  assert.equal(typeof plugin.createInstance, "function");
});

test("package build allows unresolved dynamic imports unrelated to the indicator SDK", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

function loadOptional(moduleName: string) {
  return import(moduleName);
}

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.dynamic-unrelated",
  name: "Dynamic unrelated",
});

plot.line(close);
`);

  assert.equal(typeof plugin.createInstance, "function");
});

test("package build rejects dynamic imports of the indicator SDK", async () => {
  await assert.rejects(
    () =>
      packagedPlugin(`
const { defineIndicator } = await import("@erc-chart/indicator-sdk");
export default defineIndicator(
  { id: "erc.indicator.top-level-authoring.legacy-dynamic", name: "Legacy dynamic import" },
  ({ close }) => close,
);
`),
    /indicator SDK must use static named imports/u,
  );
});

test("package build rejects constant-derived dynamic imports of the indicator SDK", async () => {
  await assert.rejects(
    () =>
      packagedPlugin(`
const sdkName = "@erc-chart/indicator-sdk";
const { defineIndicator } = await import(sdkName);
export default defineIndicator(
  { id: "erc.indicator.top-level-authoring.legacy-dynamic-const", name: "Legacy dynamic const" },
  ({ close }) => close,
);
`),
    /indicator SDK must use static named imports/u,
  );
});

test("package build rejects runtime namespace imports of the indicator SDK", async () => {
  await assert.rejects(
    () =>
      packagedPlugin(`
import * as sdk from "@erc-chart/indicator-sdk";
function legacy(runtime) {
  return runtime.defineIndicator(
    { id: "erc.indicator.top-level-authoring.legacy-namespace", name: "Legacy namespace" },
    ({ close }) => close,
  );
}
export default legacy(sdk);
`),
    /indicator SDK must use static named imports/u,
  );
});

test("package build cannot receive the hidden callback constructor through a dependency", async () => {
  await assert.rejects(
    () =>
      packagedPlugin(
        `
import legacyIndicator from "legacy-indicator-helper";
export default legacyIndicator;
`,
        {
          "node_modules/legacy-indicator-helper/package.json": JSON.stringify({
            name: "legacy-indicator-helper",
            version: "1.0.0",
            type: "module",
            exports: "./index.js",
          }),
          "node_modules/legacy-indicator-helper/index.js": `
import { defineIndicator } from "@erc-chart/indicator-sdk";
export default defineIndicator(
  { id: "erc.indicator.top-level-authoring.legacy-dependency", name: "Legacy dependency" },
  () => undefined,
);
`,
        },
      ),
    /indicator source must be compiled/u,
  );
});

test("canonical top-level Pine-style package executes the ECDD-236 authoring contract", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, input, plot, ta } from "@erc-chart/indicator-sdk";

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.main",
  name: "Top-level authoring",
});

const length = input.int(2, "Length", { min: 1, max: 10, group: "Core" });
const source = input.source(close, "Source", { group: "Core" });
const fast = ta.ema(source, length);
const priorClose = close[1];
const priorFast = fast[1];

plot.line(source, { title: "Source" });
plot.line(open + high + low + close + volume, { title: "OHLCV sum" });
plot.line(fast, { title: "Fast" });
plot.line(priorClose, { title: "Prior close" });
plot.line(priorFast, { title: "Prior fast" });
plot.line(bar.index, { title: "Bar index" });
plot.line(bar.time, { title: "Bar time" });
plot.line(bar.confirmed ? 1 : 0, { title: "Bar confirmed" });
`);

  assert.deepEqual(
    plugin.definition.inputs.map(
      ({ label, type, defaultValue, min, max, group }) => ({
        label,
        type,
        defaultValue,
        ...(min === undefined ? {} : { min }),
        ...(max === undefined ? {} : { max }),
        ...(group === undefined ? {} : { group }),
      }),
    ),
    [
      {
        label: "Length",
        type: "number",
        defaultValue: 2,
        min: 1,
        max: 10,
        group: "Core",
      },
      {
        label: "Source",
        type: "source",
        defaultValue: "close",
        group: "Core",
      },
    ],
  );

  const outputKeyFor = (label) => {
    const definition = plugin.definition.plots.find(
      (candidate) => candidate.label === label,
    );
    assert.ok(definition, `Missing plot definition for ${label}`);
    return definition.outputKey ?? definition.key;
  };
  const keys = Object.fromEntries(
    [
      "Source",
      "OHLCV sum",
      "Fast",
      "Prior close",
      "Prior fast",
      "Bar index",
      "Bar time",
      "Bar confirmed",
    ].map((label) => [label, outputKeyFor(label)]),
  );

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([
      candle(0, 10),
      candle(1, 11),
      candle(2, 12),
      candle(3, 13),
    ]);
    const values = (label) =>
      instance.snapshot().points.map((point) => point.values[keys[label]]);

    assert.deepEqual(values("Source"), [10, 11, 12, 13]);
    assert.deepEqual(values("OHLCV sum"), [39, 44, 49, 54]);
    assert.deepEqual(values("Fast"), [null, 10.5, 11.5, 12.5]);
    assert.deepEqual(values("Prior close"), [null, 10, 11, 12]);
    assert.deepEqual(values("Prior fast"), [null, null, 10.5, 11.5]);
    assert.deepEqual(values("Bar index"), [0, 1, 2, 3]);
    assert.deepEqual(values("Bar time"), [0, 60_000, 120_000, 180_000]);
    assert.deepEqual(values("Bar confirmed"), [1, 1, 1, 0]);
  } finally {
    instance.dispose();
  }
});

test("length-first TA overloads match source-first execution for direct and selected sources", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, input, plot, ta } from "@erc-chart/indicator-sdk";

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.ta-overloads",
  name: "TA overloads",
});

const length = input.int(2, "Length");
const source = input.source(open, "Source");
const emaLengthFirst = ta.ema(length, open);
const emaSourceFirst = ta.ema(open, length);
const selectedLengthFirst = ta.ema(length, source);
const selectedSourceFirst = ta.ema(source, length);
const rsiLengthFirst = ta.rsi(length, open);
const rsiSourceFirst = ta.rsi(open, length);

plot.line(emaLengthFirst, { title: "EMA length first" });
plot.line(emaSourceFirst, { title: "EMA source first" });
plot.line(selectedLengthFirst, { title: "Selected length first" });
plot.line(selectedSourceFirst, { title: "Selected source first" });
plot.line(rsiLengthFirst, { title: "RSI length first" });
plot.line(rsiSourceFirst, { title: "RSI source first" });
`);

  const outputKeyFor = (label) => {
    const definition = plugin.definition.plots.find(
      (candidate) => candidate.label === label,
    );
    assert.ok(definition, `Missing plot definition for ${label}`);
    return definition.outputKey ?? definition.key;
  };
  const pairs = [
    ["EMA length first", "EMA source first"],
    ["Selected length first", "Selected source first"],
    ["RSI length first", "RSI source first"],
  ];

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([
      candle(0, 10),
      candle(1, 12),
      candle(2, 11),
      candle(3, 14),
      candle(4, 13),
    ]);
    for (const [lengthFirst, sourceFirst] of pairs) {
      const leftKey = outputKeyFor(lengthFirst);
      const rightKey = outputKeyFor(sourceFirst);
      assert.deepEqual(
        instance.snapshot().points.map((point) => point.values[leftKey]),
        instance.snapshot().points.map((point) => point.values[rightKey]),
      );
    }
  } finally {
    instance.dispose();
  }
});

test("length-first TA overloads resolve module-scope constant lengths", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot, ta } from "@erc-chart/indicator-sdk";

const DEFAULT_LENGTH = 2;

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.ta-static-length",
  name: "TA static length",
});

const emaLengthFirst = ta.ema(DEFAULT_LENGTH, open);
const emaSourceFirst = ta.ema(open, DEFAULT_LENGTH);

plot.line(emaLengthFirst, { title: "EMA length first" });
plot.line(emaSourceFirst, { title: "EMA source first" });
`);

  const outputKeyFor = (label) => {
    const definition = plugin.definition.plots.find(
      (candidate) => candidate.label === label,
    );
    assert.ok(definition, `Missing plot definition for ${label}`);
    return definition.outputKey ?? definition.key;
  };

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([
      candle(0, 10),
      candle(1, 12),
      candle(2, 11),
      candle(3, 14),
      candle(4, 13),
    ]);
    const lengthFirstKey = outputKeyFor("EMA length first");
    const sourceFirstKey = outputKeyFor("EMA source first");
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[lengthFirstKey]),
      instance.snapshot().points.map((point) => point.values[sourceFirstKey]),
    );
  } finally {
    instance.dispose();
  }
});

test("length-first TA overloads resolve wrapped constants and history-indexed series", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot, ta } from "@erc-chart/indicator-sdk";

const WRAPPED_LENGTH = 2 as const;

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.ta-wrapped-history",
  name: "TA wrapped history",
});

const wrappedLengthFirst = ta.ema(WRAPPED_LENGTH, open);
const wrappedSourceFirst = ta.ema(open, WRAPPED_LENGTH);
const historyLengthFirst = ta.ema(2, close[1]);
const historySourceFirst = ta.ema(close[1], 2);

plot.line(wrappedLengthFirst, { title: "Wrapped length first" });
plot.line(wrappedSourceFirst, { title: "Wrapped source first" });
plot.line(historyLengthFirst, { title: "History length first" });
plot.line(historySourceFirst, { title: "History source first" });
`);

  const outputKeyFor = (label) => {
    const definition = plugin.definition.plots.find(
      (candidate) => candidate.label === label,
    );
    assert.ok(definition, `Missing plot definition for ${label}`);
    return definition.outputKey ?? definition.key;
  };

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([
      candle(0, 10),
      candle(1, 12),
      candle(2, 11),
      candle(3, 14),
      candle(4, 13),
    ]);
    for (const [lengthFirst, sourceFirst] of [
      ["Wrapped length first", "Wrapped source first"],
      ["History length first", "History source first"],
    ]) {
      const leftKey = outputKeyFor(lengthFirst);
      const rightKey = outputKeyFor(sourceFirst);
      assert.deepEqual(
        instance.snapshot().points.map((point) => point.values[leftKey]),
        instance.snapshot().points.map((point) => point.values[rightKey]),
      );
    }
  } finally {
    instance.dispose();
  }
});

test("length-first TA overloads recognize helper-derived and bar-derived series", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot, ta } from "@erc-chart/indicator-sdk";

function midpoint() {
  return (open + close) / 2;
}

function shifted(value: number) {
  return value + 1;
}

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.ta-derived-series",
  name: "TA derived series",
});

const helperSource = midpoint();
const parameterSource = shifted(open);
const expressionSource = (high + low) / 2;
const helperLengthFirst = ta.ema(2, helperSource);
const helperSourceFirst = ta.ema(helperSource, 2);
const parameterLengthFirst = ta.ema(2, parameterSource);
const parameterSourceFirst = ta.ema(parameterSource, 2);
const expressionLengthFirst = ta.ema(2, expressionSource);
const expressionSourceFirst = ta.ema(expressionSource, 2);

plot.line(helperLengthFirst, { title: "Helper length first" });
plot.line(helperSourceFirst, { title: "Helper source first" });
plot.line(parameterLengthFirst, { title: "Parameter length first" });
plot.line(parameterSourceFirst, { title: "Parameter source first" });
plot.line(expressionLengthFirst, { title: "Expression length first" });
plot.line(expressionSourceFirst, { title: "Expression source first" });
`);

  const outputKeyFor = (label) => {
    const definition = plugin.definition.plots.find(
      (candidate) => candidate.label === label,
    );
    assert.ok(definition, `Missing plot definition for ${label}`);
    return definition.outputKey ?? definition.key;
  };

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([
      candle(0, 10),
      candle(1, 12),
      candle(2, 11),
      candle(3, 14),
      candle(4, 13),
    ]);
    for (const [lengthFirst, sourceFirst] of [
      ["Helper length first", "Helper source first"],
      ["Parameter length first", "Parameter source first"],
      ["Expression length first", "Expression source first"],
    ]) {
      const leftKey = outputKeyFor(lengthFirst);
      const rightKey = outputKeyFor(sourceFirst);
      assert.deepEqual(
        instance.snapshot().points.map((point) => point.values[leftKey]),
        instance.snapshot().points.map((point) => point.values[rightKey]),
      );
    }
  } finally {
    instance.dispose();
  }
});

test("persistent var objects commit finalized state, roll back building replacements, and reset on rebuild", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.state",
  name: "Persistent var state",
});

var state = { values: [] as number[], total: 0 };
state.values.push(close);
state.total += close;

plot.line(state.total, { title: "Total" });
plot.line(state.values.length, { title: "Count" });
`);

  const totalKey = plugin.definition.plots.find(
    (candidate) => candidate.label === "Total",
  )?.outputKey;
  const countKey = plugin.definition.plots.find(
    (candidate) => candidate.label === "Count",
  )?.outputKey;
  assert.ok(totalKey);
  assert.ok(countKey);

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 11)]);
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[totalKey]),
      [10, 21],
    );
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[countKey]),
      [1, 2],
    );

    instance.onBuildingBar(candle(1, 20));
    assert.equal(instance.snapshot().points.at(-1).values[totalKey], 30);
    assert.equal(instance.snapshot().points.at(-1).values[countKey], 2);

    instance.onBuildingBar(candle(1, 30));
    assert.equal(instance.snapshot().points.at(-1).values[totalKey], 40);
    assert.equal(instance.snapshot().points.at(-1).values[countKey], 2);

    instance.onFinalizedBar(candle(1, 30));
    instance.onBuildingBar(candle(2, 5));
    assert.equal(instance.snapshot().points.at(-1).values[totalKey], 45);
    assert.equal(instance.snapshot().points.at(-1).values[countKey], 3);

    instance.onHistory([candle(0, 2), candle(1, 3)]);
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[totalKey]),
      [2, 5],
    );
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[countKey]),
      [1, 2],
    );
  } finally {
    instance.dispose();
  }
});

test("persistent var initializers run once per indicator state lifetime", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

let initializationCount = 0;
function createState() {
  initializationCount += 1;
  return { firstClose: close };
}

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.lazy-state",
  name: "Lazy persistent state",
});

var state = createState();
plot.line(initializationCount, { title: "Initializations" });
plot.line(state.firstClose, { title: "First close" });
`);

  const initializationKey = plugin.definition.plots.find(
    (candidate) => candidate.label === "Initializations",
  )?.outputKey;
  const firstCloseKey = plugin.definition.plots.find(
    (candidate) => candidate.label === "First close",
  )?.outputKey;
  assert.ok(initializationKey);
  assert.ok(firstCloseKey);

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 11), candle(2, 12)]);
    const initializations = instance
      .snapshot()
      .points.map((point) => point.values[initializationKey]);
    assert.equal(new Set(initializations).size, 1);
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[firstCloseKey]),
      [10, 10, 10],
    );

    const initializationCountAfterHistory = initializations.at(-1);
    instance.onBuildingBar(candle(2, 30));
    assert.equal(
      instance.snapshot().points.at(-1).values[initializationKey],
      initializationCountAfterHistory,
    );
  } finally {
    instance.dispose();
  }
});

test("persistent var first-use initialization rolls back with an abandoned building path", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

function firstSeenClose() {
  var state = { firstClose: close };
  return state.firstClose;
}

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.provisional-initialization",
  name: "Provisional persistent initialization",
});

const value = close > 0 ? firstSeenClose() : -1;
plot.line(value, { title: "Value" });
`);

  const valueKey = plugin.definition.plots.find(
    (candidate) => candidate.label === "Value",
  )?.outputKey;
  assert.ok(valueKey);

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, -1), candle(1, -1)]);
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[valueKey]),
      [-1, -1],
    );

    instance.onBuildingBar(candle(1, 100));
    assert.equal(instance.snapshot().points.at(-1).values[valueKey], 100);

    instance.onBuildingBar(candle(1, -1));
    assert.equal(instance.snapshot().points.at(-1).values[valueKey], -1);
    instance.onFinalizedBar(candle(1, -1));

    instance.onBuildingBar(candle(2, 5));
    assert.equal(instance.snapshot().points.at(-1).values[valueKey], 5);
  } finally {
    instance.dispose();
  }
});

test("persistent var state inside a helper is independent at each authored call site", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

function accumulate(step: number) {
  var state = { value: 0 };
  state.value += step;
  return state.value;
}

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.helper-state",
  name: "Persistent helper state",
});

const fast = accumulate(1);
const slow = accumulate(10);
plot.line(fast, { title: "Fast" });
plot.line(slow, { title: "Slow" });
`);

  const fastKey = plugin.definition.plots.find(
    (candidate) => candidate.label === "Fast",
  )?.outputKey;
  const slowKey = plugin.definition.plots.find(
    (candidate) => candidate.label === "Slow",
  )?.outputKey;
  assert.ok(fastKey);
  assert.ok(slowKey);

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 11)]);
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[fastKey]),
      [1, 2],
    );
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[slowKey]),
      [10, 20],
    );

    instance.onBuildingBar(candle(1, 20));
    instance.onBuildingBar(candle(1, 30));
    assert.equal(instance.snapshot().points.at(-1).values[fastKey], 2);
    assert.equal(instance.snapshot().points.at(-1).values[slowKey], 20);

    instance.onFinalizedBar(candle(1, 30));
    instance.onBuildingBar(candle(2, 5));
    assert.equal(instance.snapshot().points.at(-1).values[fastKey], 3);
    assert.equal(instance.snapshot().points.at(-1).values[slowKey], 30);
  } finally {
    instance.dispose();
  }
});

test("persistent var collections keep the existing bounded state limit", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.bounded-state",
  name: "Bounded persistent state",
});

var state = { values: [] as number[] };
for (let index = 0; index < 4_097; index += 1) state.values.push(close + index);
plot.line(state.values.length, { title: "Count" });
`);

  const instance = plugin.createInstance({}, context);
  try {
    assert.throws(
      () => instance.onHistory([candle(0, 10), candle(1, 11)]),
      /Series state collections may contain at most 4,096 items/u,
    );
  } finally {
    instance.dispose();
  }
});

test("persistent var collection limit accepts 4,096 items across slots", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.aggregate-state-boundary",
  name: "Aggregate persistent state boundary",
});

var left = [] as number[];
var right = [] as number[];
if (left.length === 0)
  for (let index = 0; index < 2_048; index += 1) left.push(index);
if (right.length === 0)
  for (let index = 0; index < 2_048; index += 1) right.push(index);
plot.line(left.length + right.length, { title: "Count" });
`);

  const countKey = plugin.definition.plots.find(
    (candidate) => candidate.label === "Count",
  )?.outputKey;
  assert.ok(countKey);

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 11)]);
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[countKey]),
      [4_096, 4_096],
    );
  } finally {
    instance.dispose();
  }
});

test("persistent var collection limit rejects aggregate overflow across slots", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.aggregate-state-overflow",
  name: "Aggregate persistent state overflow",
});

var left = [] as number[];
var right = [] as number[];
if (left.length === 0)
  for (let index = 0; index < 2_048; index += 1) left.push(index);
if (right.length === 0)
  for (let index = 0; index < 2_049; index += 1) right.push(index);
plot.line(left.length + right.length, { title: "Count" });
`);

  const instance = plugin.createInstance({}, context);
  try {
    assert.throws(
      () => instance.onHistory([candle(0, 10), candle(1, 11)]),
      /Series state collections may contain at most 4,096 items/u,
    );
  } finally {
    instance.dispose();
  }
});

test("packaged persistent var state rejects custom class instances", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

class CustomState {
  value = 0;
}

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.custom-class-state",
  name: "Custom class persistent state",
});

var state: { value: number } = { value: 0 };
if (bar.confirmed) state = new CustomState();
state.value += 1;
plot.line(state.value, { title: "Value" });
`);

  const instance = plugin.createInstance({}, context);
  try {
    assert.throws(
      () => instance.onHistory([candle(0, 10), candle(1, 11)]),
      /Series state does not support custom class instances/u,
    );
  } finally {
    instance.dispose();
  }
});

test("packaged persistent var state preserves null object prototypes across commits", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

function createState() {
  const state = Object.create(null) as { total: number };
  state.total = 0;
  return state;
}

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.null-prototype-state",
  name: "Null prototype persistent state",
});

var state = createState();
state.total += 1;
plot.line(Object.getPrototypeOf(state) === null ? state.total : -1, {
  title: "Total",
});
`);

  const totalKey = plugin.definition.plots.find(
    (candidate) => candidate.label === "Total",
  )?.outputKey;
  assert.ok(totalKey);

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 11)]);
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[totalKey]),
      [1, 2],
    );
  } finally {
    instance.dispose();
  }
});

test("conditional persistent helper calls retain hidden state identity", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

function accumulate(step: number) {
  var state = { value: 0 };
  state.value += step;
  return state.value;
}

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.conditional-state",
  name: "Conditional persistent state",
});

const value = close > 0 ? accumulate(close) : 0;
plot.line(value, { title: "Value" });
`);

  const valueKey = plugin.definition.plots.find(
    (candidate) => candidate.label === "Value",
  )?.outputKey;
  assert.ok(valueKey);

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 1), candle(1, -1), candle(2, 2)]);
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[valueKey]),
      [1, 0, 3],
    );
    instance.onBuildingBar(candle(2, 4));
    instance.onBuildingBar(candle(2, 5));
    assert.equal(instance.snapshot().points.at(-1).values[valueKey], 6);
  } finally {
    instance.dispose();
  }
});

test("persistent drawing handle vars typecheck and update across bars", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot, type BoxHandle } from "@erc-chart/indicator-sdk";

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.drawing-handle-state",
  name: "Persistent drawing handle state",
});

var box: BoxHandle | undefined = undefined;
const drawing = {
  left: bar.time,
  right: bar.time + 60_000,
  top: close,
  bottom: close - 1,
  color: "#008800",
};
if (box === undefined) box = plot.box(drawing);
else box.set(drawing);
`);

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 20)]);
    const first = instance.snapshot().overlays;
    assert.equal(first.length, 1);
    assert.equal(first[0].top, 20);
    const drawingId = first[0].id;

    instance.onBuildingBar(candle(1, 30));
    assert.equal(instance.snapshot().overlays[0].id, drawingId);
    assert.equal(instance.snapshot().overlays[0].top, 30);

    instance.onBuildingBar(candle(1, 20));
    assert.equal(instance.snapshot().overlays[0].id, drawingId);
    assert.equal(instance.snapshot().overlays[0].top, 20);
  } finally {
    instance.dispose();
  }
});

test("scalar recurrence uses ordinary script values and commits the final value for history", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.scalar-recurrence",
  name: "Scalar recurrence",
});

let total = close;
const previous = total[1];
if (Number.isFinite(previous)) total += previous;
plot.line(total, { title: "Total" });
`);

  const totalKey = plugin.definition.plots.find(
    (candidate) => candidate.label === "Total",
  )?.outputKey;
  assert.ok(totalKey);

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 11), candle(2, 12)]);
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[totalKey]),
      [10, 21, 33],
    );

    instance.onBuildingBar(candle(2, 20));
    instance.onBuildingBar(candle(2, 30));
    assert.equal(instance.snapshot().points.at(-1).values[totalKey], 51);

    instance.onFinalizedBar(candle(2, 30));
    instance.onBuildingBar(candle(3, 4));
    assert.equal(instance.snapshot().points.at(-1).values[totalKey], 55);

    instance.onHistory([candle(0, 2), candle(1, 3)]);
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[totalKey]),
      [2, 5],
    );
  } finally {
    instance.dispose();
  }
});

test("scalar recurrence inside a helper keeps authored call sites isolated", async () => {
  const { default: plugin } = await packagedPlugin(`
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

function accumulate(multiplier: number) {
  let total = close * multiplier;
  const previous = total[1];
  if (Number.isFinite(previous)) total += previous;
  return { current: total[0], previous };
}

export default defineIndicator({
  id: "erc.indicator.top-level-authoring.scalar-helper-recurrence",
  name: "Scalar helper recurrence",
});

const fast = accumulate(1);
const slow = accumulate(10);
plot.line(fast.current, { title: "Fast" });
plot.line(slow.current, { title: "Slow" });
plot.line(fast.previous, { title: "Fast previous" });
`);

  const key = (label) =>
    plugin.definition.plots.find((candidate) => candidate.label === label)
      ?.outputKey;
  const fastKey = key("Fast");
  const slowKey = key("Slow");
  const fastPreviousKey = key("Fast previous");
  assert.ok(fastKey);
  assert.ok(slowKey);
  assert.ok(fastPreviousKey);

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 1), candle(1, 2), candle(2, 3)]);
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[fastKey]),
      [1, 3, 6],
    );
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[slowKey]),
      [10, 30, 60],
    );
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values[fastPreviousKey]),
      [null, 1, 3],
    );

    instance.onBuildingBar(candle(2, 4));
    instance.onBuildingBar(candle(2, 5));
    assert.equal(instance.snapshot().points.at(-1).values[fastKey], 8);
    assert.equal(instance.snapshot().points.at(-1).values[slowKey], 80);

    instance.onFinalizedBar(candle(2, 5));
    instance.onBuildingBar(candle(3, 1));
    assert.equal(instance.snapshot().points.at(-1).values[fastKey], 9);
    assert.equal(instance.snapshot().points.at(-1).values[slowKey], 90);
  } finally {
    instance.dispose();
  }
});
