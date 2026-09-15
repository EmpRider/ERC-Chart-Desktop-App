import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function packagedPlugin(sourceText) {
  const sourceDirectory = await mkdtemp(
    path.join(import.meta.dirname, ".top-level-authoring-source-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-top-level-authoring-package-"),
  );
  try {
    const source = path.join(sourceDirectory, "indicator.ts");
    await writeFile(source, sourceText, "utf8");
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
