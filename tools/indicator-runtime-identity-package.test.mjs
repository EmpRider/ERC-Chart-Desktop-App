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

test("input replay rejects changed constraints and nested string options at one compiler identity", async () => {
  const { default: numericPlugin } = await packagedPlugin(
    `import { defineIndicator, input, plot } from "@erc-chart/indicator-sdk";
export default defineIndicator(
  { id: "erc.indicator.runtime-identity-input-contract-number.main", name: "Runtime identity numeric input contract" },
  ({ close }) => {
    const length = input.float(5, {
      title: "Length",
      min: close > 15 ? 2 : 1,
      max: 20,
      step: 0.5,
    });
    plot.line(length, { key: "result", title: "Result" });
  },
);
`,
    "erc.indicator.runtime-identity-input-contract-number",
  );

  const numericInstance = numericPlugin.createInstance({}, context);
  try {
    assert.throws(
      () => numericInstance.onHistory([candle(0, 10), candle(1, 20)]),
      /Input declaration identity .* does not match the discovered input contract\./u,
    );
  } finally {
    numericInstance.dispose();
  }

  const { default: stringPlugin } = await packagedPlugin(
    `import { defineIndicator, input, plot } from "@erc-chart/indicator-sdk";
export default defineIndicator(
  { id: "erc.indicator.runtime-identity-input-contract-string.main", name: "Runtime identity string input contract" },
  ({ close }) => {
    const source = input.string("close", {
      title: "Source",
      options: close > 15
        ? [{ value: "close", label: "Close" }, { value: "high", label: "High" }]
        : [{ value: "close", label: "Close" }, { value: "open", label: "Open" }],
    });
    plot.line(source === "close" ? close : 0, { key: "result", title: "Result" });
  },
);
`,
    "erc.indicator.runtime-identity-input-contract-string",
  );

  const stringInstance = stringPlugin.createInstance({}, context);
  try {
    assert.throws(
      () => stringInstance.onHistory([candle(0, 10), candle(1, 20)]),
      /Input declaration identity .* does not match the discovered input contract\./u,
    );
  } finally {
    stringInstance.dispose();
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
