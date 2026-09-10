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
const nonFunctionBinding = Symbol("non-function-binding");

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

function bindingNameIncludes(name, requestedName) {
  const names = new Set();
  collectBindingNames(name, names);
  return names.has(requestedName);
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

function collectFunctionScopedVarBindings(node, names) {
  const body = node.body;
  if (body === undefined) return;

  const visit = (current) => {
    if (
      current !== body &&
      (ts.isFunctionLike(current) ||
        ts.isClassDeclaration(current) ||
        ts.isClassExpression(current))
    ) {
      return;
    }
    if (
      ts.isVariableDeclarationList(current) &&
      (current.flags & ts.NodeFlags.BlockScoped) === 0
    ) {
      for (const declaration of current.declarations) {
        collectBindingNames(declaration.name, names);
      }
    }
    ts.forEachChild(current, visit);
  };

  visit(body);
}

function functionBindings(node) {
  const names = new Set();
  for (const parameter of node.parameters) {
    collectBindingNames(parameter.name, names);
  }
  if (node.name !== undefined && ts.isIdentifier(node.name)) {
    names.add(node.name.text);
  }
  collectFunctionScopedVarBindings(node, names);
  return names;
}

function variableFunctionBinding(declaration, requestedName) {
  if (!bindingNameIncludes(declaration.name, requestedName)) return undefined;
  if (
    ts.isIdentifier(declaration.name) &&
    declaration.name.text === requestedName &&
    declaration.initializer !== undefined &&
    (ts.isArrowFunction(declaration.initializer) ||
      ts.isFunctionExpression(declaration.initializer))
  ) {
    return declaration.initializer;
  }
  return nonFunctionBinding;
}

function statementBinding(statement, requestedName) {
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      const binding = variableFunctionBinding(declaration, requestedName);
      if (binding !== undefined) return binding;
    }
    return undefined;
  }
  if (
    ts.isFunctionDeclaration(statement) &&
    statement.name?.text === requestedName
  ) {
    return statement;
  }
  if (
    (ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
    statement.name?.text === requestedName
  ) {
    return nonFunctionBinding;
  }
  return undefined;
}

function importBindsName(statement, requestedName) {
  if (!ts.isImportDeclaration(statement)) return false;
  const clause = statement.importClause;
  if (clause === undefined || clause.isTypeOnly) return false;
  if (clause.name?.text === requestedName) return true;
  const bindings = clause.namedBindings;
  if (bindings === undefined) return false;
  if (ts.isNamespaceImport(bindings)) return bindings.name.text === requestedName;
  return bindings.elements.some(
    (element) => !element.isTypeOnly && element.name.text === requestedName,
  );
}

function directScopeBinding(scope, requestedName) {
  const statements = ts.isCaseBlock(scope)
    ? scope.clauses.flatMap((clause) => [...clause.statements])
    : scope.statements;
  if (ts.isSourceFile(scope)) {
    for (const statement of statements) {
      if (importBindsName(statement, requestedName)) return nonFunctionBinding;
    }
  }
  for (const statement of statements) {
    const binding = statementBinding(statement, requestedName);
    if (binding !== undefined) return binding;
  }
  return undefined;
}

function functionScopedVarBinding(node, requestedName) {
  const body = node.body;
  if (body === undefined) return undefined;
  let resolved;
  let ambiguous = false;

  const visit = (current) => {
    if (ambiguous) return;
    if (
      current !== body &&
      (ts.isFunctionLike(current) ||
        ts.isClassDeclaration(current) ||
        ts.isClassExpression(current))
    ) {
      return;
    }
    if (
      ts.isVariableDeclarationList(current) &&
      (current.flags & ts.NodeFlags.BlockScoped) === 0
    ) {
      for (const declaration of current.declarations) {
        const binding = variableFunctionBinding(declaration, requestedName);
        if (binding === undefined) continue;
        if (resolved !== undefined) {
          ambiguous = true;
          return;
        }
        resolved = binding;
      }
    }
    ts.forEachChild(current, visit);
  };

  visit(body);
  return ambiguous ? nonFunctionBinding : resolved;
}

function functionScopeBinding(node, requestedName) {
  for (const parameter of node.parameters) {
    if (bindingNameIncludes(parameter.name, requestedName)) {
      return nonFunctionBinding;
    }
  }
  if (node.name !== undefined && ts.isIdentifier(node.name)) {
    if (node.name.text === requestedName) return node;
  }
  return functionScopedVarBinding(node, requestedName);
}

function loopScopeBinding(node, requestedName) {
  const initializer = node.initializer;
  if (
    initializer === undefined ||
    !ts.isVariableDeclarationList(initializer) ||
    (initializer.flags & ts.NodeFlags.BlockScoped) === 0
  ) {
    return undefined;
  }
  for (const declaration of initializer.declarations) {
    const binding = variableFunctionBinding(declaration, requestedName);
    if (binding !== undefined) return binding;
  }
  return undefined;
}

function bindingInScope(scope, requestedName) {
  if (ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isCaseBlock(scope)) {
    return directScopeBinding(scope, requestedName);
  }
  if (ts.isFunctionLike(scope)) {
    return functionScopeBinding(scope, requestedName);
  }
  if (
    ts.isForStatement(scope) ||
    ts.isForInStatement(scope) ||
    ts.isForOfStatement(scope)
  ) {
    return loopScopeBinding(scope, requestedName);
  }
  if (ts.isCatchClause(scope) && scope.variableDeclaration !== undefined) {
    return bindingNameIncludes(scope.variableDeclaration.name, requestedName)
      ? nonFunctionBinding
      : undefined;
  }
  return undefined;
}

function resolveLocalFunctionReference(identifier) {
  let current = identifier.parent;
  while (current !== undefined) {
    const binding = bindingInScope(current, identifier.text);
    if (binding !== undefined) {
      return binding === nonFunctionBinding ? undefined : binding;
    }
    current = current.parent;
  }
  return undefined;
}

function scopedNames(node) {
  if (ts.isFunctionLike(node)) return functionBindings(node);
  if (ts.isBlock(node) || ts.isCaseBlock(node)) return directBlockBindings(node);
  if (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  ) {
    return loopBindings(node);
  }
  if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
    const names = new Set();
    collectBindingNames(node.variableDeclaration.name, names);
    return names;
  }
  return undefined;
}

function referencedIndicatorCallbacks(
  sourceFile,
  rootDefineIndicatorBindings,
) {
  const callbacks = new Set();

  const visit = (node, defineIndicatorHelpers) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      defineIndicatorHelpers.has(node.expression.text)
    ) {
      const callback = node.arguments[1];
      if (callback !== undefined && ts.isIdentifier(callback)) {
        const resolved = resolveLocalFunctionReference(callback);
        if (resolved === undefined) {
          throw new SyntaxError(
            `${sourceFile.fileName}: defineIndicator callback reference "${callback.text}" must be declared in the same module`,
          );
        }
        callbacks.add(resolved);
      }
    }

    const names = scopedNames(node);
    const scoped =
      names === undefined
        ? defineIndicatorHelpers
        : withoutBindings(defineIndicatorHelpers, names);
    ts.forEachChild(node, (child) => visit(child, scoped));
  };

  ts.forEachChild(sourceFile, (child) =>
    visit(child, rootDefineIndicatorBindings),
  );
  return callbacks;
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
  const referencedCallbacks = referencedIndicatorCallbacks(
    sourceFile,
    rootDefineIndicatorBindings,
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
        ts.isFunctionLike(node) &&
        (referencedCallbacks.has(node) ||
          ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
            isIndicatorCallback(node, defineIndicatorHelpers)))
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

function isDependencyPath(fileName) {
  return path.resolve(fileName).split(path.sep).includes("node_modules");
}

export function indicatorHistoryTransformPlugin({ sourceRoot } = {}) {
  const root = sourceRoot === undefined ? undefined : path.resolve(sourceRoot);
  return {
    name: "indicator-history-transform",
    setup(build) {
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
        if (root !== undefined && !isWithinRoot(root, args.path)) return undefined;
        if (isDependencyPath(args.path)) return undefined;
        const sourceText = await readFile(args.path, "utf8");
        const transformed = transformIndicatorHistory(sourceText, args.path);
        if (!transformed.changed) return undefined;
        return { contents: transformed.code, loader: loader(args.path) };
      });
    },
  };
}
