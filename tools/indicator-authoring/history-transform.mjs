import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const builtInSeriesNames = new Set([
  "open",
  "high",
  "low",
  "close",
  "volume",
  "hl2",
  "hlc3",
  "ohlc4",
]);

function scriptKind(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  )
    return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function loader(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".jsx")) return "jsx";
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".mts") ||
    lower.endsWith(".cts")
  )
    return "ts";
  return "js";
}

function literalOffset(node) {
  if (ts.isNumericLiteral(node)) return Number(node.text.replaceAll("_", ""));
  if (
    ts.isPrefixUnaryExpression(node) &&
    (node.operator === ts.SyntaxKind.MinusToken ||
      node.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(node.operand)
  ) {
    const value = Number(node.operand.text.replaceAll("_", ""));
    return node.operator === ts.SyntaxKind.MinusToken ? -value : value;
  }
  return undefined;
}

function validateLiteralOffset(node, sourceFile) {
  const value = literalOffset(node);
  if (value === undefined) return;
  if (Number.isSafeInteger(value) && value >= 0) return;
  const location = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  throw new SyntaxError(
    `${sourceFile.fileName}:${location.line + 1}:${location.character + 1} history offsets must be non-negative safe integers`,
  );
}

function isBuiltInSeries(node) {
  return ts.isIdentifier(node) && builtInSeriesNames.has(node.text);
}

function uniqueHelperName(sourceText) {
  let candidate = "__ercHistory";
  while (new RegExp(`\\b${candidate}\\b`, "u").test(sourceText)) {
    candidate += "_";
  }
  return candidate;
}

export function transformIndicatorHistory(sourceText, fileName = "indicator.ts") {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const helperName = uniqueHelperName(sourceText);
  let changed = false;

  const transformer = (context) => {
    const { factory } = context;
    const visit = (node) => {
      if (
        ts.isElementAccessExpression(node) &&
        isBuiltInSeries(node.expression) &&
        node.argumentExpression !== undefined
      ) {
        validateLiteralOffset(node.argumentExpression, sourceFile);
        changed = true;
        return factory.createCallExpression(
          factory.createIdentifier(helperName),
          undefined,
          [
            node.expression,
            ts.visitNode(node.argumentExpression, visit),
          ],
        );
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "at" &&
        isBuiltInSeries(node.expression.expression) &&
        node.arguments.length === 1
      ) {
        const offset = node.arguments[0];
        if (offset === undefined) return node;
        validateLiteralOffset(offset, sourceFile);
        changed = true;
        return factory.createCallExpression(
          factory.createIdentifier(helperName),
          undefined,
          [node.expression.expression, ts.visitNode(offset, visit)],
        );
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "history" &&
        node.arguments.length >= 2
      ) {
        const offset = node.arguments[1];
        if (offset !== undefined) validateLiteralOffset(offset, sourceFile);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (root) => ts.visitNode(root, visit);
  };

  const result = ts.transform(sourceFile, [transformer]);
  let transformed = result.transformed[0];
  if (changed) {
    const helperImport = ts.factory.createImportDeclaration(
      undefined,
      ts.factory.createImportClause(
        false,
        undefined,
        ts.factory.createNamedImports([
          ts.factory.createImportSpecifier(
            false,
            ts.factory.createIdentifier("history"),
            ts.factory.createIdentifier(helperName),
          ),
        ]),
      ),
      ts.factory.createStringLiteral("@erc-chart/indicator-sdk"),
      undefined,
    );
    transformed = ts.factory.updateSourceFile(transformed, [
      helperImport,
      ...transformed.statements,
    ]);
  }
  const code = changed
    ? ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed)
    : sourceText;
  result.dispose();
  return { code, changed };
}

function isWithinRoot(root, fileName) {
  const relative = path.relative(root, fileName);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

export function indicatorHistoryTransformPlugin({ sourceRoot } = {}) {
  const root = sourceRoot === undefined ? undefined : path.resolve(sourceRoot);
  return {
    name: "indicator-history-transform",
    setup(build) {
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/u }, async (args) => {
        if (root !== undefined && !isWithinRoot(root, args.path)) return undefined;
        const sourceText = await readFile(args.path, "utf8");
        const transformed = transformIndicatorHistory(sourceText, args.path);
        if (!transformed.changed) return undefined;
        return { contents: transformed.code, loader: loader(args.path) };
      });
    },
  };
}
