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
    path.join(import.meta.dirname, ".output-identity-source-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-output-identity-package-"),
  );
  try {
    const source = path.join(sourceDirectory, "indicator.ts");
    await writeFile(source, sourceText, "utf8");
    const result = await buildIndicatorPackage({
      source,
      outputRoot: path.join(outputDirectory, "package"),
      id,
      version: "0.1.0",
    });
    const entry = await readFile(
      path.join(result.packageRoot, result.manifest.entry),
    );
    return await import(
      `data:text/javascript;base64,${entry.toString("base64")}`
    );
  } finally {
    await rm(sourceDirectory, { recursive: true, force: true });
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

test("plot identity survives reordering", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
function fast(value) { plot.line(value, { key: "fast", title: "Fast" }); }
function slow(value) { plot.line(value * 10, { key: "slow", title: "Slow" }); }
export default defineIndicator(
  { id: "erc.indicator.output-identity.main", name: "Output identity" },
  ({ close }) => {
    if (close > 15) { slow(close); fast(close); }
    else { fast(close); slow(close); }
  },
);
`,
    "erc.indicator.output-identity",
  );

  const fast = plugin.definition.plots.find(
    (value) => value.outputKey === "fast",
  );
  const slow = plugin.definition.plots.find(
    (value) => value.outputKey === "slow",
  );
  assert.match(fast.key, /^erc-v2-plot-[0-9a-f]{24}$/u);
  assert.match(slow.key, /^erc-v2-plot-[0-9a-f]{24}$/u);

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 20), candle(2, 10)]);
    const points = instance.snapshot().points;
    assert.deepEqual(
      points.map((point) => point.values.fast),
      [10, 20, 10],
    );
    assert.deepEqual(
      points.map((point) => point.values.slow),
      [100, 200, 100],
    );
  } finally {
    instance.dispose();
  }
});

test("unkeyed plot outputs follow compiler identity when execution order changes", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
function fast(value) { plot.line(value, { title: "Fast" }); }
function slow(value) { plot.line(value * 10, { title: "Slow" }); }
export default defineIndicator(
  { id: "erc.indicator.unkeyed-output-identity.main", name: "Unkeyed output identity" },
  ({ close }) => {
    if (close > 15) { slow(close); fast(close); }
    else { fast(close); slow(close); }
  },
);
`,
    "erc.indicator.unkeyed-output-identity",
  );

  const fast = plugin.definition.plots.find((value) => value.label === "Fast");
  const slow = plugin.definition.plots.find((value) => value.label === "Slow");
  assert.equal(fast.outputKey, "plot_0");
  assert.equal(slow.outputKey, "plot_1");
  assert.match(fast.key, /^erc-v2-plot-[0-9a-f]{24}$/u);
  assert.match(slow.key, /^erc-v2-plot-[0-9a-f]{24}$/u);

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 20), candle(2, 10)]);
    const points = instance.snapshot().points;
    assert.deepEqual(
      points.map((point) => point.values.plot_0),
      [10, 20, 10],
    );
    assert.deepEqual(
      points.map((point) => point.values.plot_1),
      [100, 200, 100],
    );
  } finally {
    instance.dispose();
  }
});

test("compiler rejects dynamic plot options that can omit an explicit key", async () => {
  await assert.rejects(
    () =>
      packagedPlugin(
        `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
export default defineIndicator(
  { id: "erc.indicator.plot-key-contract.main", name: "Plot key contract" },
  ({ close }) => {
    plot.line(
      close,
      close > 15 ? { title: "Stable" } : { key: "stable", title: "Stable" },
    );
  },
);
`,
        "erc.indicator.plot-key-contract",
      ),
    /Plot options must use an object literal so declaration metadata can be compiled\./u,
  );
});

test("compiler rejects dynamic plot options that can omit an explicit title", async () => {
  await assert.rejects(
    () =>
      packagedPlugin(
        `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
export default defineIndicator(
  { id: "erc.indicator.plot-title-contract.main", name: "Plot title contract" },
  ({ close }) => {
    plot.line(
      close,
      close > 15 ? { key: "stable" } : { key: "stable", title: "Stable" },
    );
  },
);
`,
        "erc.indicator.plot-title-contract",
      ),
    /Plot options must use an object literal so declaration metadata can be compiled\./u,
  );
});

test("drawing identity survives reordering", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
function fast(value, openTimeMs) {
  plot.box({ left: openTimeMs, right: openTimeMs + 60_000, top: value, bottom: value - 1, color: "#008800" });
}
function slow(value, openTimeMs) {
  plot.box({ left: openTimeMs, right: openTimeMs + 60_000, top: value * 10, bottom: value * 10 - 1, color: "#880000" });
}
export default defineIndicator(
  { id: "erc.indicator.drawing-identity.main", name: "Drawing identity" },
  ({ close, openTimeMs }) => {
    if (close > 15) { slow(close, openTimeMs); fast(close, openTimeMs); }
    else { fast(close, openTimeMs); slow(close, openTimeMs); }
  },
);
`,
    "erc.indicator.drawing-identity",
  );

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 10)]);
    let overlays = instance.snapshot().overlays;
    const fast = overlays.find((overlay) => overlay.color === "#008800");
    const slow = overlays.find((overlay) => overlay.color === "#880000");
    assert.ok(fast);
    assert.ok(slow);
    assert.notEqual(fast.id, slow.id);
    assert.equal(fast.top, 10);
    assert.equal(slow.top, 100);

    instance.onBuildingBar(candle(1, 20));
    overlays = instance.snapshot().overlays;
    const reorderedFast = overlays.find(
      (overlay) => overlay.color === "#008800",
    );
    const reorderedSlow = overlays.find(
      (overlay) => overlay.color === "#880000",
    );
    assert.equal(reorderedFast?.id, fast.id);
    assert.equal(reorderedSlow?.id, slow.id);
    assert.equal(reorderedFast?.top, 20);
    assert.equal(reorderedSlow?.top, 200);
  } finally {
    instance.dispose();
  }
});

test("signal identity survives reordering", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
function fastSignal() { signal(true, "long"); }
function slowSignal() { signal(true, "short"); }
export default defineIndicator(
  { id: "erc.indicator.signal-identity.main", name: "Signal identity" },
  ({ close }) => {
    if (close > 15) { slowSignal(); fastSignal(); }
    else { fastSignal(); slowSignal(); }
  },
);
`,
    "erc.indicator.signal-identity",
  );

  const instance = plugin.createInstance({}, context);
  try {
    instance.onHistory([candle(0, 10), candle(1, 20), candle(2, 10)]);
    const signals = instance.snapshot().signals ?? [];
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

test("signal rejects a repeated compiler identity in one finalized bar", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, signal } from "@erc-chart/indicator-sdk";
function emitTwice() {
  for (let index = 0; index < 2; index += 1) signal(true, "long");
}
export default defineIndicator(
  { id: "erc.indicator.signal-identity-collision.main", name: "Signal identity collision" },
  ({ isConfirmed }) => {
    if (isConfirmed) emitTwice();
  },
);
`,
    "erc.indicator.signal-identity-collision",
  );

  const instance = plugin.createInstance({}, context);
  try {
    assert.throws(
      () => instance.onHistory([candle(0, 10), candle(1, 11)]),
      /Compiler call-site identity .* for signal executed more than once in one finalized bar\./u,
    );
  } finally {
    instance.dispose();
  }
});

test("packaged v2 runtime rejects a missing compiler identity", async () => {
  await assert.rejects(
    () =>
      packagedPlugin(
        `import { defineIndicator, plot, signal } from "@erc-chart/indicator-sdk";
const emit = signal;
export default defineIndicator(
  { id: "erc.indicator.missing-identity.main", name: "Missing identity" },
  ({ close }) => {
    plot.line(close);
    emit(close > 0, "long");
  },
);
`,
        "erc.indicator.missing-identity",
      ),
    /Missing compiler call-site identity for signal; rebuild the indicator package with the SDK v2 authoring compiler/u,
  );
});
