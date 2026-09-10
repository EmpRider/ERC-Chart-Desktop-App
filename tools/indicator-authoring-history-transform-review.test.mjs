import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";
import {
  indicatorHistoryTransformPlugin,
  transformIndicatorHistory,
} from "./indicator-authoring/history-transform.mjs";

const authoredSource = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
const calculate = ({ close }) => close[1];
export default defineIndicator(
  { id: "erc.indicator.referenced.main", name: "Referenced" },
  calculate,
);
`;

test("lowers history in a locally referenced indicator callback", () => {
  const transformed = transformIndicatorHistory(
    authoredSource,
    "referenced.ts",
  );
  assert.equal(transformed.changed, true);
  assert.match(transformed.code, /__ercHistory\(close, 1\)/u);
});

test(
  "plugin wrapper filters outside files and preserves loader selection",
  async (t) => {
    const sourceRoot = await mkdtemp(
      path.join(os.tmpdir(), "erc-history-plugin-root-"),
    );
    const outsideRoot = await mkdtemp(
      path.join(os.tmpdir(), "erc-history-plugin-outside-"),
    );
    t.after(() => rm(sourceRoot, { recursive: true, force: true }));
    t.after(() => rm(outsideRoot, { recursive: true, force: true }));

    let onLoad;
    indicatorHistoryTransformPlugin({ sourceRoot }).setup({
      onLoad(_options, callback) {
        onLoad = callback;
      },
    });
    assert.equal(typeof onLoad, "function");
    assert.equal(
      await onLoad({ path: path.join(outsideRoot, "outside.ts") }),
      undefined,
    );

    for (const [extension, expectedLoader] of [
      ["tsx", "tsx"],
      ["jsx", "jsx"],
      ["mjs", "js"],
    ]) {
      const file = path.join(sourceRoot, `indicator.${extension}`);
      await writeFile(
        file,
        `import { defineIndicator } from "@erc-chart/indicator-sdk";\ndefineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => close[1]);\n`,
        "utf8",
      );
      const loaded = await onLoad({ path: file });
      assert.equal(loaded?.loader, expectedLoader);
      assert.match(loaded?.contents ?? "", /__ercHistory\(close, 1\)/u);
    }
  },
);

test(
  "package build transforms indicator modules across the authoring package root",
  async (t) => {
    const authoringRoot = await mkdtemp(
      path.join(os.tmpdir(), "erc-history-authoring-root-"),
    );
    const outputRoot = await mkdtemp(
      path.join(os.tmpdir(), "erc-history-authoring-output-"),
    );
    t.after(() => rm(authoringRoot, { recursive: true, force: true }));
    t.after(() => rm(outputRoot, { recursive: true, force: true }));

    await writeFile(
      path.join(authoringRoot, "package.json"),
      '{"name":"history-authoring-fixture","private":true,"type":"module"}\n',
      "utf8",
    );
    await mkdir(path.join(authoringRoot, "src"), { recursive: true });
    await mkdir(path.join(authoringRoot, "shared"), { recursive: true });
    await writeFile(
      path.join(authoringRoot, "shared", "indicator.ts"),
      `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";\nexport default defineIndicator(\n  { id: "erc.indicator.history-root.main", name: "History root" },\n  ({ close }) => { plot.line(close[1], { key: "history" }); },\n);\n`,
      "utf8",
    );
    const source = path.join(authoringRoot, "src", "index.ts");
    await writeFile(
      source,
      'export { default } from "../shared/indicator.ts";\n',
      "utf8",
    );

    const result = await buildIndicatorPackage({
      source,
      outputRoot: path.join(outputRoot, "package"),
      id: "erc.indicator.history-root",
      version: "0.1.0",
    });
    const entry = await readFile(
      path.join(result.packageRoot, result.manifest.entry),
      "utf8",
    );
    assert.doesNotMatch(entry, /\bclose\[1\]/u);
  },
);
