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
