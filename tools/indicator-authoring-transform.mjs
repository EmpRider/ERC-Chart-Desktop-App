import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { scriptKind } from "./indicator-authoring/ast-scope.mjs";
import { transformIndicatorCallsites } from "./indicator-authoring/callsite-transform.mjs";
import {
  isDependencyPath,
  isWithinRoot,
  loaderFor,
} from "./indicator-authoring/esbuild-utils.mjs";
import { transformIndicatorHistory } from "./indicator-authoring/history-transform.mjs";
import { transformIndicatorScript } from "./indicator-authoring/script-transform.mjs";

function stableSourceFileId(root, fileName) {
  return path.relative(root, fileName).replaceAll(path.sep, "/");
}

function authoringTypeDiagnosticMessage(
  diagnostic,
  sourceFile,
  sourceLocationForPosition,
) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (diagnostic.start === undefined) return message;
  const location =
    sourceLocationForPosition?.(diagnostic.start) ??
    sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
  return `${sourceFile.fileName}:${location.line + 1}:${location.character + 1} ${message}`;
}

export function validateIndicatorAuthoringTypes(
  sourceText,
  { fileName = "indicator.ts" } = {},
) {
  const scriptResult = transformIndicatorScript(sourceText, { fileName });
  if (!scriptResult.changed) return;
  const typecheckHistoryResult = transformIndicatorHistory(
    scriptResult.code,
    fileName,
    {
      sourceLocationForPosition: scriptResult.sourceLocationForPosition,
      typecheckMask: true,
    },
  );
  const typecheckSource = typecheckHistoryResult.code;
  const sourcePath = path.resolve(fileName);
  const options = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    types: [],
  };
  const host = ts.createCompilerHost(options, true);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const isAuthoredSource = (candidate) =>
    path.resolve(candidate) === sourcePath;
  host.fileExists = (candidate) =>
    isAuthoredSource(candidate) || originalFileExists(candidate);
  host.readFile = (candidate) =>
    isAuthoredSource(candidate) ? typecheckSource : originalReadFile(candidate);
  host.getSourceFile = (
    candidate,
    languageVersion,
    onError,
    shouldCreateNewSourceFile,
  ) =>
    isAuthoredSource(candidate)
      ? ts.createSourceFile(
          candidate,
          typecheckSource,
          languageVersion,
          true,
          scriptKind(candidate),
        )
      : originalGetSourceFile(
          candidate,
          languageVersion,
          onError,
          shouldCreateNewSourceFile,
        );
  const program = ts.createProgram({
    rootNames: [sourcePath],
    options,
    host,
  });
  const sourceFile = program.getSourceFile(sourcePath);
  if (sourceFile === undefined)
    throw new Error(`Authoring typecheck could not load ${sourcePath}.`);
  const diagnostic = ts
    .getPreEmitDiagnostics(program)
    .find(
      (candidate) =>
        candidate.file !== undefined &&
        path.resolve(candidate.file.fileName) === sourcePath,
    );
  if (diagnostic !== undefined)
    throw new TypeError(
      authoringTypeDiagnosticMessage(
        diagnostic,
        sourceFile,
        scriptResult.sourceLocationForPosition,
      ),
    );
}

export function transformIndicatorAuthoring(
  sourceText,
  { fileName = "indicator.ts", sourceFileId = fileName } = {},
) {
  const scriptResult = transformIndicatorScript(sourceText, { fileName });
  if (scriptResult.changed)
    transformIndicatorHistory(scriptResult.code, fileName, {
      sourceLocationForPosition: scriptResult.sourceLocationForPosition,
    });
  const callsiteResult = transformIndicatorCallsites(scriptResult.code, {
    fileName,
    sourceFileId,
    sourceLocationForPosition: scriptResult.sourceLocationForPosition,
  });
  const historyResult = transformIndicatorHistory(
    callsiteResult.code,
    fileName,
  );
  return {
    code: historyResult.code,
    changed:
      scriptResult.changed || callsiteResult.changed || historyResult.changed,
    callsites: callsiteResult.callsites,
    plotDeclarations: callsiteResult.plotDeclarations,
  };
}

export function indicatorAuthoringTransformPlugin({
  sourceRoot,
  onTransform,
} = {}) {
  if (typeof sourceRoot !== "string" || sourceRoot.length === 0)
    throw new TypeError(
      "indicatorAuthoringTransformPlugin sourceRoot is required.",
    );
  if (onTransform !== undefined && typeof onTransform !== "function")
    throw new TypeError(
      "indicatorAuthoringTransformPlugin onTransform must be a function.",
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
        onTransform?.({
          fileName: path.resolve(args.path),
          plotDeclarations: transformed.plotDeclarations,
        });
        if (!transformed.changed) return undefined;
        return { contents: transformed.code, loader: loaderFor(args.path) };
      });
    },
  };
}
