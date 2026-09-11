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

async function packagedPlugin(sourceText, id) {
  const sourceDirectory = await mkdtemp(
    path.join(import.meta.dirname, ".conditional-authoring-source-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-conditional-authoring-package-"),
  );
  try {
    const source = path.join(sourceDirectory, "indicator.ts");
    await writeFile(source, sourceText, "utf8");
    const { manifest, packageRoot } = await buildIndicatorPackage({
      source,
      outputRoot: path.join(outputDirectory, "package"),
      id,
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

test("conditional recurrence preserves its state and later recurrence identities", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, plot, series } from "@erc-chart/indicator-sdk";

function optionalState() {
  return series(0, (previous) => previous + 1);
}
function alwaysState() {
  return series(100, (previous) => previous + 10);
}

export default defineIndicator(
  { id: "erc.indicator.conditional-series.main", name: "Conditional series" },
  ({ close }) => {
    const optional = close > 15 ? optionalState() : null;
    const always = alwaysState();
    plot.line(optional, { key: "optional", title: "Optional" });
    plot.line(always, { key: "always", title: "Always" });
  },
);
`,
    "erc.indicator.conditional-series",
  );

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([
      candle(0, 10),
      candle(1, 20),
      candle(2, 10),
      candle(3, 30),
    ]);
    const points = instance.snapshot().points;
    assert.deepEqual(
      points.map((point) => point.values.optional),
      [null, 1, null, 2],
    );
    assert.deepEqual(
      points.map((point) => point.values.always),
      [110, 120, 130, 140],
    );
  } finally {
    instance.dispose();
  }
});

test("conditional TA preserves its state and later TA identities", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, plot, ta } from "@erc-chart/indicator-sdk";

function optionalAverage(value) {
  return ta.ema(value, 2);
}
function alwaysAverage(value) {
  return ta.ema(value, 2);
}

export default defineIndicator(
  { id: "erc.indicator.conditional-ta.main", name: "Conditional TA" },
  ({ close }) => {
    const optional = close > 15 ? optionalAverage(close) : null;
    const always = alwaysAverage(close);
    plot.line(optional, { key: "optional", title: "Optional" });
    plot.line(always, { key: "always", title: "Always" });
  },
);
`,
    "erc.indicator.conditional-ta",
  );

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([
      candle(0, 10),
      candle(1, 20),
      candle(2, 10),
      candle(3, 30),
    ]);
    const points = instance.snapshot().points;
    assert.deepEqual(
      points.map((point) => point.values.optional),
      [null, null, null, 25],
    );
    assert.equal(points[0].values.always, null);
    assert.equal(points[1].values.always, 15);
    assert.ok(Math.abs(points[2].values.always - 35 / 3) < 1e-12);
    assert.ok(Math.abs(points[3].values.always - 215 / 9) < 1e-12);
  } finally {
    instance.dispose();
  }
});

test("conditional plot omission preserves declaration metadata and later plot identities", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

function optionalPlot(value) {
  plot.line(value, {
    key: "optional",
    title: "Optional",
    color: "#1188cc",
    width: 2,
    style: "dashed",
  });
}
function alwaysPlot(value) {
  plot.line(value * 10, { key: "always", title: "Always" });
}

export default defineIndicator(
  { id: "erc.indicator.conditional-plot.main", name: "Conditional plot" },
  ({ close }) => {
    if (close < 15) optionalPlot(close);
    alwaysPlot(close);
  },
);
`,
    "erc.indicator.conditional-plot",
  );

  const optional = plugin.definition.plots.find(
    (value) => value.outputKey === "optional",
  );
  assert.equal(optional?.kind, "line");
  assert.equal(optional?.label, "Optional");
  assert.equal(optional?.color, "#1188cc");
  assert.equal(optional?.width, 2);
  assert.equal(optional?.style, "dashed");

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([
      candle(0, 10),
      candle(1, 20),
      candle(2, 10),
      candle(3, 30),
    ]);
    const points = instance.snapshot().points;
    assert.deepEqual(
      points.map((point) => point.values.optional),
      [10, undefined, 10, undefined],
    );
    assert.deepEqual(
      points.map((point) => point.values.always),
      [100, 200, 100, 300],
    );
  } finally {
    instance.dispose();
  }
});

test("a conditional plot skipped during discovery is still declared and may execute later", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

function latePlot(value) {
  plot.line(value, { key: "late", title: "Late", style: "dotted" });
}
function alwaysPlot(value) {
  plot.line(value * 10, { key: "always", title: "Always" });
}

export default defineIndicator(
  { id: "erc.indicator.late-conditional-plot.main", name: "Late conditional plot" },
  ({ close }) => {
    if (close > 15) latePlot(close);
    alwaysPlot(close);
  },
);
`,
    "erc.indicator.late-conditional-plot",
  );

  const late = plugin.definition.plots.find(
    (value) => value.outputKey === "late",
  );
  assert.equal(late?.kind, "line");
  assert.equal(late?.label, "Late");
  assert.equal(late?.style, "dotted");
  assert.ok(plugin.definition.outputs.some((value) => value.key === "late"));

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([
      candle(0, 10),
      candle(1, 20),
      candle(2, 10),
      candle(3, 30),
    ]);
    const points = instance.snapshot().points;
    assert.deepEqual(
      points.map((point) => point.values.late),
      [undefined, 20, undefined, 30],
    );
    assert.deepEqual(
      points.map((point) => point.values.always),
      [100, 200, 100, 300],
    );
  } finally {
    instance.dispose();
  }
});

test("conditional signals emit only when executed on finalized bars and keep later identities stable", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, signal } from "@erc-chart/indicator-sdk";

function optionalSignal() {
  signal(true, "long");
}
function alwaysSignal() {
  signal(true, "short");
}

export default defineIndicator(
  { id: "erc.indicator.conditional-signal.main", name: "Conditional signal" },
  ({ close }) => {
    if (close < 15) optionalSignal();
    alwaysSignal();
  },
);
`,
    "erc.indicator.conditional-signal",
  );

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([
      candle(0, 10),
      candle(1, 20),
      candle(2, 10),
      candle(3, 30),
    ]);
    const signals = instance.snapshot().signals ?? [];
    const long = signals.filter((value) => value.direction === "long");
    const short = signals.filter((value) => value.direction === "short");
    assert.equal(long.length, 2);
    assert.equal(short.length, 3);
    const callsite = (id) => id.slice(0, id.lastIndexOf(":"));
    assert.match(callsite(long[0].id), /^erc-v2-signal-[0-9a-f]{24}$/u);
    assert.equal(callsite(long[0].id), callsite(long[1].id));
    assert.equal(callsite(short[0].id), callsite(short[1].id));
    assert.equal(callsite(short[1].id), callsite(short[2].id));
    assert.notEqual(callsite(long[0].id), callsite(short[0].id));
  } finally {
    instance.dispose();
  }
});

test("conditional drawing scopes preserve committed geometry while omitted and reconcile on return", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

function optionalDrawings(value, openTimeMs) {
  plot.drawings("optional", () => {
    plot.box({
      id: "optional-zone",
      startTimeMs: openTimeMs,
      endTimeMs: openTimeMs + 60_000,
      top: value,
      bottom: value - 1,
      color: "#008800",
    });
  });
}
function alwaysDrawings(value, openTimeMs) {
  plot.drawings("always", () => {
    plot.box({
      id: "always-zone",
      startTimeMs: openTimeMs,
      endTimeMs: openTimeMs + 60_000,
      top: value * 10,
      bottom: value * 10 - 1,
      color: "#880000",
    });
  });
}

export default defineIndicator(
  { id: "erc.indicator.conditional-drawings.main", name: "Conditional drawings" },
  ({ close, openTimeMs }) => {
    if (close < 15) optionalDrawings(close, openTimeMs);
    alwaysDrawings(close, openTimeMs);
  },
);
`,
    "erc.indicator.conditional-drawings",
  );

  const instance = plugin.createInstance({}, context);
  const overlay = (id) =>
    instance.snapshot().overlays.find((value) => value.id === id);
  try {
    instance.onHistory([candle(0, 10), candle(1, 20)]);
    assert.equal(overlay("optional-zone")?.top, 10);
    assert.equal(overlay("always-zone")?.top, 200);

    instance.onFinalizedBar(candle(1, 20));
    assert.equal(overlay("optional-zone")?.top, 10);
    assert.equal(overlay("always-zone")?.top, 200);

    instance.onBuildingBar(candle(2, 11));
    assert.equal(overlay("optional-zone")?.top, 11);
    assert.equal(overlay("always-zone")?.top, 110);

    instance.onBuildingBar(candle(2, 20));
    assert.equal(overlay("optional-zone")?.top, 10);
    assert.equal(overlay("always-zone")?.top, 200);

    instance.onFinalizedBar(candle(2, 11));
    assert.equal(overlay("optional-zone")?.top, 11);
    assert.equal(overlay("always-zone")?.top, 110);

    instance.onBuildingBar(candle(3, 20));
    assert.equal(overlay("optional-zone")?.top, 11);
    assert.equal(overlay("always-zone")?.top, 200);
  } finally {
    instance.dispose();
  }
});
