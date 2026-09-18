import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

async function loadTransform() {
  try {
    return await import("./indicator-authoring-transform.mjs");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return undefined;
    throw error;
  }
}

function cleanup(t, directory) {
  t.after(() => rm(directory, { recursive: true, force: true }));
}

function defineIndicatorCall(sourceText) {
  const sourceFile = ts.createSourceFile(
    "src/index.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let result;
  const visit = (node) => {
    if (
      result === undefined &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineIndicator"
    )
      result = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { sourceFile, call: result };
}

test("lowers top-level Pine-style authoring into the hidden runtime callback", async () => {
  const module = await loadTransform();
  assert.equal(typeof module?.transformIndicatorAuthoring, "function");
  const source = `
import { defineIndicator, input, plot, ta } from "@erc-chart/indicator-sdk";

export default defineIndicator({ id: "fixture", name: "Fixture" });

const length = input.int(14, "Length");
const source = input.source(close, "Source");
const average = ta.ema(source, length);
plot.line(average, { title: "Average" });
`;

  const result = module.transformIndicatorAuthoring(source, {
    fileName: "src/index.ts",
    sourceFileId: "src/index.ts",
  });
  const parsed = defineIndicatorCall(result.code);

  assert.equal(result.changed, true);
  assert.deepEqual(
    result.callsites.map((value) => value.callee),
    ["input.int", "input.source", "ta.ema", "plot.line"],
  );
  assert.equal(
    result.callsites.find((value) => value.callee === "input.source")
      ?.seriesSource,
    "close",
  );
  assert.ok(parsed.call, "compiled source must retain defineIndicator");
  assert.equal(
    parsed.call.arguments.length,
    2,
    "metadata-only authoring must gain one hidden calculation callback",
  );
  const callback = parsed.call.arguments[1];
  assert.ok(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback));
  const callbackText = callback.getText(parsed.sourceFile);
  assert.match(callbackText, /\binput\.int\(14,\s*"Length"/u);
  assert.match(callbackText, /\binput\.source\(close,\s*"Source"/u);
  assert.match(callbackText, /\bta\.ema\(source,\s*length/u);
  assert.match(callbackText, /\bplot\.line\(average/u);
  assert.match(callbackText, /\bclose\b/u);
  assert.match(callbackText, /\bbar\b/u);
});

test("rejects a post-metadata bar binding reserved by the hidden runtime callback", async () => {
  const module = await loadTransform();
  const source = `
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

export default defineIndicator({ id: "fixture", name: "Fixture" });

const bar = 1;
plot.line(bar);
`;

  assert.throws(
    () =>
      module.transformIndicatorAuthoring(source, {
        fileName: "src/reserved-bar.ts",
        sourceFileId: "src/reserved-bar.ts",
      }),
    /"bar" is reserved by the indicator runtime/u,
  );
});

test("rejects post-metadata bindings reserved by the hidden runtime series callback", async () => {
  const module = await loadTransform();
  for (const reservedName of [
    "open",
    "high",
    "low",
    "close",
    "volume",
    "hl2",
    "hlc3",
    "ohlc4",
  ]) {
    const source = `
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

export default defineIndicator({ id: "fixture", name: "Fixture" });

const ${reservedName} = 1;
plot.line(${reservedName});
`;

    assert.throws(
      () =>
        module.transformIndicatorAuthoring(source, {
          fileName: `src/reserved-${reservedName}.ts`,
          sourceFileId: `src/reserved-${reservedName}.ts`,
        }),
      new RegExp(`"${reservedName}" is reserved by the indicator runtime`, "u"),
    );
  }
});

test("allows a pre-metadata module binding named bar", async () => {
  const module = await loadTransform();
  const source = `
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

const bar = { title: "Fixture" };
export default defineIndicator({ id: "fixture", name: bar.title });

plot.line(close);
`;

  const result = module.transformIndicatorAuthoring(source, {
    fileName: "src/module-bar.ts",
    sourceFileId: "src/module-bar.ts",
  });

  assert.equal(result.changed, true);
  assert.match(result.code, /const bar = \{ title: "Fixture" \};/u);
});

test("allows a nested lexical bar binding inside the per-bar script", async () => {
  const module = await loadTransform();
  const source = `
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

export default defineIndicator({ id: "fixture", name: "Fixture" });

if (close > 0) {
  const bar = close;
  plot.line(bar);
}
`;

  const result = module.transformIndicatorAuthoring(source, {
    fileName: "src/nested-lexical-bar.ts",
    sourceFileId: "src/nested-lexical-bar.ts",
  });

  assert.equal(result.changed, true);
});

test("rejects a nested var bar binding that hoists into the per-bar callback", async () => {
  const module = await loadTransform();
  const source = `
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

export default defineIndicator({ id: "fixture", name: "Fixture" });

if (close > 0) {
  var bar = close;
  plot.line(bar);
}
`;

  assert.throws(
    () =>
      module.transformIndicatorAuthoring(source, {
        fileName: "src/hoisted-var-bar.ts",
        sourceFileId: "src/hoisted-var-bar.ts",
      }),
    /"bar" is reserved by the indicator runtime/u,
  );
});

test("allows a function-local var bar binding inside the per-bar script", async () => {
  const module = await loadTransform();
  const source = `
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";

export default defineIndicator({ id: "fixture", name: "Fixture" });

function helper() {
  var bar = close;
  return bar;
}
plot.line(helper());
`;

  const result = module.transformIndicatorAuthoring(source, {
    fileName: "src/function-local-bar.ts",
    sourceFileId: "src/function-local-bar.ts",
  });

  assert.equal(result.changed, true);
});

test("rejects callback-shaped authored defineIndicator declarations", async () => {
  const module = await loadTransform();
  const source = `
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
export default defineIndicator(
  { id: "fixture", name: "Fixture" },
  ({ close }) => {
    plot.line(close);
  },
);
`;

  assert.throws(
    () =>
      module.transformIndicatorAuthoring(source, {
        fileName: "src/legacy-callback.ts",
        sourceFileId: "src/legacy-callback.ts",
      }),
    /metadata-only defineIndicator declaration/u,
  );
});

test("rejects callback-shaped defineIndicator assigned before default export", async () => {
  const module = await loadTransform();
  const source = `
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
const indicator = defineIndicator(
  { id: "fixture", name: "Fixture" },
  ({ close }) => {
    plot.line(close);
  },
);
export default indicator;
`;

  assert.throws(
    () =>
      module.transformIndicatorAuthoring(source, {
        fileName: "src/legacy-assigned-callback.ts",
        sourceFileId: "src/legacy-assigned-callback.ts",
      }),
    /metadata-only defineIndicator declaration/u,
  );
});

test("rejects callback-shaped defineIndicator reached through a local alias", async () => {
  const module = await loadTransform();
  const source = `
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
const define = defineIndicator;
export default define(
  { id: "fixture", name: "Fixture" },
  ({ close }) => {
    plot.line(close);
  },
);
`;

  assert.throws(
    () =>
      module.transformIndicatorAuthoring(source, {
        fileName: "src/legacy-local-alias-callback.ts",
        sourceFileId: "src/legacy-local-alias-callback.ts",
      }),
    /defineIndicator binding cannot be aliased or escaped/u,
  );
});

test("rejects defineIndicator escaped through an object before destructuring", async () => {
  const module = await loadTransform();
  const source = `
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
const holder = { define: defineIndicator };
const { define } = holder;
export default define(
  { id: "fixture", name: "Fixture" },
  ({ close }) => {
    plot.line(close);
  },
);
`;

  assert.throws(
    () =>
      module.transformIndicatorAuthoring(source, {
        fileName: "src/legacy-object-alias-callback.ts",
        sourceFileId: "src/legacy-object-alias-callback.ts",
      }),
    /defineIndicator binding cannot be aliased or escaped/u,
  );
});

test("rejects CommonJS access to the indicator SDK authoring surface", async () => {
  const module = await loadTransform();
  const source = `
const { defineIndicator } = require("@erc-chart/indicator-sdk");
export default defineIndicator(
  { id: "fixture", name: "Fixture" },
  ({ close }) => close,
);
`;

  assert.throws(
    () =>
      module.transformIndicatorAuthoring(source, {
        fileName: "src/legacy-commonjs-callback.ts",
        sourceFileId: "src/legacy-commonjs-callback.ts",
      }),
    /indicator SDK must use static named imports/u,
  );
});

test("rejects dynamic imports of the indicator SDK authoring surface", async () => {
  const module = await loadTransform();
  const source = `
const { defineIndicator } = await import("@erc-chart/indicator-sdk");
export default defineIndicator(
  { id: "fixture", name: "Fixture" },
  ({ close }) => close,
);
`;

  assert.throws(
    () =>
      module.transformIndicatorAuthoring(source, {
        fileName: "src/legacy-dynamic-import-callback.ts",
        sourceFileId: "src/legacy-dynamic-import-callback.ts",
      }),
    /indicator SDK must use static named imports/u,
  );
});

test("rejects direct re-exports of the indicator SDK authoring surface", async () => {
  const module = await loadTransform();
  const source = `
export { defineIndicator } from "@erc-chart/indicator-sdk";
`;

  assert.throws(
    () =>
      module.transformIndicatorAuthoring(source, {
        fileName: "src/sdk-reexport.ts",
        sourceFileId: "src/sdk-reexport.ts",
      }),
    /indicator SDK must use static named imports/u,
  );
});

test("rejects runtime namespace imports of the indicator SDK", async () => {
  const module = await loadTransform();
  const source = `
import * as sdk from "@erc-chart/indicator-sdk";
function legacy(runtime) {
  return runtime.defineIndicator(
    { id: "fixture", name: "Fixture" },
    ({ close }) => close,
  );
}
export default legacy(sdk);
`;

  assert.throws(
    () =>
      module.transformIndicatorAuthoring(source, {
        fileName: "src/legacy-namespace-callback.ts",
        sourceFileId: "src/legacy-namespace-callback.ts",
      }),
    /indicator SDK must use static named imports/u,
  );
});

test("does not treat a lexically shadowed local defineIndicator call as SDK authoring", async () => {
  const module = await loadTransform();
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
function invokeLocal(defineIndicator) {
  return defineIndicator({ id: "local", name: "Local" }, () => undefined);
}
export default defineIndicator({ id: "fixture", name: "Fixture" });
void invokeLocal;
`;

  const result = module.transformIndicatorAuthoring(source, {
    fileName: "src/shadowed-define-indicator.ts",
    sourceFileId: "src/shadowed-define-indicator.ts",
  });
  assert.equal(result.changed, true);
});

test("does not treat a namespace-local defineIndicator call as SDK authoring", async () => {
  const module = await loadTransform();
  const source = `
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
namespace Local {
  export function defineIndicator(value: number) {
    return value;
  }
  export const value = defineIndicator(1);
}
export default defineIndicator({ id: "fixture", name: "Fixture" });
plot.line(close);
`;

  const result = module.transformIndicatorAuthoring(source, {
    fileName: "src/namespace-shadowed-define-indicator.ts",
    sourceFileId: "src/namespace-shadowed-define-indicator.ts",
  });
  assert.equal(result.changed, true);
});

test("moves price-dependent prelude helpers into the hidden runtime callback", async () => {
  const module = await loadTransform();
  const source = `
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
function midpoint() {
  return (high + low) / 2;
}
export default defineIndicator({ id: "fixture", name: "Fixture" });
plot.line(midpoint(), { title: "Midpoint" });
`;

  const result = module.transformIndicatorAuthoring(source, {
    fileName: "src/helper.ts",
    sourceFileId: "src/helper.ts",
  });
  const parsed = defineIndicatorCall(result.code);
  assert.ok(parsed.call);
  const callback = parsed.call.arguments[1];
  assert.ok(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback));
  assert.match(callback.getText(parsed.sourceFile), /function midpoint\(\)/u);
});

test("signal tracing accepts compiler-relocated module helpers with drawing side effects", async () => {
  const module = await loadTransform();
  const source = `
import { defineIndicator, plot, signal } from "@erc-chart/indicator-sdk";
function step(value) {
  plot.line(value, { title: "Value" });
  return { buy: value > 0 };
}
export default defineIndicator({ id: "fixture", name: "Fixture" });
const state = step(close);
signal(state.buy, "long");
`;

  const result = module.transformIndicatorAuthoring(source, {
    fileName: "src/relocated-signal-helper.ts",
    sourceFileId: "src/relocated-signal-helper.ts",
  });
  const signalCallsite = result.callsites.find(
    (value) => value.callee === "signal",
  );
  assert.ok(signalCallsite);
  assert.deepEqual(signalCallsite.chartSeries, ["close"]);
});

test("preserves direct source provenance inside a top-level script helper", async () => {
  const module = await loadTransform();
  const source = `
import { defineIndicator, input, plot } from "@erc-chart/indicator-sdk";
function readSource() {
  return input.source(close, "Source");
}
export default defineIndicator({ id: "fixture", name: "Fixture" });
plot.line(readSource(), { title: "Source" });
`;

  const result = module.transformIndicatorAuthoring(source, {
    fileName: "src/source-helper.ts",
    sourceFileId: "src/source-helper.ts",
  });
  assert.equal(
    result.callsites.find((value) => value.callee === "input.source")
      ?.seriesSource,
    "close",
  );
});

test("preserves authored source columns for same-line top-level script calls", async () => {
  const module = await loadTransform();
  const source = `import { defineIndicator, input, plot } from "@erc-chart/indicator-sdk";\nexport default defineIndicator({ id: "fixture", name: "Fixture" }); const source = input.source(close, "Source"); plot.line(source);`;
  const inputOffset = source.indexOf("input.source");
  const previousLineBreak = source.lastIndexOf("\n", inputOffset);
  const authoredColumn = inputOffset - previousLineBreak;

  const result = module.transformIndicatorAuthoring(source, {
    fileName: "src/same-line.ts",
    sourceFileId: "src/same-line.ts",
  });
  const inputCallsite = result.callsites.find(
    (value) => value.callee === "input.source",
  );
  assert.ok(inputCallsite);
  assert.equal(inputCallsite.source.line, 2);
  assert.equal(inputCallsite.source.column, authoredColumn);
});

test("preserves authored coordinates for top-level history diagnostics", async () => {
  const module = await loadTransform();
  const source = `import { defineIndicator } from "@erc-chart/indicator-sdk";\nexport default defineIndicator({ id: "fixture", name: "Fixture" }); const prior = close[-1];`;
  const offset = source.indexOf("-1");
  const previousLineBreak = source.lastIndexOf("\n", offset);
  const authoredColumn = offset - previousLineBreak;

  assert.throws(
    () =>
      module.transformIndicatorAuthoring(source, {
        fileName: "src/history-coordinate.ts",
        sourceFileId: "src/history-coordinate.ts",
      }),
    new RegExp(
      `src[\\\\/]history-coordinate\\.ts:2:${authoredColumn} history offsets must be non-negative safe integers`,
      "u",
    ),
  );
});

test("type-checks top-level price and bar globals through the generated evaluator context", async () => {
  const module = await loadTransform();
  assert.equal(typeof module?.validateIndicatorAuthoringTypes, "function");
  const source = `
import { defineIndicator, input, plot } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" });
const selected = input.source(close, "Source");
plot.line(open + high + low + close + volume + hl2 + hlc3 + ohlc4 + selected);
plot.line(bar.index + bar.time + (bar.confirmed ? 1 : 0));
`;

  assert.doesNotThrow(() =>
    module.validateIndicatorAuthoringTypes(source, {
      fileName: path.join(
        import.meta.dirname,
        "_virtual-top-level-authoring.ts",
      ),
    }),
  );
});

test("requires compiler SDK declaration resolution before authoring validation", async (t) => {
  const module = await loadTransform();
  const declarationPath = path.resolve(
    import.meta.dirname,
    "../packages/indicator-sdk/dist/index.d.ts",
  );
  const fileExists = ts.sys.fileExists;
  t.mock.method(ts.sys, "fileExists", (candidate) =>
    path.resolve(candidate) === declarationPath ? false : fileExists(candidate),
  );
  const source = `
import { defineIndicator } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" });
`;

  assert.throws(
    () =>
      module.validateIndicatorAuthoringTypes(source, {
        fileName: path.join(import.meta.dirname, "_virtual-missing-sdk.ts"),
      }),
    /Authoring typecheck could not resolve compiler SDK declaration/u,
  );
});

test("type-checks inferred mutable scalar recurrence as ordinary numeric state", async () => {
  const module = await loadTransform();
  const source = `
import { defineIndicator, plot } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" });
let total = close;
const previous = total[1];
if (Number.isFinite(previous)) total += previous;
plot.line(total);
`;

  assert.doesNotThrow(() =>
    module.validateIndicatorAuthoringTypes(source, {
      fileName: path.join(import.meta.dirname, "_virtual-scalar-recurrence.ts"),
    }),
  );
});

test("mutable recurrence normalization keeps unrelated type diagnostics", async () => {
  const module = await loadTransform();
  const source = `import { defineIndicator } from "@erc-chart/indicator-sdk";\nexport default defineIndicator({ id: "fixture", name: "Fixture" });\nlet total = close;\nconst previous = total[1];\nif (Number.isFinite(previous)) total += previous;\nconst invalid: string = total;`;
  const offset = source.indexOf("invalid");
  const previousLineBreak = source.lastIndexOf("\n", offset);
  const authoredColumn = offset - previousLineBreak;

  assert.throws(
    () =>
      module.validateIndicatorAuthoringTypes(source, {
        fileName: path.join(
          import.meta.dirname,
          "_virtual-scalar-recurrence-type-error.ts",
        ),
      }),
    new RegExp(
      `_virtual-scalar-recurrence-type-error\\.ts:6:${authoredColumn} Type 'number' is not assignable to type 'string'`,
      "u",
    ),
  );
});

test("maps top-level TypeScript diagnostics back to authored coordinates", async () => {
  const module = await loadTransform();
  const source = `import { defineIndicator } from "@erc-chart/indicator-sdk";\nexport default defineIndicator({ id: "fixture", name: "Fixture" });\nconst invalid: string = close;`;
  const offset = source.indexOf("invalid");
  const previousLineBreak = source.lastIndexOf("\n", offset);
  const authoredColumn = offset - previousLineBreak;

  assert.throws(
    () =>
      module.validateIndicatorAuthoringTypes(source, {
        fileName: path.join(import.meta.dirname, "_virtual-type-error.ts"),
      }),
    new RegExp(
      `_virtual-type-error\\.ts:3:${authoredColumn} Type 'SeriesNumber' is not assignable to type 'string'`,
      "u",
    ),
  );
});

test("composes call-site identity before source-history lowering", async () => {
  const module = await loadTransform();
  assert.equal(
    typeof module?.transformIndicatorAuthoring,
    "function",
    "ECDD-219 requires the composed authoring transform",
  );
  const source = `
import { defineIndicator, plot, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({ id: "fixture", name: "Fixture" });
const prior = close[1];
const trend = ta.ema(prior, 14);
plot.line(trend, { title: "Trend" });
`;
  const result = module.transformIndicatorAuthoring(source, {
    fileName: "src/index.ts",
    sourceFileId: "src/index.ts",
  });

  assert.equal(result.changed, true);
  assert.deepEqual(
    result.callsites.map((value) => value.callee),
    ["ta.ema", "plot.line"],
  );
  assert.equal(result.callsites[0]?.source.line, 5);
  assert.doesNotMatch(result.code, /\bclose\[1\]/u);
  assert.match(result.code, /__ercHistory\(close, 1\)/u);
  assert.match(result.code, /__ercCallsite:\s*"v2"/u);
});

test("requires a source root for collision-safe package identities", async () => {
  const module = await loadTransform();
  assert.equal(typeof module?.indicatorAuthoringTransformPlugin, "function");
  assert.throws(
    () => module.indicatorAuthoringTransformPlugin(),
    /sourceRoot.*required/u,
  );
});

test("package build applies the composed authoring transform", async (t) => {
  const root = await mkdtemp(
    path.join(import.meta.dirname, ".callsite-source-"),
  );
  const output = await mkdtemp(path.join(os.tmpdir(), "erc-callsite-output-"));
  cleanup(t, root);
  cleanup(t, output);
  await writeFile(
    path.join(root, "package.json"),
    '{"name":"callsite-fixture","private":true,"type":"module"}\n',
    "utf8",
  );
  const source = path.join(root, "index.ts");
  await writeFile(
    source,
    `
import { defineIndicator, plot, ta } from "@erc-chart/indicator-sdk";
export default defineIndicator({
  id: "erc.indicator.callsite-build.main",
  name: "Callsite build",
});
const trend = ta.ema(close[1], 14);
plot.line(trend, { title: "Trend" });
`,
    "utf8",
  );

  const result = await buildIndicatorPackage({
    source,
    outputRoot: path.join(output, "package"),
    id: "erc.indicator.callsite-build",
    version: "0.1.0",
  });
  const entry = await readFile(
    path.join(result.packageRoot, result.manifest.entry),
    "utf8",
  );
  assert.doesNotMatch(entry, /\bclose\[1\]/u);
  assert.match(entry, /__ercCallsite:\s*["']v2["']/u);
  assert.match(entry, /erc-v2-ta-[a-f0-9]{24}/u);
  assert.match(entry, /erc-v2-plot-[a-f0-9]{24}/u);
});
