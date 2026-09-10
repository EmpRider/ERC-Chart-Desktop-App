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
    path.join(import.meta.dirname, ".runtime-identity-source-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-runtime-identity-package-"),
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

test("persisted inputs follow compiler identity when declaration execution order changes", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, input, plot } from "@erc-chart/indicator-sdk";

function fastLength() {
  return input.int(2, { title: "Fast Length", min: 1, max: 20 });
}
function slowLength() {
  return input.int(3, { title: "Slow Length", min: 1, max: 20 });
}

export default defineIndicator(
  { id: "erc.indicator.runtime-identity-input.main", name: "Runtime identity input" },
  ({ close }) => {
    let fast;
    let slow;
    if (close > 15) {
      slow = slowLength();
      fast = fastLength();
    } else {
      fast = fastLength();
      slow = slowLength();
    }
    plot.line(fast * 100 + slow, { key: "result", title: "Result" });
  },
);
`,
    "erc.indicator.runtime-identity-input",
  );

  const fast = plugin.definition.inputs.find(
    (definition) => definition.label === "Fast Length",
  );
  const slow = plugin.definition.inputs.find(
    (definition) => definition.label === "Slow Length",
  );
  assert.ok(fast);
  assert.ok(slow);
  assert.match(fast.key, /^erc-v2-input-[0-9a-f]{24}$/u);
  assert.match(slow.key, /^erc-v2-input-[0-9a-f]{24}$/u);
  assert.notEqual(fast.key, slow.key);

  const instance = plugin.createInstance(
    { [fast.key]: 7, [slow.key]: 9 },
    context,
  );
  try {
    instance.onHistory([candle(0, 10), candle(1, 20), candle(2, 10)]);
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values.result),
      [709, 709, 709],
    );
  } finally {
    instance.dispose();
  }
});

test("recurrence state follows compiler identity when execution order changes", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, plot, series } from "@erc-chart/indicator-sdk";

function fastState() {
  return series(0, (previous) => previous + 1);
}
function slowState() {
  return series(100, (previous) => previous + 10);
}

export default defineIndicator(
  { id: "erc.indicator.runtime-identity-series.main", name: "Runtime identity series" },
  ({ close }) => {
    let fast;
    let slow;
    if (close > 15) {
      slow = slowState();
      fast = fastState();
    } else {
      fast = fastState();
      slow = slowState();
    }
    plot.line(fast * 1_000 + slow, { key: "result", title: "Result" });
  },
);
`,
    "erc.indicator.runtime-identity-series",
  );

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 20), candle(2, 10)]);
    assert.deepEqual(
      instance.snapshot().points.map((point) => point.values.result),
      [1_110, 2_120, 3_130],
    );
  } finally {
    instance.dispose();
  }
});

test("TA state follows compiler identity when execution order changes", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, plot, ta } from "@erc-chart/indicator-sdk";

function fastAverage(value) {
  return ta.ema(value, 2);
}
function slowAverage(value) {
  return ta.ema(value * 10, 2);
}

export default defineIndicator(
  { id: "erc.indicator.runtime-identity-ta.main", name: "Runtime identity TA" },
  ({ close }) => {
    let fast;
    let slow;
    if (close > 15) {
      slow = slowAverage(close);
      fast = fastAverage(close);
    } else {
      fast = fastAverage(close);
      slow = slowAverage(close);
    }
    plot.line(fast, { key: "fast", title: "Fast" });
    plot.line(slow, { key: "slow", title: "Slow" });
  },
);
`,
    "erc.indicator.runtime-identity-ta",
  );

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 20), candle(2, 10)]);
    const points = instance.snapshot().points;
    assert.equal(points[0].values.fast, null);
    assert.equal(points[0].values.slow, null);
    assert.equal(points[1].values.fast, 15);
    assert.equal(points[1].values.slow, 150);
    assert.ok(Math.abs(points[2].values.fast - 35 / 3) < 1e-12);
    assert.ok(Math.abs(points[2].values.slow - 350 / 3) < 1e-12);
  } finally {
    instance.dispose();
  }
});

test("plot outputs follow compiler identity when execution order changes", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

function fastPlot(value) {
  plot.line(value, { key: "fast", title: "Fast" });
}
function slowPlot(value) {
  plot.line(value * 10, { key: "slow", title: "Slow" });
}

export default defineIndicator(
  { id: "erc.indicator.runtime-identity-plot.main", name: "Runtime identity plot" },
  ({ close }) => {
    if (close > 15) {
      slowPlot(close);
      fastPlot(close);
    } else {
      fastPlot(close);
      slowPlot(close);
    }
  },
);
`,
    "erc.indicator.runtime-identity-plot",
  );

  const fast = plugin.definition.plots.find(
    (definition) => definition.outputKey === "fast",
  );
  const slow = plugin.definition.plots.find(
    (definition) => definition.outputKey === "slow",
  );
  assert.ok(fast);
  assert.ok(slow);
  assert.match(fast.key, /^erc-v2-plot-[0-9a-f]{24}$/u);
  assert.match(slow.key, /^erc-v2-plot-[0-9a-f]{24}$/u);
  assert.notEqual(fast.key, slow.key);

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 20), candle(2, 10)]);
    const points = instance.snapshot().points;
    assert.deepEqual(points.map((point) => point.values.fast), [10, 20, 10]);
    assert.deepEqual(points.map((point) => point.values.slow), [100, 200, 100]);
  } finally {
    instance.dispose();
  }
});

test("drawing scope state follows compiler identity when execution order changes", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

function fastDraw(value, openTimeMs) {
  plot.drawings("fast", () => {
    plot.box({
      id: "fast-zone",
      startTimeMs: openTimeMs,
      endTimeMs: openTimeMs + 60_000,
      top: value,
      bottom: value - 1,
      color: "#008800",
    });
  });
}
function slowDraw(value, openTimeMs) {
  plot.drawings("slow", () => {
    plot.box({
      id: "slow-zone",
      startTimeMs: openTimeMs,
      endTimeMs: openTimeMs + 60_000,
      top: value * 10,
      bottom: value * 10 - 1,
      color: "#880000",
    });
  });
}

export default defineIndicator(
  { id: "erc.indicator.runtime-identity-drawing.main", name: "Runtime identity drawing" },
  ({ close, openTimeMs }) => {
    if (close > 15) {
      slowDraw(close, openTimeMs);
      fastDraw(close, openTimeMs);
    } else {
      fastDraw(close, openTimeMs);
      slowDraw(close, openTimeMs);
    }
  },
);
`,
    "erc.indicator.runtime-identity-drawing",
  );

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 20), candle(2, 10)]);
    const overlays = instance.snapshot().overlays;
    assert.equal(overlays.length, 2);
    assert.equal(
      overlays.find((overlay) => overlay.id === "fast-zone")?.top,
      10,
    );
    assert.equal(
      overlays.find((overlay) => overlay.id === "slow-zone")?.top,
      100,
    );
  } finally {
    instance.dispose();
  }
});

test("signals follow compiler identity when execution order changes", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, signal } from "@erc-chart/indicator-sdk";

function fastSignal() {
  signal(true, "long");
}
function slowSignal() {
  signal(true, "short");
}

export default defineIndicator(
  { id: "erc.indicator.runtime-identity-signal.main", name: "Runtime identity signal" },
  ({ close }) => {
    if (close > 15) {
      slowSignal();
      fastSignal();
    } else {
      fastSignal();
      slowSignal();
    }
  },
);
`,
    "erc.indicator.runtime-identity-signal",
  );

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 20), candle(2, 10)]);
    const signals = instance.snapshot().signals;
    assert.equal(signals.length, 4);
    const long = signals.filter((value) => value.direction === "long");
    const short = signals.filter((value) => value.direction === "short");
    assert.equal(long.length, 2);
    assert.equal(short.length, 2);
    const callsite = (id) => id.slice(0, id.lastIndexOf(":"));
    assert.match(callsite(long[0].id), /^erc-v2-signal-[0-9a-f]{24}$/u);
    assert.equal(callsite(long[0].id), callsite(long[1].id));
    assert.equal(callsite(short[0].id), callsite(short[1].id));
    assert.notEqual(callsite(long[0].id), callsite(short[0].id));
  } finally {
    instance.dispose();
  }
});
