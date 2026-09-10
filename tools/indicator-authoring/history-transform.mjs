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

function collectBindingNames(name, target) {
  if (ts.isIdentifier(name)) {
    target.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, target);
  }
}

function seriesBindings(callback) {
  const result = new Set();
  const parameter = callback.parameters[0];
  if (parameter === undefined || !ts.isObjectBindingPattern(parameter.name)) {
    return result;
  }
  for (const element of parameter.name.elements) {
    if (!ts.isIdentifier(element.name)) continue;
    const sourceName =
      element.propertyName === undefined
        ? element.name.text
        : ts.isIdentifier(element.propertyName)
          ? element.propertyName.text
          : undefined;
    if (sourceName !== undefined && builtInSeriesNames.has(sourceName)) {
      result.add(element.name.text);
    }
  }
  return result;
}

function sdkNamedBindings(sourceFile, requestedName) {
  const result = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@erc-chart/indicator-sdk" ||
      statement.importClause?.isTypeOnly === true
    ) {
      continue;
    }
    const namedBindings = statement.importClause?.namedBindings;
    if (namedBindings === undefined || !ts.isNamedImports(namedBindings)) {
      continue;
    }
    for (const element of namedBindings.elements) {
      if (element.isTypeOnly) continue;
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === requestedName) result.add(element.name.text);
    }
  }
  return result;
}

function isIndicatorCallback(node, defineIndicatorHelpers) {
  const parent = node.parent;
  return (
    ts.isCallExpression(parent) &&
    parent.arguments[1] === node &&
    ts.isIdentifier(parent.expression) &&
    defineIndicatorHelpers.has(parent.expression.text)
  );
}

function withoutBindings(active, names) {
  if (active.size === 0 || names.size === 0) return active;
  const next = new Set(active);
  for (const name of names) next.delete(name);
  return next;
}

function directBlockBindings(block) {
  const names = new Set();
  const statements = ts.isCaseBlock(block)
    ? block.clauses.flatMap((clause) => [...clause.statements])
    : block.statements;
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, names);
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      names.add(statement.name.text);
    }
  }
  return names;
}

function loopBindings(node) {
  const names = new Set();
  const initializer = node.initializer;
  if (initializer !== undefined && ts.isVariableDeclarationList(initializer)) {
    for (const declaration of initializer.declarations) {
      collectBindingNames(declaration.name, names);
    }
  }
  return names;
}

function functionBindings(node) {
  const names = new Set();
  for (const parameter of node.parameters) {
    collectBindingNames(parameter.name, names);
  }
  if (node.name !== undefined && ts.isIdentifier(node.name)) {
    names.add(node.name.text);
  }
  return names;
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
  const rootHistoryBindings = sdkNamedBindings(sourceFile, "history");
  const rootDefineIndicatorBindings = sdkNamedBindings(
    sourceFile,
    "defineIndicator",
  );
  let changed = false;

  const transformer = (context) => {
    const { factory } = context;

    const visitWithBindings = (
      node,
      active,
      historyHelpers,
      defineIndicatorHelpers,
    ) => {
      if (
        ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        active.has(node.expression.text) &&
        node.argumentExpression !== undefined
      ) {
        validateLiteralOffset(node.argumentExpression, sourceFile);
        changed = true;
        return factory.createCallExpression(
          factory.createIdentifier(helperName),
          undefined,
          [
            node.expression,
            ts.visitNode(node.argumentExpression, (child) =>
              visitWithBindings(
                child,
                active,
                historyHelpers,
                defineIndicatorHelpers,
              ),
            ),
          ],
        );
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "at" &&
        ts.isIdentifier(node.expression.expression) &&
        active.has(node.expression.expression.text) &&
        node.arguments.length === 1
      ) {
        const offset = node.arguments[0];
        if (offset === undefined) return node;
        validateLiteralOffset(offset, sourceFile);
        changed = true;
        return factory.createCallExpression(
          factory.createIdentifier(helperName),
          undefined,
          [
            node.expression.expression,
            ts.visitNode(offset, (child) =>
              visitWithBindings(
                child,
                active,
                historyHelpers,
                defineIndicatorHelpers,
              ),
            ),
          ],
        );
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        historyHelpers.has(node.expression.text) &&
        node.arguments.length >= 2
      ) {
        const offset = node.arguments[1];
        if (offset !== undefined) validateLiteralOffset(offset, sourceFile);
      }

      if (
        (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        isIndicatorCallback(node, defineIndicatorHelpers)
      ) {
        const indicatorBindings = seriesBindings(node);
        const names = functionBindings(node);
        const scopedHistoryHelpers = withoutBindings(historyHelpers, names);
        const scopedDefineIndicatorHelpers = withoutBindings(
          defineIndicatorHelpers,
          names,
        );
        return ts.visitEachChild(
          node,
          (child) =>
            visitWithBindings(
              child,
              indicatorBindings,
              scopedHistoryHelpers,
              scopedDefineIndicatorHelpers,
            ),
          context,
        );
      }

      if (ts.isFunctionLike(node)) {
        const names = functionBindings(node);
        const scoped = withoutBindings(active, names);
        const scopedHistoryHelpers = withoutBindings(historyHelpers, names);
        const scopedDefineIndicatorHelpers = withoutBindings(
          defineIndicatorHelpers,
          names,
        );
        return ts.visitEachChild(
          node,
          (child) =>
            visitWithBindings(
              child,
              scoped,
              scopedHistoryHelpers,
              scopedDefineIndicatorHelpers,
            ),
          context,
        );
      }

      if (ts.isBlock(node) || ts.isCaseBlock(node)) {
        const names = directBlockBindings(node);
        const scoped = withoutBindings(active, names);
        const scopedHistoryHelpers = withoutBindings(historyHelpers, names);
        const scopedDefineIndicatorHelpers = withoutBindings(
          defineIndicatorHelpers,
          names,
        );
        return ts.visitEachChild(
          node,
          (child) =>
            visitWithBindings(
              child,
              scoped,
              scopedHistoryHelpers,
              scopedDefineIndicatorHelpers,
            ),
          context,
        );
      }

      if (
        ts.isForStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForOfStatement(node)
      ) {
        const names = loopBindings(node);
        const scoped = withoutBindings(active, names);
        const scopedHistoryHelpers = withoutBindings(historyHelpers, names);
        const scopedDefineIndicatorHelpers = withoutBindings(
          defineIndicatorHelpers,
          names,
        );
        return ts.visitEachChild(
          node,
          (child) =>
            visitWithBindings(
              child,
              scoped,
              scopedHistoryHelpers,
              scopedDefineIndicatorHelpers,
            ),
          context,
        );
      }

      if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
        const names = new Set();
        collectBindingNames(node.variableDeclaration.name, names);
        const scoped = withoutBindings(active, names);
        const scopedHistoryHelpers = withoutBindings(historyHelpers, names);
        const scopedDefineIndicatorHelpers = withoutBindings(
          defineIndicatorHelpers,
          names,
        );
        return ts.visitEachChild(
          node,
          (child) =>
            visitWithBindings(
              child,
              scoped,
              scopedHistoryHelpers,
              scopedDefineIndicatorHelpers,
            ),
          context,
        );
      }

      return ts.visitEachChild(
        node,
        (child) =>
          visitWithBindings(
            child,
            active,
            historyHelpers,
            defineIndicatorHelpers,
          ),
        context,
      );
    };

    return (root) =>
      visitWithBindings(
        root,
        new Set(),
        rootHistoryBindings,
        rootDefineIndicatorBindings,
      );
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
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
        if (root !== undefined && !isWithinRoot(root, args.path)) return undefined;
        const sourceText = await readFile(args.path, "utf8");
        const transformed = transformIndicatorHistory(sourceText, args.path);
        if (!transformed.changed) return undefined;
        return { contents: transformed.code, loader: loader(args.path) };
      });
    },
  };
}
