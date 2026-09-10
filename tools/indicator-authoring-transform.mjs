import { readFile } from "node:fs/promises";
import path from "node:path";
import { transformIndicatorCallsites } from "./indicator-authoring/callsite-transform.mjs";
import {
  isDependencyPath,
  isWithinRoot,
  loaderFor,
} from "./indicator-authoring/esbuild-utils.mjs";
import { transformIndicatorHistory } from "./indicator-authoring/history-transform.mjs";

function stableSourceFileId(root, fileName) {
  return path.relative(root, fileName).replaceAll(path.sep, "/");
}

export function transformIndicatorAuthoring(
  sourceText,
  { fileName = "indicator.ts", sourceFileId = fileName } = {},
) {
  const callsiteResult = transformIndicatorCallsites(sourceText, {
    fileName,
    sourceFileId,
  });
  const historyResult = transformIndicatorHistory(
    callsiteResult.code,
    fileName,
  );
  return {
    code: historyResult.code,
    changed: callsiteResult.changed || historyResult.changed,
    callsites: callsiteResult.callsites,
  };
}

export function indicatorAuthoringTransformPlugin({ sourceRoot } = {}) {
  if (typeof sourceRoot !== "string" || sourceRoot.length === 0)
    throw new TypeError(
      "indicatorAuthoringTransformPlugin sourceRoot is required.",
    );
  const root = path.resolve(sourceRoot);
  return {
    name: "indicator-authoring-transform",
    setup(build) {
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
        if (!isWithinRoot(root, args.path)) return undefined;
        if (isDependencyPath(args.path)) return undefined;
        const sourceText = await readFile(args.path, "utf8");
        const transformed = transformIndicatorAuthoring(sourceText, {
          fileName: args.path,
          sourceFileId: stableSourceFileId(root, args.path),
        });
        if (!transformed.changed) return undefined;
        return { contents: transformed.code, loader: loaderFor(args.path) };
      });
    },
  };
}
