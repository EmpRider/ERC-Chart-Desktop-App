import { readFile } from "node:fs/promises";
import path from "node:path";
import { transformIndicatorCallsites } from "./indicator-authoring/callsite-transform.mjs";
import { transformIndicatorHistory } from "./indicator-authoring/history-transform.mjs";

function loader(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts"))
    return "ts";
  return "js";
}

function isWithinRoot(root, fileName) {
  const relative = path.relative(root, fileName);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function isDependencyPath(fileName) {
  return path.resolve(fileName).split(path.sep).includes("node_modules");
}

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
    throw new TypeError("indicatorAuthoringTransformPlugin sourceRoot is required.");
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
        return { contents: transformed.code, loader: loader(args.path) };
      });
    },
  };
}
