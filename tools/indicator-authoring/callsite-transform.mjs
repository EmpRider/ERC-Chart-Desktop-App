import ts from "typescript";
import { scopedNames, scriptKind } from "./ast-scope.mjs";
import { semanticCallsiteKey, stableCallsiteId } from "./identity.mjs";

const sdkModule = "@erc-chart/indicator-sdk";
const sdkRoots = new Set([
  "defineIndicator",
  "history",
  "indicator",
  "input",
  "location",
  "plot",
  "priceValue",
  "series",
  "shape",
  "signal",
  "ta",
  "textSize",
]);
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
const sdkConstantValues = Object.freeze({
  shape: Object.freeze({
    circle: "circle",
    triangleUp: "triangle-up",
    triangleDown: "triangle-down",
    labelUp: "label-up",
    labelDown: "label-down",
  }),
  location: Object.freeze({
    aboveBar: "above-bar",
    belowBar: "below-bar",
    absolute: "absolute",
  }),
  textSize: Object.freeze({
    tiny: "tiny",
    small: "small",
    normal: "normal",
    large: "large",
    xlarge: "xlarge",
  }),
});
const statefulTaMethods = new Set([
  "atr",
  "crossover",
  "crossunder",
  "dmi",
  "ema",
  "highest",
  "lowest",
  "movingAverage",
  "rsi",
  "sma",
]);
const drawingMethods = new Set(["box", "drawings", "remove", "segment"]);
const signalSafeBuiltinCallRoots = new Set([
  "Array",
  "Boolean",
  "Math",
  "Number",
  "Object",
  "String",
]);
const signalSafeSdkFunctionRoots = new Set(["history", "priceValue"]);
const signalSafeArrayMethods = new Set([
  "at",
  "concat",
  "entries",
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flat",
  "flatMap",
  "forEach",
  "includes",
  "indexOf",
  "join",
  "keys",
  "lastIndexOf",
  "map",
  "pop",
  "push",
  "reduce",
  "reduceRight",
  "reverse",
  "shift",
  "slice",
  "some",
  "sort",
  "splice",
  "toReversed",
  "toSorted",
  "toSpliced",
  "unshift",
  "values",
  "with",
]);
const signalArrayReturningMethods = new Set([
  "concat",
  "filter",
  "flat",
  "flatMap",
  "map",
  "reverse",
  "slice",
  "sort",
  "splice",
  "toReversed",
  "toSorted",
  "toSpliced",
  "with",
]);
const signalArrayElementPreservingMethods = new Set([
  "filter",
  "reverse",
  "slice",
  "sort",
  "splice",
  "toReversed",
  "toSorted",
]);
const signalArrayElementCallbackMethods = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flatMap",
  "forEach",
  "map",
  "some",
]);
const scalarPlotKinds = new Map([
  ["line", "line"],
  ["hline", "hline"],
  ["histogram", "histogram"],
  ["shape", "shape"],
]);
const literalStringPlotDeclarationOptions = new Set([
  "key",
  "title",
  "style",
  "direction",
  "text",
  "textColor",
]);
const sdkConstantPlotDeclarationOptions = new Set([
  "shape",
  "location",
  "textSize",
]);
const staticPlotDeclarationOptions = new Set([
  ...literalStringPlotDeclarationOptions,
  ...sdkConstantPlotDeclarationOptions,
]);

function withoutNames(map, names) {
  if (map.size === 0 || names.size === 0) return map;
  const next = new Map(map);
  for (const name of names) next.delete(name);
  return next;
}

function withoutNameSet(values, names) {
  if (values.size === 0 || names.size === 0) return values;
  const next = new Set(values);
  for (const name of names) next.delete(name);
  return next;
}

function sdkBindings(sourceFile) {
  const named = new Map();
  const namespaceLike = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== sdkModule ||
      statement.importClause?.isTypeOnly === true
    )
      continue;
    const clause = statement.importClause;
    if (clause === undefined) continue;
    if (clause.name !== undefined) namespaceLike.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaceLike.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const imported = element.propertyName?.text ?? element.name.text;
      if (sdkRoots.has(imported)) named.set(element.name.text, imported);
    }
  }
  return { named, namespaceLike };
}

function propertyPath(expression) {
  const parts = [];
  let current = expression;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  return ts.isIdentifier(current) ? { root: current.text, parts } : undefined;
}

function directIndicatorSeriesSource(expression, bindings) {
  const wholeBarSource =
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    builtInSeriesNames.has(expression.name.text)
      ? { identifier: expression.expression, sourceName: expression.name.text }
      : undefined;
  const identifier = ts.isIdentifier(expression)
    ? expression
    : wholeBarSource?.identifier;
  if (identifier === undefined) return undefined;
  const requestedName = identifier.text;
  let current = identifier.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) {
      const parent = current.parent;
      if (!(
        (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
        ts.isCallExpression(parent) &&
        parent.arguments[1] === current &&
        ts.isIdentifier(parent.expression) &&
        bindings.get(parent.expression.text) === "defineIndicator"
      ))
        return undefined;
      const parameter = current.parameters[0];
      if (parameter === undefined) return undefined;
      if (ts.isIdentifier(parameter.name))
        return parameter.name.text === requestedName
          ? wholeBarSource?.sourceName
          : undefined;
      if (!ts.isObjectBindingPattern(parameter.name) || wholeBarSource !== undefined)
        return undefined;
      for (const element of parameter.name.elements) {
        if (
          !ts.isIdentifier(element.name) ||
          element.name.text !== requestedName
        )
          continue;
        const sourceName =
          element.propertyName === undefined
            ? element.name.text
            : ts.isIdentifier(element.propertyName)
              ? element.propertyName.text
              : undefined;
        return sourceName !== undefined && builtInSeriesNames.has(sourceName)
          ? sourceName
          : undefined;
      }
      return undefined;
    }
    const names = scopedNames(current);
    if (names?.has(requestedName)) return undefined;
    current = current.parent;
  }
  return undefined;
}

function variableInitializerForReference(identifier) {
  const requestedName = identifier.text;
  let current = identifier.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isBlock(current) || ts.isCaseBlock(current)) {
      const statements = ts.isCaseBlock(current)
        ? current.clauses.flatMap((clause) => [...clause.statements])
        : current.statements;
      for (const statement of statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === requestedName
          )
            return declaration.initializer;
        }
      }
    }
    if (ts.isFunctionLike(current)) return undefined;
    current = current.parent;
  }
  return undefined;
}

function signalVariableInitializerForReference(identifier) {
  const requestedName = identifier.text;
  let current = identifier.parent;
  while (current !== undefined) {
    if (
      ts.isBlock(current) ||
      ts.isCaseBlock(current) ||
      ts.isSourceFile(current)
    ) {
      const statements = ts.isCaseBlock(current)
        ? current.clauses.flatMap((clause) => [...clause.statements])
        : current.statements;
      for (const statement of statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === requestedName
          )
            return declaration.initializer;
        }
      }
      if (scopedNames(current)?.has(requestedName)) return undefined;
    }
    if (ts.isFunctionLike(current) && scopedNames(current)?.has(requestedName))
      return undefined;
    current = current.parent;
  }
  return undefined;
}

function signalVariableDeclarationForReference(identifier) {
  const requestedName = identifier.text;
  let current = identifier.parent;
  while (current !== undefined) {
    if (
      ts.isBlock(current) ||
      ts.isCaseBlock(current) ||
      ts.isSourceFile(current)
    ) {
      const statements = ts.isCaseBlock(current)
        ? current.clauses.flatMap((clause) => [...clause.statements])
        : current.statements;
      for (const statement of statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === requestedName
          )
            return declaration;
        }
      }
      if (scopedNames(current)?.has(requestedName)) return undefined;
    }
    if (ts.isFunctionLike(current) && scopedNames(current)?.has(requestedName))
      return undefined;
    current = current.parent;
  }
  return undefined;
}

function signalIdentifierIsWriteReference(identifier) {
  const parent = identifier.parent;
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === identifier &&
    ts.isAssignmentOperator(parent.operatorToken.kind)
  )
    return true;
  return (
    (ts.isPrefixUnaryExpression(parent) ||
      ts.isPostfixUnaryExpression(parent)) &&
    parent.operand === identifier &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken)
  );
}

function signalVariableIsReassignedBeforeReference(identifier) {
  const declaration = signalVariableDeclarationForReference(identifier);
  if (declaration === undefined) return false;
  const requestedName = identifier.text;
  let root = declaration.parent;
  while (
    root.parent !== undefined &&
    !ts.isBlock(root) &&
    !ts.isCaseBlock(root) &&
    !ts.isSourceFile(root)
  )
    root = root.parent;
  let reassigned = false;
  const visit = (node) => {
    if (reassigned || node.pos >= identifier.pos) return;
    if (node !== root) {
      const names = scopedNames(node);
      if (names?.has(requestedName)) return;
    }
    if (
      ts.isIdentifier(node) &&
      node !== declaration.name &&
      node.text === requestedName &&
      node.pos > declaration.end &&
      signalIdentifierIsWriteReference(node)
    ) {
      reassigned = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return reassigned;
}

function signalIndicatorSeriesSources(identifier, bindings) {
  const requestedName = identifier.text;
  let current = identifier.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) {
      const parent = current.parent;
      const isIndicatorCalculation =
        (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
        ts.isCallExpression(parent) &&
        parent.arguments[1] === current &&
        ts.isIdentifier(parent.expression) &&
        bindings.get(parent.expression.text) === "defineIndicator";
      if (isIndicatorCalculation) {
        const parameter = current.parameters[0];
        if (parameter === undefined) return [];
        if (ts.isIdentifier(parameter.name)) {
          if (parameter.name.text !== requestedName) return [];
          const parent = identifier.parent;
          if (
            ts.isPropertyAccessExpression(parent) &&
            parent.expression === identifier &&
            builtInSeriesNames.has(parent.name.text)
          )
            return [parent.name.text];
          return [...builtInSeriesNames];
        }
        if (!ts.isObjectBindingPattern(parameter.name)) return [];
        for (const element of parameter.name.elements) {
          if (
            !ts.isIdentifier(element.name) ||
            element.name.text !== requestedName
          )
            continue;
          const sourceName =
            element.propertyName === undefined
              ? element.name.text
              : ts.isIdentifier(element.propertyName)
                ? element.propertyName.text
                : undefined;
          return sourceName !== undefined && builtInSeriesNames.has(sourceName)
            ? [sourceName]
            : [];
        }
        return [];
      }
      if (scopedNames(current)?.has(requestedName)) return [];
    } else if (scopedNames(current)?.has(requestedName)) return [];
    current = current.parent;
  }
  return [];
}

function signalIdentifierIsValueReference(identifier) {
  const parent = identifier.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier)
    return false;
  if (ts.isQualifiedName(parent) && parent.right === identifier) return false;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === identifier)
    return true;
  if (ts.isDeclarationName(identifier) || ts.isPartOfTypeNode(identifier))
    return false;
  if (
    (ts.isLabeledStatement(parent) ||
      ts.isBreakStatement(parent) ||
      ts.isContinueStatement(parent)) &&
    parent.label === identifier
  )
    return false;
  return true;
}

function localFunctionForReference(identifier) {
  const requestedName = identifier.text;
  let current = identifier.parent;
  while (current !== undefined) {
    if (
      ts.isBlock(current) ||
      ts.isCaseBlock(current) ||
      ts.isSourceFile(current)
    ) {
      const statements = ts.isCaseBlock(current)
        ? current.clauses.flatMap((clause) => [...clause.statements])
        : current.statements;
      for (const statement of statements) {
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (
              ts.isIdentifier(declaration.name) &&
              declaration.name.text === requestedName
            ) {
              const initializer = declaration.initializer;
              return initializer !== undefined &&
                (ts.isArrowFunction(initializer) ||
                  ts.isFunctionExpression(initializer))
                ? initializer
                : undefined;
            }
          }
        }
        if (
          ts.isFunctionDeclaration(statement) &&
          statement.name?.text === requestedName
        )
          return statement;
      }
      if (scopedNames(current)?.has(requestedName)) return undefined;
    }
    if (ts.isFunctionLike(current) && scopedNames(current)?.has(requestedName))
      return undefined;
    current = current.parent;
  }
  return undefined;
}

function unwrapSignalCallable(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  )
    current = current.expression;
  return current;
}

function propertyNameText(name) {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  )
    return name.text;
  return undefined;
}

function functionLikeObjectMember(objectLiteral, memberName) {
  for (const property of objectLiteral.properties) {
    if (propertyNameText(property.name) !== memberName) continue;
    if (ts.isMethodDeclaration(property)) return property;
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isArrowFunction(property.initializer) ||
        ts.isFunctionExpression(property.initializer))
    )
      return property.initializer;
    if (ts.isShorthandPropertyAssignment(property))
      return localFunctionForReference(property.name);
    return undefined;
  }
  return undefined;
}

function signalCallableLabel(expression) {
  const callable = unwrapSignalCallable(expression);
  if (ts.isIdentifier(callable)) return callable.text;
  if (ts.isPropertyAccessExpression(callable))
    return `${signalCallableLabel(callable.expression)}.${callable.name.text}`;
  if (
    ts.isElementAccessExpression(callable) &&
    (ts.isStringLiteral(callable.argumentExpression) ||
      ts.isNumericLiteral(callable.argumentExpression))
  )
    return `${signalCallableLabel(callable.expression)}[${JSON.stringify(callable.argumentExpression.text)}]`;
  if (ts.isArrowFunction(callable) || ts.isFunctionExpression(callable))
    return "inline function";
  return "callable";
}

function signalTypeIsArray(type, resolving = new Set()) {
  let current = type;
  while (
    current !== undefined &&
    ts.isTypeOperatorNode(current) &&
    current.operator === ts.SyntaxKind.ReadonlyKeyword
  )
    current = current.type;
  if (current === undefined) return false;
  if (ts.isArrayTypeNode(current) || ts.isTupleTypeNode(current)) return true;
  if (
    ts.isTypeReferenceNode(current) &&
    ts.isIdentifier(current.typeName) &&
    (current.typeName.text === "Array" ||
      current.typeName.text === "ReadonlyArray")
  )
    return true;
  if (!ts.isTypeReferenceNode(current) || !ts.isIdentifier(current.typeName))
    return false;
  const declaration = signalNamedTypeDeclaration(
    current.getSourceFile(),
    current.typeName.text,
  );
  if (!ts.isTypeAliasDeclaration(declaration) || resolving.has(declaration))
    return false;
  resolving.add(declaration);
  const result = signalTypeIsArray(declaration.type, resolving);
  resolving.delete(declaration);
  return result;
}

function signalNamedTypeDeclaration(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (
      (ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name?.text === name
    )
      return statement;
  }
  return undefined;
}

function signalArrayElementType(type, resolving = new Set()) {
  let current = type;
  while (
    current !== undefined &&
    ts.isTypeOperatorNode(current) &&
    current.operator === ts.SyntaxKind.ReadonlyKeyword
  )
    current = current.type;
  if (current === undefined) return undefined;
  if (ts.isArrayTypeNode(current)) return current.elementType;
  if (
    ts.isTypeReferenceNode(current) &&
    ts.isIdentifier(current.typeName) &&
    (current.typeName.text === "Array" ||
      current.typeName.text === "ReadonlyArray")
  )
    return current.typeArguments?.[0];
  if (!ts.isTypeReferenceNode(current) || !ts.isIdentifier(current.typeName))
    return undefined;
  const declaration = signalNamedTypeDeclaration(
    current.getSourceFile(),
    current.typeName.text,
  );
  if (!ts.isTypeAliasDeclaration(declaration) || resolving.has(declaration))
    return undefined;
  resolving.add(declaration);
  const result = signalArrayElementType(declaration.type, resolving);
  resolving.delete(declaration);
  return result;
}

function signalPropertyTypeForType(type, propertyName, resolving = new Set()) {
  let current = type;
  while (
    current !== undefined &&
    ts.isTypeOperatorNode(current) &&
    current.operator === ts.SyntaxKind.ReadonlyKeyword
  )
    current = current.type;
  if (current === undefined) return undefined;
  if (ts.isParenthesizedTypeNode(current))
    return signalPropertyTypeForType(current.type, propertyName, resolving);
  if (ts.isUnionTypeNode(current)) {
    const nonNullish = current.types.filter(
      (member) =>
        member.kind !== ts.SyntaxKind.UndefinedKeyword &&
        !(
          ts.isLiteralTypeNode(member) &&
          member.literal.kind === ts.SyntaxKind.NullKeyword
        ),
    );
    return nonNullish.length === 1
      ? signalPropertyTypeForType(nonNullish[0], propertyName, resolving)
      : undefined;
  }
  if (ts.isTypeLiteralNode(current)) {
    for (const member of current.members) {
      if (
        (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) &&
        member.type !== undefined &&
        propertyNameText(member.name) === propertyName
      )
        return member.type;
    }
    return undefined;
  }
  if (!ts.isTypeReferenceNode(current) || !ts.isIdentifier(current.typeName))
    return undefined;
  if (
    current.typeName.text === "Readonly" &&
    current.typeArguments?.length === 1
  )
    return signalPropertyTypeForType(
      current.typeArguments[0],
      propertyName,
      resolving,
    );
  const declaration = signalNamedTypeDeclaration(
    current.getSourceFile(),
    current.typeName.text,
  );
  if (declaration === undefined || resolving.has(declaration)) return undefined;
  resolving.add(declaration);
  let result;
  if (ts.isTypeAliasDeclaration(declaration)) {
    result = signalPropertyTypeForType(
      declaration.type,
      propertyName,
      resolving,
    );
  } else {
    for (const member of declaration.members) {
      if (
        (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) &&
        member.type !== undefined &&
        propertyNameText(member.name) === propertyName
      ) {
        result = member.type;
        break;
      }
    }
  }
  resolving.delete(declaration);
  return result;
}

function signalSourceFileImportBindsName(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (clause === undefined) continue;
    if (clause.name?.text === name) return true;
    const named = clause.namedBindings;
    if (named === undefined) continue;
    if (ts.isNamespaceImport(named)) {
      if (named.name.text === name) return true;
      continue;
    }
    if (named.elements.some((element) => element.name.text === name)) return true;
  }
  return false;
}

function signalNameIsLexicallyBoundAt(node, name) {
  let current = node.parent;
  while (current !== undefined) {
    if (scopedNames(current)?.has(name)) return true;
    if (
      ts.isSourceFile(current) &&
      signalSourceFileImportBindsName(current, name)
    )
      return true;
    current = current.parent;
  }
  return false;
}

function signalCallbackParameterType(functionLike, parameterIndex) {
  if (parameterIndex !== 0) return undefined;
  let callback = functionLike;
  let parent = callback.parent;
  while (
    parent !== undefined &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isSatisfiesExpression(parent)) &&
    parent.expression === callback
  ) {
    callback = parent;
    parent = parent.parent;
  }
  if (!ts.isCallExpression(parent) || parent.arguments[0] !== callback)
    return undefined;
  const callable = unwrapSignalCallable(parent.expression);
  if (
    !ts.isPropertyAccessExpression(callable) ||
    !signalArrayElementCallbackMethods.has(callable.name.text)
  )
    return undefined;
  return signalExpressionArrayElementType(callable.expression);
}

function signalIdentifierDeclaredType(identifier) {
  const requestedName = identifier.text;
  let current = identifier.parent;
  while (current !== undefined) {
    if (ts.isFunctionLike(current)) {
      for (let index = 0; index < current.parameters.length; index += 1) {
        const parameter = current.parameters[index];
        if (
          ts.isIdentifier(parameter.name) &&
          parameter.name.text === requestedName
        )
          return (
            parameter.type ?? signalCallbackParameterType(current, index)
          );
      }
      if (scopedNames(current)?.has(requestedName)) return undefined;
    }
    if (
      ts.isBlock(current) ||
      ts.isCaseBlock(current) ||
      ts.isSourceFile(current)
    ) {
      const statements = ts.isCaseBlock(current)
        ? current.clauses.flatMap((clause) => [...clause.statements])
        : current.statements;
      for (const statement of statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === requestedName
          )
            return declaration.type;
        }
      }
      if (scopedNames(current)?.has(requestedName)) return undefined;
    }
    if (
      ts.isForOfStatement(current) &&
      ts.isVariableDeclarationList(current.initializer)
    ) {
      for (const declaration of current.initializer.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === requestedName
        )
          return signalExpressionArrayElementType(current.expression);
      }
    }
    current = current.parent;
  }
  return undefined;
}

function signalExpressionDeclaredType(expression, resolving = new Set()) {
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression))
    return expression.type;
  const value = unwrapSignalCallable(expression);
  if (ts.isIdentifier(value)) {
    const declaredType = signalIdentifierDeclaredType(value);
    if (declaredType !== undefined) return declaredType;
    const initializer = signalVariableInitializerForReference(value);
    if (initializer === undefined || resolving.has(initializer)) return undefined;
    resolving.add(initializer);
    const result = signalExpressionDeclaredType(initializer, resolving);
    resolving.delete(initializer);
    return result;
  }
  if (ts.isCallExpression(value)) {
    const callable = unwrapSignalCallable(value.expression);
    let helper;
    if (ts.isIdentifier(callable)) helper = localFunctionForReference(callable);
    else if (
      ts.isPropertyAccessExpression(callable) &&
      ts.isIdentifier(callable.expression)
    ) {
      const initializer = signalVariableInitializerForReference(
        callable.expression,
      );
      if (
        initializer !== undefined &&
        ts.isObjectLiteralExpression(initializer)
      )
        helper = functionLikeObjectMember(initializer, callable.name.text);
    }
    return helper?.type;
  }
  if (!ts.isPropertyAccessExpression(value)) return undefined;
  const ownerType = signalExpressionDeclaredType(value.expression, resolving);
  return ownerType === undefined
    ? undefined
    : signalPropertyTypeForType(ownerType, value.name.text);
}

function signalExpressionArrayElementType(expression, resolving = new Set()) {
  const declaredType = signalExpressionDeclaredType(expression);
  if (declaredType !== undefined) {
    const elementType = signalArrayElementType(declaredType);
    if (elementType !== undefined) return elementType;
  }
  const value = unwrapSignalCallable(expression);
  if (ts.isIdentifier(value)) {
    const initializer = signalVariableInitializerForReference(value);
    if (initializer === undefined || resolving.has(initializer)) return undefined;
    resolving.add(initializer);
    const result = signalExpressionArrayElementType(initializer, resolving);
    resolving.delete(initializer);
    return result;
  }
  if (ts.isArrayLiteralExpression(value)) {
    if (value.elements.length !== 1) return undefined;
    const only = value.elements[0];
    return ts.isSpreadElement(only)
      ? signalExpressionArrayElementType(only.expression, resolving)
      : undefined;
  }
  if (!ts.isCallExpression(value)) return undefined;
  const callable = unwrapSignalCallable(value.expression);
  if (
    ts.isPropertyAccessExpression(callable) &&
    signalArrayElementPreservingMethods.has(callable.name.text)
  )
    return signalExpressionArrayElementType(callable.expression, resolving);
  return undefined;
}

function signalIdentifierHasDeclaredArrayType(identifier) {
  const requestedName = identifier.text;
  let current = identifier.parent;
  while (current !== undefined) {
    if (ts.isFunctionLike(current)) {
      for (const parameter of current.parameters) {
        if (
          ts.isIdentifier(parameter.name) &&
          parameter.name.text === requestedName
        )
          return signalTypeIsArray(parameter.type);
      }
      if (scopedNames(current)?.has(requestedName)) return false;
    }
    if (
      ts.isBlock(current) ||
      ts.isCaseBlock(current) ||
      ts.isSourceFile(current)
    ) {
      const statements = ts.isCaseBlock(current)
        ? current.clauses.flatMap((clause) => [...clause.statements])
        : current.statements;
      for (const statement of statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === requestedName
          )
            return signalTypeIsArray(declaration.type);
        }
      }
      if (scopedNames(current)?.has(requestedName)) return false;
    }
    current = current.parent;
  }
  return false;
}

function signalExpressionIsProvableArray(expression, resolving = new Set()) {
  const value = unwrapSignalCallable(expression);
  if (ts.isArrayLiteralExpression(value)) return true;
  if (ts.isIdentifier(value)) {
    const initializer = signalVariableInitializerForReference(value);
    if (initializer !== undefined && !resolving.has(initializer)) {
      resolving.add(initializer);
      const result = signalExpressionIsProvableArray(initializer, resolving);
      resolving.delete(initializer);
      if (result) return true;
    }
    return signalIdentifierHasDeclaredArrayType(value);
  }
  if (ts.isPropertyAccessExpression(value)) {
    const declaredType = signalExpressionDeclaredType(value);
    return declaredType !== undefined && signalTypeIsArray(declaredType);
  }
  if (!ts.isCallExpression(value)) return false;
  const callable = unwrapSignalCallable(value.expression);
  if (
    ts.isPropertyAccessExpression(callable) &&
    signalArrayReturningMethods.has(callable.name.text)
  )
    return signalExpressionIsProvableArray(callable.expression, resolving);
  return (
    ts.isPropertyAccessExpression(callable) &&
    ts.isIdentifier(callable.expression) &&
    callable.expression.text === "Array" &&
    (callable.name.text === "from" || callable.name.text === "of")
  );
}

function signalCallableAnalysis(expression, bindings) {
  const callable = unwrapSignalCallable(expression);
  if (ts.isArrowFunction(callable) || ts.isFunctionExpression(callable))
    return { kind: "helper", helper: callable };
  if (ts.isIdentifier(callable)) {
    const imported = bindings.get(callable.text);
    if (imported !== undefined && signalSafeSdkFunctionRoots.has(imported))
      return { kind: "safe" };
    const helper = localFunctionForReference(callable);
    return helper === undefined
      ? { kind: "unresolved" }
      : { kind: "helper", helper };
  }
  if (ts.isPropertyAccessExpression(callable)) {
    const root = propertyPath(callable)?.root;
    if (
      root !== undefined &&
      signalSafeBuiltinCallRoots.has(root) &&
      !signalNameIsLexicallyBoundAt(callable, root)
    )
      return { kind: "safe" };
    if (ts.isIdentifier(callable.expression)) {
      const initializer = signalVariableInitializerForReference(
        callable.expression,
      );
      if (
        initializer !== undefined &&
        ts.isObjectLiteralExpression(initializer)
      ) {
        const helper = functionLikeObjectMember(
          initializer,
          callable.name.text,
        );
        if (helper !== undefined) return { kind: "helper", helper };
      }
    }
    if (
      signalSafeArrayMethods.has(callable.name.text) &&
      signalExpressionIsProvableArray(callable.expression)
    )
      return { kind: "safe" };
    return { kind: "unresolved" };
  }
  if (
    ts.isElementAccessExpression(callable) &&
    ts.isIdentifier(callable.expression) &&
    (ts.isStringLiteral(callable.argumentExpression) ||
      ts.isNumericLiteral(callable.argumentExpression))
  ) {
    const initializer = signalVariableInitializerForReference(
      callable.expression,
    );
    if (
      initializer !== undefined &&
      ts.isObjectLiteralExpression(initializer)
    ) {
      const helper = functionLikeObjectMember(
        initializer,
        callable.argumentExpression.text,
      );
      if (helper !== undefined) return { kind: "helper", helper };
    }
    return { kind: "unresolved" };
  }
  return { kind: "unresolved" };
}

function helperSignalCallRisk(
  functionLike,
  callsiteByNode,
  bindings,
  resolving = new Set(),
) {
  if (resolving.has(functionLike)) return undefined;
  resolving.add(functionLike);
  let risk;
  const visit = (node) => {
    if (risk !== undefined) return;
    if (node !== functionLike && ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) {
      const metadata = callsiteByNode.get(node)?.metadata;
      if (metadata?.kind === "ta") {
        risk = "ta";
        return;
      }
      if (metadata === undefined) {
        const analysis = signalCallableAnalysis(node.expression, bindings);
        if (analysis.kind === "helper") {
          const nestedRisk = helperSignalCallRisk(
            analysis.helper,
            callsiteByNode,
            bindings,
            resolving,
          );
          if (nestedRisk !== undefined) {
            risk = nestedRisk;
            return;
          }
        }
        if (analysis.kind === "unresolved") {
          risk = "unresolved";
          return;
        }
      }
      for (const argument of node.arguments) {
        const candidate = unwrapSignalCallable(argument);
        let callback;
        if (ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate))
          callback = candidate;
        else if (ts.isIdentifier(candidate))
          callback = localFunctionForReference(candidate);
        if (callback === undefined) continue;
        const callbackRisk = helperSignalCallRisk(
          callback,
          callsiteByNode,
          bindings,
          resolving,
        );
        if (callbackRisk !== undefined) {
          risk = callbackRisk;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  if (functionLike.body !== undefined) visit(functionLike.body);
  resolving.delete(functionLike);
  return risk;
}

function helperIsNestedInIndicatorCalculation(functionLike, bindings) {
  let current = functionLike.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) {
      const parent = current.parent;
      if (
        (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
        ts.isCallExpression(parent) &&
        parent.arguments[1] === current &&
        ts.isIdentifier(parent.expression) &&
        bindings.get(parent.expression.text) === "defineIndicator"
      )
        return true;
    }
    current = current.parent;
  }
  return false;
}

function timeframeInputCallForExpression(expression, callsiteByNode) {
  if (ts.isCallExpression(expression)) {
    const metadata = callsiteByNode.get(expression)?.metadata;
    return metadata?.callee === "input.timeframe" ? expression : undefined;
  }
  if (!ts.isIdentifier(expression)) return undefined;
  const initializer = variableInitializerForReference(expression);
  if (initializer === undefined) return undefined;
  return timeframeInputCallForExpression(initializer, callsiteByNode);
}

function candleTypeInputCallForExpression(expression, callsiteByNode) {
  if (ts.isCallExpression(expression)) {
    const metadata = callsiteByNode.get(expression)?.metadata;
    return metadata?.callee === "input.candleType" ? expression : undefined;
  }
  if (!ts.isIdentifier(expression)) return undefined;
  const initializer = variableInitializerForReference(expression);
  if (initializer === undefined) return undefined;
  return candleTypeInputCallForExpression(initializer, callsiteByNode);
}

function signalDependencyMetadata(
  expression,
  callsiteByNode,
  bindings,
  sourceFile,
) {
  const dependencies = [];
  const dependencyIds = new Set();
  const chartSeries = [];
  const chartSeriesNames = new Set();
  const resolving = new Set();

  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      if (!signalIdentifierIsValueReference(node)) return;
      const seriesSources = signalIndicatorSeriesSources(node, bindings);
      if (seriesSources.length > 0) {
        for (const seriesSource of seriesSources) {
          if (!chartSeriesNames.has(seriesSource)) {
            chartSeriesNames.add(seriesSource);
            chartSeries.push(seriesSource);
          }
        }
        return;
      }
      if (signalVariableIsReassignedBeforeReference(node))
        throw syntaxError(
          sourceFile,
          node,
          `signal condition variable ${node.text} is reassigned; use a statically traceable const expression`,
        );
      const initializer = signalVariableInitializerForReference(node);
      if (initializer !== undefined && !resolving.has(initializer)) {
        resolving.add(initializer);
        visit(initializer);
        resolving.delete(initializer);
      }
      return;
    }
    if (ts.isCallExpression(node)) {
      const metadata = callsiteByNode.get(node)?.metadata;
      if (metadata?.kind === "ta" && !dependencyIds.has(metadata.id)) {
        dependencyIds.add(metadata.id);
        dependencies.push(metadata.id);
      }
      if (metadata === undefined) {
        const analysis = signalCallableAnalysis(node.expression, bindings);
        if (analysis.kind === "unresolved")
          throw syntaxError(
            sourceFile,
            node,
            `signal condition callable ${signalCallableLabel(node.expression)} cannot be resolved; use a statically traceable local helper or hoist runtime dependencies into the indicator calculation`,
          );
        const helper = analysis.kind === "helper" ? analysis.helper : undefined;
        if (
          helper !== undefined &&
          helperIsNestedInIndicatorCalculation(helper, bindings)
        )
          throw syntaxError(
            sourceFile,
            node,
            `signal condition helper ${signalCallableLabel(node.expression)} is nested in the indicator calculation; move it to module scope and pass runtime dependencies as arguments so signal dependencies remain statically traceable`,
          );
        if (helper !== undefined) {
          const risk = helperSignalCallRisk(helper, callsiteByNode, bindings);
          if (risk === "ta")
            throw syntaxError(
              sourceFile,
              node,
              `signal condition helper ${signalCallableLabel(node.expression)} executes ta.* internally; hoist TA calls into the indicator calculation and pass their results into the helper so signal dependencies remain statically traceable`,
            );
          if (risk === "unresolved")
            throw syntaxError(
              sourceFile,
              node,
              `signal condition helper ${signalCallableLabel(node.expression)} invokes a callable that cannot be resolved; keep signal-condition helpers statically traceable`,
            );
        }
      }
      for (let index = 0; index < node.arguments.length; index += 1) {
        if (
          metadata?.kind === "ta" &&
          index === 0 &&
          metadata.seriesSource !== undefined
        )
          continue;
        visit(node.arguments[index]);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(expression);
  return Object.freeze({
    dependencies: Object.freeze(dependencies),
    chartSeries: Object.freeze(chartSeries),
  });
}

function classifyCall(node, bindings) {
  if (ts.isIdentifier(node.expression)) {
    const imported = bindings.get(node.expression.text);
    if (imported === "signal")
      return { kind: "signal", callee: "signal", authorArity: 3 };
    if (imported === "series")
      return { kind: "state", callee: "series", authorArity: 2 };
    return undefined;
  }
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  if (!ts.isIdentifier(node.expression.expression)) return undefined;
  const imported = bindings.get(node.expression.expression.text);
  if (imported === undefined) return undefined;
  const method = node.expression.name.text;
  if (imported === "input")
    return { kind: "input", callee: `input.${method}`, authorArity: 2 };
  if (imported === "ta")
    return statefulTaMethods.has(method)
      ? {
          kind: "ta",
          callee: `ta.${method}`,
          authorArity: method === "movingAverage" ? 3 : 2,
        }
      : undefined;
  if (imported === "plot")
    return {
      kind: drawingMethods.has(method) ? "drawing" : "plot",
      callee: `plot.${method}`,
      authorArity:
        method === "box" || method === "segment" || method === "remove"
          ? 1
          : method === "fill" || method === "shape"
            ? 3
            : 2,
    };
  return undefined;
}

function canonicalText(node, sourceFile, printer) {
  return printer
    .printNode(ts.EmitHint.Unspecified, node, sourceFile)
    .replace(/\s+/gu, " ")
    .trim();
}

function functionSemanticName(node, sourceFile, printer) {
  if (node.name !== undefined && ts.isIdentifier(node.name))
    return node.name.text;
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name))
    return parent.name.text;
  if (ts.isPropertyAssignment(parent))
    return `property:${canonicalText(parent.name, sourceFile, printer)}`;
  if (ts.isCallExpression(parent)) {
    const index = parent.arguments.findIndex((argument) => argument === node);
    return `callback:${canonicalText(parent.expression, sourceFile, printer)}:${index}`;
  }
  return "anonymous";
}

function semanticScope(node, sourceFile, printer) {
  const result = [];
  let child = node;
  let current = node.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) {
      result.unshift(
        `fn:${functionSemanticName(current, sourceFile, printer)}`,
      );
    } else if (ts.isIfStatement(current)) {
      const branch = current.thenStatement === child ? "then" : "else";
      result.unshift(
        `if:${canonicalText(current.expression, sourceFile, printer)}:${branch}`,
      );
    } else if (ts.isCaseClause(current)) {
      result.unshift(
        `case:${canonicalText(current.expression, sourceFile, printer)}`,
      );
    } else if (ts.isDefaultClause(current)) {
      result.unshift("case:default");
    } else if (ts.isForStatement(current)) {
      result.unshift(
        `for:${current.condition === undefined ? "" : canonicalText(current.condition, sourceFile, printer)}`,
      );
    } else if (ts.isForInStatement(current) || ts.isForOfStatement(current)) {
      result.unshift(
        `${ts.isForInStatement(current) ? "for-in" : "for-of"}:${canonicalText(current.expression, sourceFile, printer)}`,
      );
    } else if (ts.isWhileStatement(current) || ts.isDoStatement(current)) {
      result.unshift(
        `${ts.isWhileStatement(current) ? "while" : "do"}:${canonicalText(current.expression, sourceFile, printer)}`,
      );
    }
    child = current;
    current = current.parent;
  }
  return result;
}

function semanticAnchor(node, sourceFile, printer) {
  let current = node.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isVariableDeclaration(current))
      return `binding:${canonicalText(current.name, sourceFile, printer)}`;
    if (ts.isPropertyAssignment(current))
      return `property:${canonicalText(current.name, sourceFile, printer)}`;
    if (ts.isExpressionStatement(current))
      return `expression:${canonicalText(node, sourceFile, printer)}`;
    if (ts.isReturnStatement(current))
      return `return:${canonicalText(node, sourceFile, printer)}`;
    if (ts.isFunctionLike(current)) break;
    current = current.parent;
  }
  return `call:${canonicalText(node, sourceFile, printer)}`;
}

function sourceLocation(node, sourceFile, sourceFileId) {
  const location = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return Object.freeze({
    file: sourceFileId.replaceAll("\\", "/"),
    line: location.line + 1,
    column: location.character + 1,
  });
}

function staticPropertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function staticLiteralPrimitive(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  )
    return -Number(node.operand.text);
  return undefined;
}

function staticPrimitive(node, bindings) {
  const literal = staticLiteralPrimitive(node);
  if (literal !== undefined) return literal;
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const imported = bindings.get(node.expression.text);
    const values =
      imported === undefined ? undefined : sdkConstantValues[imported];
    return values?.[node.name.text];
  }
  return undefined;
}

function staticStringArgument(sourceFile, node, bindings, message) {
  const value = staticPrimitive(node, bindings);
  if (typeof value !== "string") throw syntaxError(sourceFile, node, message);
  return value;
}

function compilerPlotDeclaration(
  node,
  classified,
  metadata,
  sourceFile,
  bindings,
) {
  if (classified.kind !== "plot") return undefined;
  const method = classified.callee.slice("plot.".length);
  const kind = scalarPlotKinds.get(method);
  if (kind === undefined) return undefined;

  const declaration = {
    id: metadata.id,
    kind,
    source: metadata.source,
  };
  const options = node.arguments[1];
  if (options === undefined) return Object.freeze(declaration);
  if (method === "shape" && !ts.isObjectLiteralExpression(options)) {
    const second = staticStringArgument(
      sourceFile,
      options,
      bindings,
      "plot.shape text/marker overloads must use SDK constants or static string literals so declaration metadata can be compiled.",
    );
    const text = node.arguments[2];
    if (text === undefined) {
      declaration.text = second;
    } else {
      declaration.shape = second;
      declaration.text = staticStringArgument(
        sourceFile,
        text,
        bindings,
        "plot.shape marker text must use a static string literal so declaration metadata can be compiled.",
      );
    }
    return Object.freeze(declaration);
  }
  if (!ts.isObjectLiteralExpression(options))
    throw syntaxError(
      sourceFile,
      options,
      "Plot options must use an object literal so declaration metadata can be compiled.",
    );

  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property))
      throw syntaxError(
        sourceFile,
        property,
        "Plot options cannot use spreads because declaration metadata must be statically knowable.",
      );
    if (ts.isShorthandPropertyAssignment(property)) {
      if (staticPlotDeclarationOptions.has(property.name.text))
        throw syntaxError(
          sourceFile,
          property,
          `Plot declaration option "${property.name.text}" must use a static literal.`,
        );
      continue;
    }
    if (
      ts.isMethodDeclaration(property) ||
      ts.isGetAccessorDeclaration(property) ||
      ts.isSetAccessorDeclaration(property)
    ) {
      const name = staticPropertyName(property.name);
      if (name === undefined)
        throw syntaxError(
          sourceFile,
          property,
          "Plot option names must be static so declaration metadata can be compiled.",
        );
      if (staticPlotDeclarationOptions.has(name))
        throw syntaxError(
          sourceFile,
          property,
          `Plot declaration option "${name}" must use a static literal.`,
        );
      continue;
    }
    if (!ts.isPropertyAssignment(property)) continue;
    const name = staticPropertyName(property.name);
    if (name === undefined)
      throw syntaxError(
        sourceFile,
        property,
        "Plot option names must be static so declaration metadata can be compiled.",
      );
    if (
      name !== "key" &&
      name !== "title" &&
      name !== "color" &&
      name !== "width" &&
      name !== "style" &&
      name !== "direction" &&
      name !== "shape" &&
      name !== "location" &&
      name !== "text" &&
      name !== "textColor" &&
      name !== "textSize"
    )
      continue;
    const acceptsSdkConstant = sdkConstantPlotDeclarationOptions.has(name);
    const value = acceptsSdkConstant
      ? staticPrimitive(property.initializer, bindings)
      : staticLiteralPrimitive(property.initializer);
    if (staticPlotDeclarationOptions.has(name) && typeof value !== "string")
      throw syntaxError(
        sourceFile,
        property.initializer,
        acceptsSdkConstant
          ? `Plot declaration option "${name}" must use an SDK constant or static string literal.`
          : `Plot declaration option "${name}" must use a static string literal.`,
      );
    if (value !== undefined) declaration[name] = value;
  }
  return Object.freeze(declaration);
}

function syntaxError(sourceFile, node, message) {
  const location = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return new SyntaxError(
    `${sourceFile.fileName}:${location.line + 1}:${location.character + 1} ${message}`,
  );
}

function uniqueTokenPrefix(sourceText) {
  let prefix = "__ercCallsite_";
  while (new RegExp(`\\b${prefix}\\d*\\b`, "u").test(sourceText)) prefix += "_";
  return prefix;
}

function callsiteDeclaration(factory, name, metadata) {
  const source = factory.createObjectLiteralExpression(
    [
      factory.createPropertyAssignment(
        "file",
        factory.createStringLiteral(metadata.source.file),
      ),
      factory.createPropertyAssignment(
        "line",
        factory.createNumericLiteral(metadata.source.line),
      ),
      factory.createPropertyAssignment(
        "column",
        factory.createNumericLiteral(metadata.source.column),
      ),
    ],
    false,
  );
  const value = factory.createObjectLiteralExpression(
    [
      factory.createPropertyAssignment(
        "__ercCallsite",
        factory.createStringLiteral("v2"),
      ),
      factory.createPropertyAssignment(
        "id",
        factory.createStringLiteral(metadata.id),
      ),
      factory.createPropertyAssignment(
        "kind",
        factory.createStringLiteral(metadata.kind),
      ),
      factory.createPropertyAssignment(
        "callee",
        factory.createStringLiteral(metadata.callee),
      ),
      ...(metadata.seriesSource === undefined
        ? []
        : [
            factory.createPropertyAssignment(
              "seriesSource",
              factory.createStringLiteral(metadata.seriesSource),
            ),
          ]),
      ...(metadata.dependencies === undefined
        ? []
        : [
            factory.createPropertyAssignment(
              "dependencies",
              factory.createArrayLiteralExpression(
                metadata.dependencies.map((value) =>
                  factory.createStringLiteral(value),
                ),
                false,
              ),
            ),
          ]),
      ...(metadata.chartSeries === undefined
        ? []
        : [
            factory.createPropertyAssignment(
              "chartSeries",
              factory.createArrayLiteralExpression(
                metadata.chartSeries.map((value) =>
                  factory.createStringLiteral(value),
                ),
                false,
              ),
            ),
          ]),
      factory.createPropertyAssignment("source", source),
    ],
    false,
  );
  return factory.createVariableStatement(
    undefined,
    factory.createVariableDeclarationList(
      [
        factory.createVariableDeclaration(
          factory.createIdentifier(name),
          undefined,
          undefined,
          factory.createCallExpression(
            factory.createPropertyAccessExpression(
              factory.createIdentifier("Object"),
              "freeze",
            ),
            undefined,
            [value],
          ),
        ),
      ],
      ts.NodeFlags.Const,
    ),
  );
}

export function transformIndicatorCallsites(
  sourceText,
  { fileName = "indicator.ts", sourceFileId = fileName } = {},
) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const rootBindings = sdkBindings(sourceFile);
  const callsiteByNode = new Map();
  const callsBySemanticKey = new Map();
  const callsById = new Map();
  const callsites = [];
  const plotDeclarations = [];
  const indicatorTimeframeCalls = [];
  const indicatorCandleTypeCalls = [];

  const collect = (node, bindings, namespaceLike) => {
    if (ts.isCallExpression(node)) {
      const namespacePath = propertyPath(node.expression);
      if (
        namespacePath !== undefined &&
        namespaceLike.has(namespacePath.root) &&
        namespacePath.parts.length > 0 &&
        sdkRoots.has(namespacePath.parts[0])
      ) {
        throw syntaxError(
          sourceFile,
          node,
          "namespace SDK authoring access is unsupported; use named imports so compiler identities cannot be skipped",
        );
      }
      const classified = classifyCall(node, bindings);
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        bindings.get(node.expression.expression.text) === "indicator" &&
        node.expression.name.text === "timeframe"
      )
        indicatorTimeframeCalls.push(node);
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        bindings.get(node.expression.expression.text) === "indicator" &&
        node.expression.name.text === "candleType"
      )
        indicatorCandleTypeCalls.push(node);
      if (classified !== undefined) {
        const parts = {
          sourceFileId: sourceFileId.replaceAll("\\", "/"),
          kind: classified.kind,
          callee: classified.callee,
          scope: semanticScope(node, sourceFile, printer),
          anchor: semanticAnchor(node, sourceFile, printer),
        };
        const semanticKey = semanticCallsiteKey(parts);
        const existingSemantic = callsBySemanticKey.get(semanticKey);
        if (existingSemantic !== undefined) {
          throw syntaxError(
            sourceFile,
            node,
            `ambiguous stable call-site identity for ${classified.callee}; add a semantic binding or distinct call expression (first occurrence at ${existingSemantic.source.file}:${existingSemantic.source.line}:${existingSemantic.source.column})`,
          );
        }
        const id = stableCallsiteId(parts);
        const existingId = callsById.get(id);
        if (
          existingId !== undefined &&
          existingId.semanticKey !== semanticKey
        ) {
          throw syntaxError(
            sourceFile,
            node,
            `stable call-site identity collision for ${classified.callee}; change the semantic binding and rebuild`,
          );
        }
        const metadata = {
          id,
          kind: classified.kind,
          callee: classified.callee,
          ...(classified.kind !== "ta" || node.arguments[0] === undefined
            ? {}
            : {
                seriesSource: directIndicatorSeriesSource(
                  node.arguments[0],
                  bindings,
                ),
              }),
          source: sourceLocation(node, sourceFile, sourceFileId),
        };
        callsiteByNode.set(node, {
          metadata,
          authorArity: classified.authorArity,
          bindings,
        });
        callsBySemanticKey.set(semanticKey, metadata);
        callsById.set(id, { semanticKey, metadata });
        callsites.push(metadata);
        const plotDeclaration = compilerPlotDeclaration(
          node,
          classified,
          metadata,
          sourceFile,
          bindings,
        );
        if (plotDeclaration !== undefined)
          plotDeclarations.push(plotDeclaration);
      }
    }

    const names = scopedNames(node);
    const scopedBindings =
      names === undefined ? bindings : withoutNames(bindings, names);
    const scopedNamespace =
      names === undefined
        ? namespaceLike
        : withoutNameSet(namespaceLike, names);
    ts.forEachChild(node, (child) =>
      collect(child, scopedBindings, scopedNamespace),
    );
  };

  collect(sourceFile, rootBindings.named, rootBindings.namespaceLike);
  for (const [node, callsite] of callsiteByNode) {
    if (callsite.metadata.kind !== "signal" || !ts.isCallExpression(node))
      continue;
    const condition = node.arguments[0];
    const dependencyMetadata =
      condition === undefined
        ? { dependencies: Object.freeze([]), chartSeries: Object.freeze([]) }
        : signalDependencyMetadata(
            condition,
            callsiteByNode,
            callsite.bindings,
            sourceFile,
          );
    callsite.metadata.dependencies = dependencyMetadata.dependencies;
    callsite.metadata.chartSeries = dependencyMetadata.chartSeries;
  }
  for (const metadata of callsites) Object.freeze(metadata);
  const timeframeInputKeyByCall = new Map();
  for (const call of indicatorTimeframeCalls) {
    const argument = call.arguments[0];
    if (argument === undefined) continue;
    const inputCall = timeframeInputCallForExpression(argument, callsiteByNode);
    const metadata =
      inputCall === undefined
        ? undefined
        : callsiteByNode.get(inputCall)?.metadata;
    if (metadata?.callee === "input.timeframe")
      timeframeInputKeyByCall.set(call, metadata.id);
  }
  const candleTypeInputKeyByCall = new Map();
  for (const call of indicatorCandleTypeCalls) {
    const argument = call.arguments[0];
    if (argument === undefined) continue;
    const inputCall = candleTypeInputCallForExpression(
      argument,
      callsiteByNode,
    );
    const metadata =
      inputCall === undefined
        ? undefined
        : callsiteByNode.get(inputCall)?.metadata;
    if (metadata?.callee === "input.candleType")
      candleTypeInputKeyByCall.set(call, metadata.id);
  }
  if (callsites.length === 0)
    return {
      code: sourceText,
      changed: false,
      callsites,
      plotDeclarations,
    };

  const prefix = uniqueTokenPrefix(sourceText);
  const tokenNames = new Map(
    callsites.map((metadata, index) => [metadata, `${prefix}${index}`]),
  );
  const transformer = (context) => {
    const { factory } = context;
    const visit = (node) => {
      const candleTypeInputKey = candleTypeInputKeyByCall.get(node);
      if (candleTypeInputKey !== undefined && ts.isCallExpression(node)) {
        const expression = ts.visitNode(node.expression, visit);
        const transformedArguments = node.arguments.map((argument) =>
          ts.visitNode(argument, visit),
        );
        transformedArguments.push(
          factory.createStringLiteral(candleTypeInputKey),
        );
        return factory.updateCallExpression(
          node,
          expression,
          node.typeArguments,
          transformedArguments,
        );
      }
      const timeframeInputKey = timeframeInputKeyByCall.get(node);
      if (timeframeInputKey !== undefined && ts.isCallExpression(node)) {
        const expression = ts.visitNode(node.expression, visit);
        const transformedArguments = node.arguments.map((argument) =>
          ts.visitNode(argument, visit),
        );
        transformedArguments.push(
          factory.createStringLiteral(timeframeInputKey),
        );
        return factory.updateCallExpression(
          node,
          expression,
          node.typeArguments,
          transformedArguments,
        );
      }
      const callsite = callsiteByNode.get(node);
      if (callsite !== undefined && ts.isCallExpression(node)) {
        const expression = ts.visitNode(node.expression, visit);
        const argumentsWithCallsite = node.arguments.map((argument) =>
          ts.visitNode(argument, visit),
        );
        while (argumentsWithCallsite.length < callsite.authorArity)
          argumentsWithCallsite.push(factory.createIdentifier("undefined"));
        argumentsWithCallsite.push(
          factory.createIdentifier(tokenNames.get(callsite.metadata)),
        );
        return factory.updateCallExpression(
          node,
          expression,
          node.typeArguments,
          argumentsWithCallsite,
        );
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (root) => visit(root);
  };

  const result = ts.transform(sourceFile, [transformer]);
  const transformed = result.transformed[0];
  const statements = [...transformed.statements];
  let insertionIndex = 0;
  while (
    insertionIndex < statements.length &&
    ts.isImportDeclaration(statements[insertionIndex])
  )
    insertionIndex += 1;
  const declarations = callsites.map((metadata) =>
    callsiteDeclaration(ts.factory, tokenNames.get(metadata), metadata),
  );
  const withMetadata = ts.factory.updateSourceFile(transformed, [
    ...statements.slice(0, insertionIndex),
    ...declarations,
    ...statements.slice(insertionIndex),
  ]);
  const code = printer.printFile(withMetadata);
  result.dispose();
  return { code, changed: true, callsites, plotDeclarations };
}
