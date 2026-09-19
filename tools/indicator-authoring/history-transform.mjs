import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import {
  collectBindingNames,
  functionBindings,
  scopedNames,
  scriptKind,
} from "./ast-scope.mjs";
import {
  isDependencyPath,
  isWithinRoot,
  loaderFor,
} from "./esbuild-utils.mjs";

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
const scalarTaMethods = new Set([
  "sma",
  "ema",
  "movingAverage",
  "atr",
  "rsi",
  "highest",
  "lowest",
]);
const scalarInputMethods = new Set(["source"]);
const nonFunctionBinding = Symbol("non-function-binding");

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

function validateLiteralOffset(node, sourceFile, sourceLocationForPosition) {
  const value = literalOffset(node);
  if (value === undefined) return;
  if (Number.isSafeInteger(value) && value >= 0) return;
  const position = node.getStart(sourceFile);
  const location =
    sourceLocationForPosition?.(position) ??
    sourceFile.getLineAndCharacterOfPosition(position);
  throw new SyntaxError(
    `${sourceFile.fileName}:${location.line + 1}:${location.character + 1} history offsets must be non-negative safe integers`,
  );
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

function isRootPropertyCall(node, roots, propertyNames) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    roots.has(node.expression.expression.text) &&
    propertyNames.has(node.expression.name.text)
  );
}

function isArrayValuedExpression(
  node,
  arrayBindings,
  resolvingHelpers = new Set(),
  functionEnvironments = new Map(),
) {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  )
    return isArrayValuedExpression(
      node.expression,
      arrayBindings,
      resolvingHelpers,
      functionEnvironments,
    );
  if (ts.isIdentifier(node)) return arrayBindings.has(node.text);
  if (ts.isArrayLiteralExpression(node)) return true;
  if (ts.isConditionalExpression(node))
    return (
      isArrayValuedExpression(
        node.whenTrue,
        arrayBindings,
        resolvingHelpers,
        functionEnvironments,
      ) &&
      isArrayValuedExpression(
        node.whenFalse,
        arrayBindings,
        resolvingHelpers,
        functionEnvironments,
      )
    );
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const helper = resolveLocalFunctionReference(node.expression);
    return (
      helper !== undefined &&
      functionReturnIsArrayValued(
        helper,
        node,
        arrayBindings,
        resolvingHelpers,
        functionEnvironments,
      )
    );
  }
  return false;
}

function directFunctionDeclarations(scope) {
  if (!ts.isSourceFile(scope) && !ts.isBlock(scope) && !ts.isCaseBlock(scope))
    return [];
  const statements = ts.isCaseBlock(scope)
    ? scope.clauses.flatMap((clause) => [...clause.statements])
    : scope.statements;
  const result = [];
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement)) {
      result.push(statement);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (
        initializer !== undefined &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      )
        result.push(initializer);
    }
  }
  return result;
}

function registerFunctionEnvironments(
  scope,
  active,
  arrayBindings,
  functionEnvironments,
) {
  for (const functionLike of directFunctionDeclarations(scope)) {
    functionEnvironments.set(functionLike, {
      active: new Set(active),
      arrayBindings: new Set(arrayBindings),
    });
  }
}

function unwrappedExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function statementCanCompleteNormally(statement) {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement))
    return false;
  if (ts.isBlock(statement)) {
    for (const child of statement.statements) {
      if (!statementCanCompleteNormally(child)) return false;
    }
    return true;
  }
  if (ts.isIfStatement(statement)) {
    if (statement.elseStatement === undefined) return true;
    return (
      statementCanCompleteNormally(statement.thenStatement) ||
      statementCanCompleteNormally(statement.elseStatement)
    );
  }
  return true;
}

function addArrayValuedBinding(
  name,
  value,
  valueArrays,
  targetArrays,
  resolvingHelpers,
  functionEnvironments,
) {
  if (ts.isIdentifier(name)) {
    if (
      isArrayValuedExpression(
        value,
        valueArrays,
        resolvingHelpers,
        functionEnvironments,
      )
    )
      targetArrays.add(name.text);
    return;
  }
  if (!ts.isArrayBindingPattern(name)) return;
  const unwrapped = unwrappedExpression(value);
  if (!ts.isArrayLiteralExpression(unwrapped)) return;
  for (let index = 0; index < name.elements.length; index += 1) {
    const binding = name.elements[index];
    if (ts.isOmittedExpression(binding)) continue;
    if (binding.dotDotDotToken !== undefined) {
      if (ts.isIdentifier(binding.name)) targetArrays.add(binding.name.text);
      continue;
    }
    const element = unwrapped.elements[index];
    if (element === undefined || ts.isSpreadElement(element)) continue;
    addArrayValuedBinding(
      binding.name,
      element,
      valueArrays,
      targetArrays,
      resolvingHelpers,
      functionEnvironments,
    );
  }
}

function functionReturnIsArrayValued(
  functionLike,
  call,
  arrayBindings,
  resolvingHelpers,
  functionEnvironments,
) {
  if (functionLike.body === undefined || resolvingHelpers.has(functionLike))
    return false;

  const nextResolving = new Set(resolvingHelpers);
  nextResolving.add(functionLike);

  const functionNames = functionBindings(functionLike);
  const declarationEnvironment = functionEnvironments.get(functionLike);
  const declarationArrays =
    declarationEnvironment?.arrayBindings ?? new Set();
  const helperArrays = new Set(
    withoutBindings(declarationArrays, functionNames),
  );
  const defaultArrays = new Set(helperArrays);

  functionLike.parameters.forEach((parameter, index) => {
    if (parameter.dotDotDotToken !== undefined) {
      if (ts.isIdentifier(parameter.name)) {
        helperArrays.add(parameter.name.text);
        defaultArrays.add(parameter.name.text);
      }
      return;
    }
    const argument = call.arguments[index];
    const value = argument ?? parameter.initializer;
    if (value === undefined) return;
    const valueArrays = argument === undefined ? defaultArrays : arrayBindings;
    const parameterArrays = new Set();
    addArrayValuedBinding(
      parameter.name,
      value,
      valueArrays,
      parameterArrays,
      nextResolving,
      functionEnvironments,
    );
    for (const name of parameterArrays) {
      helperArrays.add(name);
      defaultArrays.add(name);
    }
  });

  if (!ts.isBlock(functionLike.body)) {
    return isArrayValuedExpression(
      functionLike.body,
      helperArrays,
      nextResolving,
      functionEnvironments,
    );
  }

  let sawReturn = false;
  let allReturnsArrayValued = true;

  const visit = (node, outerArrays) => {
    if (node !== functionLike.body && ts.isFunctionLike(node)) return;

    let scopedArrays = outerArrays;
    const names = scopedNames(node);
    if (names !== undefined)
      scopedArrays = withoutBindings(scopedArrays, names);

    if (ts.isBlock(node) || ts.isCaseBlock(node)) {
      const localArrays = directArrayDeclarations(
        node,
        scopedArrays,
        nextResolving,
        functionEnvironments,
      );
      if (localArrays.size > 0) {
        scopedArrays = new Set(scopedArrays);
        for (const name of localArrays) scopedArrays.add(name);
      }
    }

    if (ts.isReturnStatement(node)) {
      sawReturn = true;
      if (
        node.expression === undefined ||
        !isArrayValuedExpression(
          node.expression,
          scopedArrays,
          nextResolving,
          functionEnvironments,
        )
      )
        allReturnsArrayValued = false;
      return;
    }

    ts.forEachChild(node, (child) => visit(child, scopedArrays));
  };

  visit(functionLike.body, helperArrays);
  return (
    sawReturn &&
    allReturnsArrayValued &&
    !statementCanCompleteNormally(functionLike.body)
  );
}

function functionReturnDependsOnSeries(
  functionLike,
  call,
  active,
  arrayBindings,
  historyHelpers,
  inputHelpers,
  taHelpers,
  resolvingHelpers,
  functionEnvironments,
) {
  if (functionLike.body === undefined || resolvingHelpers.has(functionLike))
    return false;

  const nextResolving = new Set(resolvingHelpers);
  nextResolving.add(functionLike);

  const functionNames = functionBindings(functionLike);
  const declarationEnvironment = functionEnvironments.get(functionLike);
  const declarationActive = declarationEnvironment?.active ?? new Set();
  const declarationArrays =
    declarationEnvironment?.arrayBindings ?? new Set();
  const helperActive = new Set(
    withoutBindings(declarationActive, functionNames),
  );
  const helperArrays = new Set(
    withoutBindings(declarationArrays, functionNames),
  );
  const defaultActive = new Set(helperActive);
  const defaultArrays = new Set(helperArrays);

  functionLike.parameters.forEach((parameter, index) => {
    const argument = call.arguments[index];
    const value = argument ?? parameter.initializer;
    if (value === undefined) return;
    const valueActive = argument === undefined ? defaultActive : active;
    const valueArrays = argument === undefined ? defaultArrays : arrayBindings;
    const names = new Set();
    collectBindingNames(parameter.name, names);
    if (
      expressionDependsOnSeries(
        value,
        valueActive,
        valueArrays,
        historyHelpers,
        inputHelpers,
        taHelpers,
        nextResolving,
        functionEnvironments,
      )
    ) {
      for (const name of names) {
        helperActive.add(name);
        defaultActive.add(name);
      }
    }
    const parameterArrays = new Set();
    addArrayValuedBinding(
      parameter.name,
      value,
      valueArrays,
      parameterArrays,
      nextResolving,
      functionEnvironments,
    );
    for (const name of parameterArrays) {
      helperArrays.add(name);
      defaultArrays.add(name);
    }
  });

  if (!ts.isBlock(functionLike.body)) {
    return expressionDependsOnSeries(
      functionLike.body,
      helperActive,
      helperArrays,
      historyHelpers,
      inputHelpers,
      taHelpers,
      nextResolving,
      functionEnvironments,
    );
  }

  const visit = (node, outerActive, outerArrays) => {
    if (node !== functionLike.body && ts.isFunctionLike(node)) return false;

    let scopedActive = outerActive;
    let scopedArrays = outerArrays;
    const names = scopedNames(node);
    if (names !== undefined) {
      scopedActive = withoutBindings(scopedActive, names);
      scopedArrays = withoutBindings(scopedArrays, names);
    }

    if (ts.isBlock(node) || ts.isCaseBlock(node)) {
      const localArrays = directArrayDeclarations(
        node,
        scopedArrays,
        nextResolving,
        functionEnvironments,
      );
      if (localArrays.size > 0) {
        scopedArrays = new Set(scopedArrays);
        for (const name of localArrays) scopedArrays.add(name);
      }
      const localSeries = directSeriesDeclarations(
        node,
        scopedActive,
        scopedArrays,
        historyHelpers,
        inputHelpers,
        taHelpers,
        nextResolving,
        functionEnvironments,
      );
      if (localSeries.size > 0) {
        scopedActive = new Set(scopedActive);
        for (const name of localSeries) scopedActive.add(name);
      }
    }

    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      return expressionDependsOnSeries(
        node.expression,
        scopedActive,
        scopedArrays,
        historyHelpers,
        inputHelpers,
        taHelpers,
        nextResolving,
        functionEnvironments,
      );
    }

    let depends = false;
    ts.forEachChild(node, (child) => {
      if (!depends) depends = visit(child, scopedActive, scopedArrays);
    });
    return depends;
  };

  return visit(functionLike.body, helperActive, helperArrays);
}

function expressionDependsOnSeries(
  node,
  active,
  arrayBindings,
  historyHelpers,
  inputHelpers,
  taHelpers,
  resolvingHelpers = new Set(),
  functionEnvironments = new Map(),
) {
  if (ts.isIdentifier(node)) return active.has(node.text);
  const seriesReceiver = ts.isElementAccessExpression(node)
    ? node.expression
    : ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "at" &&
        node.arguments.length === 1
      ? node.expression.expression
      : undefined;
  if (
    seriesReceiver !== undefined &&
    !isArrayValuedExpression(
      seriesReceiver,
      arrayBindings,
      resolvingHelpers,
      functionEnvironments,
    )
  )
    return expressionDependsOnSeries(
      seriesReceiver,
      active,
      arrayBindings,
      historyHelpers,
      inputHelpers,
      taHelpers,
      resolvingHelpers,
      functionEnvironments,
    );
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  )
    return expressionDependsOnSeries(
      node.expression,
      active,
      arrayBindings,
      historyHelpers,
      inputHelpers,
      taHelpers,
      resolvingHelpers,
      functionEnvironments,
    );
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
    return expressionDependsOnSeries(
      node.operand,
      active,
      arrayBindings,
      historyHelpers,
      inputHelpers,
      taHelpers,
      resolvingHelpers,
      functionEnvironments,
    );
  if (ts.isBinaryExpression(node))
    return (
      expressionDependsOnSeries(
        node.left,
        active,
        arrayBindings,
        historyHelpers,
        inputHelpers,
        taHelpers,
        resolvingHelpers,
        functionEnvironments,
      ) ||
      expressionDependsOnSeries(
        node.right,
        active,
        arrayBindings,
        historyHelpers,
        inputHelpers,
        taHelpers,
        resolvingHelpers,
        functionEnvironments,
      )
    );
  if (ts.isConditionalExpression(node)) {
    const branchDependsOnSeries =
      expressionDependsOnSeries(
        node.whenTrue,
        active,
        arrayBindings,
        historyHelpers,
        inputHelpers,
        taHelpers,
        resolvingHelpers,
        functionEnvironments,
      ) ||
      expressionDependsOnSeries(
        node.whenFalse,
        active,
        arrayBindings,
        historyHelpers,
        inputHelpers,
        taHelpers,
        resolvingHelpers,
        functionEnvironments,
      );
    if (branchDependsOnSeries) return true;
    if (
      isArrayValuedExpression(
        node.whenTrue,
        arrayBindings,
        resolvingHelpers,
        functionEnvironments,
      ) &&
      isArrayValuedExpression(
        node.whenFalse,
        arrayBindings,
        resolvingHelpers,
        functionEnvironments,
      )
    )
      return false;
    return expressionDependsOnSeries(
      node.condition,
      active,
      arrayBindings,
      historyHelpers,
      inputHelpers,
      taHelpers,
      resolvingHelpers,
      functionEnvironments,
    );
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    if (historyHelpers.has(node.expression.text)) return true;
    const helper = resolveLocalFunctionReference(node.expression);
    if (
      helper !== undefined &&
      functionReturnDependsOnSeries(
        helper,
        node,
        active,
        arrayBindings,
        historyHelpers,
        inputHelpers,
        taHelpers,
        resolvingHelpers,
        functionEnvironments,
      )
    )
      return true;
  }
  return (
    isRootPropertyCall(node, inputHelpers, scalarInputMethods) ||
    isRootPropertyCall(node, taHelpers, scalarTaMethods)
  );
}

function directArrayDeclarations(
  scope,
  outerArrayBindings,
  resolvingHelpers = new Set(),
  functionEnvironments = new Map(),
) {
  if (!ts.isBlock(scope) && !ts.isCaseBlock(scope)) return new Set();
  const statements = ts.isCaseBlock(scope)
    ? scope.clauses.flatMap((clause) => [...clause.statements])
    : scope.statements;
  const declarations = [];
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer !== undefined
      )
        declarations.push(declaration);
    }
  }
  const active = new Set(outerArrayBindings);
  const result = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    registerFunctionEnvironments(
      scope,
      new Set(),
      active,
      functionEnvironments,
    );
    for (const declaration of declarations) {
      const name = declaration.name.text;
      if (result.has(name)) continue;
      if (
        !isArrayValuedExpression(
          declaration.initializer,
          active,
          resolvingHelpers,
          functionEnvironments,
        )
      )
        continue;
      result.add(name);
      active.add(name);
      changed = true;
    }
  }
  return result;
}

function directSeriesDeclarations(
  scope,
  outerActive,
  arrayBindings,
  historyHelpers,
  inputHelpers,
  taHelpers,
  resolvingHelpers = new Set(),
  functionEnvironments = new Map(),
) {
  if (!ts.isBlock(scope) && !ts.isCaseBlock(scope)) return new Set();
  const statements = ts.isCaseBlock(scope)
    ? scope.clauses.flatMap((clause) => [...clause.statements])
    : scope.statements;
  const declarations = [];
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer !== undefined
      )
        declarations.push(declaration);
    }
  }
  const active = new Set(outerActive);
  const result = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    registerFunctionEnvironments(
      scope,
      active,
      arrayBindings,
      functionEnvironments,
    );
    for (const declaration of declarations) {
      const name = declaration.name.text;
      if (result.has(name)) continue;
      if (
        !expressionDependsOnSeries(
          declaration.initializer,
          active,
          arrayBindings,
          historyHelpers,
          inputHelpers,
          taHelpers,
          resolvingHelpers,
          functionEnvironments,
        )
      )
        continue;
      result.add(name);
      active.add(name);
      changed = true;
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

function directMutableLetDeclaration(scope, requestedName) {
  if (!ts.isSourceFile(scope) && !ts.isBlock(scope) && !ts.isCaseBlock(scope))
    return undefined;
  const statements = ts.isCaseBlock(scope)
    ? scope.clauses.flatMap((clause) => [...clause.statements])
    : scope.statements;
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!bindingNameIncludes(declaration.name, requestedName)) continue;
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === requestedName &&
        (statement.declarationList.flags & ts.NodeFlags.Let) !== 0
      )
        return declaration;
      return null;
    }
  }
  return scopedNames(scope)?.has(requestedName) ? null : undefined;
}

function loopMutableLetDeclaration(scope, requestedName) {
  if (
    !ts.isForStatement(scope) &&
    !ts.isForInStatement(scope) &&
    !ts.isForOfStatement(scope)
  )
    return undefined;
  const initializer = scope.initializer;
  if (initializer === undefined || !ts.isVariableDeclarationList(initializer))
    return undefined;
  for (const declaration of initializer.declarations) {
    if (!bindingNameIncludes(declaration.name, requestedName)) continue;
    if (
      ts.isIdentifier(declaration.name) &&
      declaration.name.text === requestedName &&
      (initializer.flags & ts.NodeFlags.Let) !== 0
    )
      return declaration;
    return null;
  }
  return undefined;
}

function resolveMutableLetReference(identifier) {
  const requestedName = identifier.text;
  let current = identifier.parent;
  while (current !== undefined) {
    const direct = directMutableLetDeclaration(current, requestedName);
    if (direct !== undefined) return direct;
    const loop = loopMutableLetDeclaration(current, requestedName);
    if (loop !== undefined) return loop;
    if (
      (ts.isFunctionLike(current) || ts.isCatchClause(current)) &&
      scopedNames(current)?.has(requestedName)
    )
      return null;
    current = current.parent;
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

export function transformIndicatorHistory(
  sourceText,
  fileName = "indicator.ts",
  { sourceLocationForPosition, typecheckMask = false } = {},
) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const helperName = uniqueHelperName(sourceText);
  const rootHistoryBindings = sdkNamedBindings(sourceFile, "history");
  const rootInputBindings = sdkNamedBindings(sourceFile, "input");
  const rootTaBindings = sdkNamedBindings(sourceFile, "ta");
  const rootDefineIndicatorBindings = sdkNamedBindings(
    sourceFile,
    "defineIndicator",
  );
  const referencedCallbacks = referencedIndicatorCallbacks(
    sourceFile,
    rootDefineIndicatorBindings,
  );
  let changed = false;
  const typecheckMaskRanges = [];
  const mutableSeriesHistoryByDeclaration = new Map();

  const recordMutableSeriesHistory = (identifier, access) => {
    const declaration = resolveMutableLetReference(identifier);
    if (declaration === undefined || declaration === null) return;
    const declarationStart = declaration.getStart(sourceFile);
    let entry = mutableSeriesHistoryByDeclaration.get(declarationStart);
    if (entry === undefined) {
      entry = {
        declarationStart,
        nameEnd: declaration.name.end,
        hasType: declaration.type !== undefined,
        name: identifier.text,
        accessStarts: new Set(),
      };
      mutableSeriesHistoryByDeclaration.set(declarationStart, entry);
    }
    entry.accessStarts.add(access.getStart(sourceFile));
  };

  const mutableSeriesHistories = () =>
    [...mutableSeriesHistoryByDeclaration.values()].map((entry) => ({
      declarationStart: entry.declarationStart,
      nameEnd: entry.nameEnd,
      hasType: entry.hasType,
      name: entry.name,
      accessStarts: [...entry.accessStarts],
    }));

  const transformer = (context) => {
    const { factory } = context;
    const functionEnvironments = new Map();

    function descendWithBindings(
      node,
      names,
      active,
      arrayBindings,
      historyHelpers,
      inputHelpers,
      taHelpers,
      defineIndicatorHelpers,
      activeOverride,
    ) {
      let scopedActive =
        activeOverride ?? withoutBindings(active, names);
      let scopedArrayBindings = withoutBindings(arrayBindings, names);
      const scopedHistoryHelpers = withoutBindings(historyHelpers, names);
      const scopedInputHelpers = withoutBindings(inputHelpers, names);
      const scopedTaHelpers = withoutBindings(taHelpers, names);
      const scopedDefineIndicatorHelpers = withoutBindings(
        defineIndicatorHelpers,
        names,
      );
      const localArrays = directArrayDeclarations(
        node,
        scopedArrayBindings,
        new Set(),
        functionEnvironments,
      );
      if (localArrays.size > 0) {
        scopedArrayBindings = new Set(scopedArrayBindings);
        for (const name of localArrays) scopedArrayBindings.add(name);
      }
      const localSeries = directSeriesDeclarations(
        node,
        scopedActive,
        scopedArrayBindings,
        scopedHistoryHelpers,
        scopedInputHelpers,
        scopedTaHelpers,
        new Set(),
        functionEnvironments,
      );
      if (localSeries.size > 0) {
        scopedActive = new Set(scopedActive);
        for (const name of localSeries) scopedActive.add(name);
      }
      registerFunctionEnvironments(
        node,
        scopedActive,
        scopedArrayBindings,
        functionEnvironments,
      );
      return ts.visitEachChild(
        node,
        (child) =>
          visitWithBindings(
            child,
            scopedActive,
            scopedArrayBindings,
            scopedHistoryHelpers,
            scopedInputHelpers,
            scopedTaHelpers,
            scopedDefineIndicatorHelpers,
          ),
        context,
      );
    }

    const visitWithBindings = (
      node,
      active,
      arrayBindings,
      historyHelpers,
      inputHelpers,
      taHelpers,
      defineIndicatorHelpers,
    ) => {
      if (
        ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        active.has(node.expression.text) &&
        node.argumentExpression !== undefined
      ) {
        recordMutableSeriesHistory(node.expression, node);
        validateLiteralOffset(
          node.argumentExpression,
          sourceFile,
          sourceLocationForPosition,
        );
        changed = true;
        if (typecheckMask) {
          typecheckMaskRanges.push([node.expression.end, node.end]);
          return node;
        }
        return factory.createCallExpression(
          factory.createIdentifier(helperName),
          undefined,
          [
            node.expression,
            ts.visitNode(node.argumentExpression, (child) =>
              visitWithBindings(
                child,
                active,
                arrayBindings,
                historyHelpers,
                inputHelpers,
                taHelpers,
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
        recordMutableSeriesHistory(node.expression.expression, node);
        const offset = node.arguments[0];
        if (offset === undefined) return node;
        validateLiteralOffset(offset, sourceFile, sourceLocationForPosition);
        changed = true;
        if (typecheckMask) {
          typecheckMaskRanges.push([node.expression.expression.end, node.end]);
          return node;
        }
        return factory.createCallExpression(
          factory.createIdentifier(helperName),
          undefined,
          [
            node.expression.expression,
            ts.visitNode(offset, (child) =>
              visitWithBindings(
                child,
                active,
                arrayBindings,
                historyHelpers,
                inputHelpers,
                taHelpers,
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
        if (offset !== undefined)
          validateLiteralOffset(offset, sourceFile, sourceLocationForPosition);
      }

      if (
        ts.isFunctionLike(node) &&
        (referencedCallbacks.has(node) ||
          ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
            isIndicatorCallback(node, defineIndicatorHelpers)))
      ) {
        return descendWithBindings(
          node,
          functionBindings(node),
          active,
          arrayBindings,
          historyHelpers,
          inputHelpers,
          taHelpers,
          defineIndicatorHelpers,
          seriesBindings(node),
        );
      }

      const names = scopedNames(node);
      if (names !== undefined) {
        return descendWithBindings(
          node,
          names,
          active,
          arrayBindings,
          historyHelpers,
          inputHelpers,
          taHelpers,
          defineIndicatorHelpers,
        );
      }

      return ts.visitEachChild(
        node,
        (child) =>
          visitWithBindings(
            child,
            active,
            arrayBindings,
            historyHelpers,
            inputHelpers,
            taHelpers,
            defineIndicatorHelpers,
          ),
        context,
      );
    };

    return (root) =>
      visitWithBindings(
        root,
        new Set(),
        new Set(),
        rootHistoryBindings,
        rootInputBindings,
        rootTaBindings,
        rootDefineIndicatorBindings,
      );
  };

  const result = ts.transform(sourceFile, [transformer]);
  if (typecheckMask) {
    result.dispose();
    if (typecheckMaskRanges.length === 0)
      return {
        code: sourceText,
        changed: false,
        mutableSeriesHistories: mutableSeriesHistories(),
      };
    let cursor = 0;
    let code = "";
    for (const [start, end] of typecheckMaskRanges.sort(
      (left, right) => left[0] - right[0],
    )) {
      code += sourceText.slice(cursor, start);
      code += sourceText.slice(start, end).replace(/[^\r\n]/gu, " ");
      cursor = end;
    }
    code += sourceText.slice(cursor);
    return {
      code,
      changed: true,
      mutableSeriesHistories: mutableSeriesHistories(),
    };
  }
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
  return { code, changed, mutableSeriesHistories: mutableSeriesHistories() };
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
        return { contents: transformed.code, loader: loaderFor(args.path) };
      });
    },
  };
}
