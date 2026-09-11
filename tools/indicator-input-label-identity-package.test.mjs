import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

async function packagedPlugin(sourceText, id) {
  const sourceDirectory = await mkdtemp(
    path.join(import.meta.dirname, ".input-label-identity-source-"),
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "erc-input-label-identity-package-"),
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

test("compiler input identities do not leak into default settings labels", async () => {
  const { default: plugin } = await packagedPlugin(
    `import { defineIndicator, input, plot } from "@erc-chart/indicator-sdk";

export default defineIndicator(
  { id: "erc.indicator.input-label-identity.main", name: "Input label identity" },
  () => {
    const implicit = input.int(5);
    const keyed = input.float(2, { key: "source" });
    const titled = input.bool(true, { title: "Enabled" });
    plot.line(implicit + keyed + (titled ? 1 : 0), { key: "result", title: "Result" });
  },
);
`,
    "erc.indicator.input-label-identity",
  );

  assert.deepEqual(
    plugin.definition.inputs.map(({ label }) => label),
    ["input_0", "source", "Enabled"],
  );
  for (const definition of plugin.definition.inputs)
    assert.match(definition.key, /^erc-v2-input-[0-9a-f]{24}$/u);
});
