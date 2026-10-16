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

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const indicatorSdkRuntimePath = path.resolve(
  repositoryRoot,
  "packages/indicator-sdk/dist/index.js",
);
const indicatorSdkCompilerRuntimePath = path.resolve(
  repositoryRoot,
  "packages/indicator-sdk/dist/internal/compiler-entry.js",
);
const indicatorSdkTypesPath = path.resolve(
  import.meta.dirname,
  "indicator-authoring/compiler-sdk.d.ts",
);
const indicatorSdkDeclarationPath = path.resolve(
  repositoryRoot,
  "packages/indicator-sdk/dist/index.d.ts",
);
const persistentStateRuntimePath = path.resolve(
  import.meta.dirname,
  "../packages/indicator-sdk/dist/internal/persistent-state.js",
);

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

function normalizeMutableSeriesTypecheck(sourceText, mutableSeriesHistories) {
  const annotation = ": number";
  const insertions = mutableSeriesHistories
    .filter((entry) => entry.hasType !== true)
    .map((entry) => entry.nameEnd)
    .sort((left, right) => left - right);
  if (insertions.length === 0)
    return {
      code: sourceText,
      originalPositionForPosition: (position) => position,
    };

  let cursor = 0;
  let code = "";
  for (const position of insertions) {
    code += sourceText.slice(cursor, position);
    code += annotation;
    cursor = position;
  }
  code += sourceText.slice(cursor);

  const originalPositionForPosition = (position) => {
    let added = 0;
    for (const insertion of insertions) {
      const generatedStart = insertion + added;
      const generatedEnd = generatedStart + annotation.length;
      if (position < generatedStart) break;
      if (position < generatedEnd) return insertion;
      added += annotation.length;
    }
    return position - added;
  };
  return { code, originalPositionForPosition };
}

function typeIncludesUndefined(node) {
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) return true;
  if (ts.isUnionTypeNode(node))
    return node.types.some((member) => typeIncludesUndefined(member));
  if (ts.isParenthesizedTypeNode(node)) return typeIncludesUndefined(node.type);
  return false;
}

function normalizePersistentVarTypecheck(sourceText, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  let indicatorCallback;
  for (const statement of sourceFile.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
    const expression = statement.expression;
    if (!ts.isCallExpression(expression)) continue;
    const callback = expression.arguments[1];
    if (
      callback !== undefined &&
      (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
    ) {
      indicatorCallback = callback;
      break;
    }
  }
  if (indicatorCallback === undefined)
    return {
      code: sourceText,
      originalPositionForPosition: (position) => position,
    };

  const insertions = [];
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.BlockScoped) === 0 &&
      ts.isVariableStatement(node.parent.parent) &&
      node.type !== undefined &&
      typeIncludesUndefined(node.type) &&
      node.initializer !== undefined &&
      ts.isIdentifier(node.initializer) &&
      node.initializer.text === "undefined"
    ) {
      insertions.push({
        position: node.initializer.end,
        text: ` as ${sourceText.slice(node.type.getStart(sourceFile), node.type.end)}`,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(indicatorCallback);
  if (insertions.length === 0)
    return {
      code: sourceText,
      originalPositionForPosition: (position) => position,
    };

  insertions.sort((left, right) => left.position - right.position);
  let cursor = 0;
  let code = "";
  for (const insertion of insertions) {
    code += sourceText.slice(cursor, insertion.position);
    code += insertion.text;
    cursor = insertion.position;
  }
  code += sourceText.slice(cursor);

  const originalPositionForPosition = (position) => {
    let added = 0;
    for (const insertion of insertions) {
      const generatedStart = insertion.position + added;
      const generatedEnd = generatedStart + insertion.text.length;
      if (position < generatedStart) break;
      if (position < generatedEnd) return insertion.position;
      added += insertion.text.length;
    }
    return position - added;
  };
  return { code, originalPositionForPosition };
}

export function validateIndicatorAuthoringTypes(
  sourceText,
  { fileName = "indicator.ts", sourceRoot } = {},
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
  const normalizedTypecheck = normalizeMutableSeriesTypecheck(
    typecheckHistoryResult.code,
    typecheckHistoryResult.mutableSeriesHistories,
  );
  const persistentTypecheck = normalizePersistentVarTypecheck(
    normalizedTypecheck.code,
    fileName,
  );
  const typecheckSource = persistentTypecheck.code;
  const sourcePath = path.resolve(fileName);
  const authoringRoot = path.resolve(sourceRoot ?? path.dirname(sourcePath));
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
    baseUrl: repositoryRoot,
    paths: {
      "@erc-chart/indicator-sdk": [indicatorSdkTypesPath],
    },
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
  if (program.getSourceFile(indicatorSdkDeclarationPath) === undefined)
    throw new Error(
      `Authoring typecheck could not resolve compiler SDK declaration ${indicatorSdkDeclarationPath}. Build @erc-chart/indicator-sdk before packaging indicators.`,
    );
  const diagnostic = ts
    .getPreEmitDiagnostics(program)
    .find(
      (candidate) =>
        candidate.file !== undefined &&
        isWithinRoot(authoringRoot, path.resolve(candidate.file.fileName)) &&
        !isDependencyPath(candidate.file.fileName),
    );
  if (diagnostic !== undefined) {
    const diagnosticSourceFile = diagnostic.file;
    const diagnosticPath = path.resolve(diagnosticSourceFile.fileName);
    throw new TypeError(
      authoringTypeDiagnosticMessage(
        diagnostic,
        diagnosticSourceFile,
        diagnosticPath === sourcePath
          ? (position) =>
              scriptResult.sourceLocationForPosition(
                normalizedTypecheck.originalPositionForPosition(
                  persistentTypecheck.originalPositionForPosition(position),
                ),
              )
          : undefined,
      ),
    );
  }
}

export function transformIndicatorAuthoring(
  sourceText,
  { fileName = "indicator.ts", sourceFileId = fileName } = {},
) {
  const scriptResult = transformIndicatorScript(sourceText, { fileName });
  const historyAnalysis = transformIndicatorHistory(
    scriptResult.code,
    fileName,
    {
      sourceLocationForPosition: scriptResult.sourceLocationForPosition,
    },
  );
  const callsiteResult = transformIndicatorCallsites(scriptResult.code, {
    fileName,
    sourceFileId,
    sourceLocationForPosition: scriptResult.sourceLocationForPosition,
    mutableSeriesHistories: historyAnalysis.mutableSeriesHistories,
    compilerRelocatedHelperRanges: scriptResult.relocatedHelperRanges,
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
      build.onResolve({ filter: /^@erc-chart\/indicator-sdk$/ }, (args) => ({
        path:
          args.importer.length > 0 &&
          isWithinRoot(root, args.importer) &&
          !isDependencyPath(args.importer)
            ? indicatorSdkCompilerRuntimePath
            : indicatorSdkRuntimePath,
      }));
      build.onResolve(
        { filter: /^erc-chart:indicator-persistent-state$/ },
        () => ({ path: persistentStateRuntimePath }),
      );
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
