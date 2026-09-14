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

const callbackSource = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
const calculate = ({ close }) => close[1];
export default defineIndicator(
  { id: "erc.indicator.referenced.main", name: "Referenced" },
  calculate,
);
`;

function cleanup(t, directory) {
  t.after(() => rm(directory, { recursive: true, force: true }));
}

test("lowers a referenced callback", () => {
  const result = transformIndicatorHistory(callbackSource, "referenced.ts");
  assert.equal(result.changed, true);
  assert.match(result.code, /__ercHistory\(close, 1\)/u);
});

test("rejects an unresolved referenced callback", () => {
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
import { calculate } from "./calculate.js";
defineIndicator({ id: "fixture", name: "Fixture" }, calculate);
`;
  assert.throws(
    () => transformIndicatorHistory(source, "unresolved.ts"),
    /defineIndicator callback reference "calculate" must be declared in the same module/u,
  );
});

test("covers plugin root filtering and loaders", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-history-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "erc-history-out-"));
  cleanup(t, root);
  cleanup(t, outside);

  let load;
  indicatorHistoryTransformPlugin({ sourceRoot: root }).setup({
    onLoad(_options, callback) {
      load = callback;
    },
  });
  assert.equal(typeof load, "function");
  const outsideFile = path.join(outside, "outside.ts");
  assert.equal(await load({ path: outsideFile }), undefined);

  const dependencyRoot = path.join(root, "node_modules", "dependency");
  await mkdir(dependencyRoot, { recursive: true });
  const dependencyFile = path.join(dependencyRoot, "indicator.ts");
  await writeFile(
    dependencyFile,
    `import { defineIndicator } from "@erc-chart/indicator-sdk";\ndefineIndicator({ id: "dependency", name: "Dependency" }, ({ close }) => close[1]);\n`,
    "utf8",
  );
  assert.equal(await load({ path: dependencyFile }), undefined);

  const cases = [
    ["tsx", "tsx"],
    ["jsx", "jsx"],
    ["mjs", "js"],
  ];
  for (const [extension, expected] of cases) {
    const file = path.join(root, `indicator.${extension}`);
    await writeFile(
      file,
      `import { defineIndicator } from "@erc-chart/indicator-sdk";\ndefineIndicator({ id: "fixture", name: "Fixture" }, ({ close }) => close[1]);\n`,
      "utf8",
    );
    const loaded = await load({ path: file });
    assert.equal(loaded?.loader, expected);
    assert.match(loaded?.contents ?? "", /__ercHistory\(close, 1\)/u);
  }
});

test("covers the authoring package root", async (t) => {
  const root = await mkdtemp(
    path.join(import.meta.dirname, ".history-review-root-"),
  );
  const output = await mkdtemp(path.join(os.tmpdir(), "erc-author-out-"));
  cleanup(t, root);
  cleanup(t, output);

  await writeFile(
    path.join(root, "package.json"),
    '{"name":"history-fixture","private":true,"type":"module"}\n',
    "utf8",
  );
  const src = path.join(root, "src");
  const shared = path.join(root, "shared");
  await mkdir(src, { recursive: true });
  await mkdir(shared, { recursive: true });
  await writeFile(
    path.join(shared, "indicator.ts"),
    `import { defineIndicator, plot } from "@erc-chart/indicator-sdk";\nexport default defineIndicator(\n  { id: "erc.indicator.history-root.main", name: "History root" },\n  ({ close }) => { plot.line(close[1], { key: "history" }); },\n);\n`,
    "utf8",
  );
  const source = path.join(src, "index.ts");
  await writeFile(
    source,
    'export { default } from "../shared/indicator.ts";\n',
    "utf8",
  );

  const result = await buildIndicatorPackage({
    source,
    outputRoot: path.join(output, "package"),
    id: "erc.indicator.history-root",
    version: "0.1.0",
  });
  const entry = await readFile(
    path.join(result.packageRoot, result.manifest.entry),
    "utf8",
  );
  assert.doesNotMatch(entry, /\bclose\[1\]/u);
});
