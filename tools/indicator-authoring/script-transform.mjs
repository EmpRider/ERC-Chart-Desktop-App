import ts from "typescript";
import { scopedNames, scriptKind } from "./ast-scope.mjs";

const sdkModule = "@erc-chart/indicator-sdk";
const builtInSeriesNames = [
  "open",
  "high",
  "low",
  "close",
  "volume",
  "hl2",
  "hlc3",
  "ohlc4",
];
const runtimeSdkRoots = new Set([
  "history",
  "indicator",
  "input",
  "plot",
  "series",
  "signal",
  "ta",
]);

function syntaxError(sourceFile, node, message) {
  const location = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return new SyntaxError(
    `${sourceFile.fileName}:${location.line + 1}:${location.character + 1} ${message}`,
  );
}

function sdkNamedBindings(sourceFile, requestedName) {
  const result = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== sdkModule ||
      statement.importClause?.isTypeOnly === true
    )
      continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (namedBindings === undefined || !ts.isNamedImports(namedBindings))
      continue;
    for (const element of namedBindings.elements) {
      if (element.isTypeOnly) continue;
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === requestedName) result.add(element.name.text);
    }
  }
  return result;
}

function runtimeSdkBindings(sourceFile) {
  const result = new Set();
  for (const requestedName of runtimeSdkRoots) {
    for (const binding of sdkNamedBindings(sourceFile, requestedName))
      result.add(binding);
  }
  return result;
}

function metadataExport(statement, defineIndicatorBindings) {
  if (!ts.isExportAssignment(statement) || statement.isExportEquals) return undefined;
  const expression = statement.expression;
  if (
    !ts.isCallExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    !defineIndicatorBindings.has(expression.expression.text)
  )
    return undefined;
  return expression;
}

function statementHasExportModifier(statement) {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

function isStaticLiteralExpression(node) {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  )
    return true;
  if (
    ts.isPrefixUnaryExpression(node) &&
    (node.operator === ts.SyntaxKind.PlusToken ||
      node.operator === ts.SyntaxKind.MinusToken) &&
    ts.isNumericLiteral(node.operand)
  )
    return true;
  if (ts.isParenthesizedExpression(node))
    return isStaticLiteralExpression(node.expression);
  if (ts.isArrayLiteralExpression(node))
    return node.elements.every(
      (element) =>
        !ts.isSpreadElement(element) && isStaticLiteralExpression(element),
    );
  if (ts.isObjectLiteralExpression(node))
    return node.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        !ts.isComputedPropertyName(property.name) &&
        isStaticLiteralExpression(property.initializer),
    );
  return false;
}

function isSafePreludeStatement(statement, dynamicHelpers) {
  if (
    ts.isImportDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement) ||
    ts.isEmptyStatement(statement)
  )
    return true;
  if (ts.isFunctionDeclaration(statement))
    return !dynamicHelpers.has(statement);
  if (!ts.isVariableStatement(statement)) return false;
  return statement.declarationList.declarations.every(
    (declaration) =>
      declaration.initializer === undefined ||
      isStaticLiteralExpression(declaration.initializer),
  );
}

function withoutNames(active, names) {
  if (active.size === 0 || names.size === 0) return active;
  const result = new Set(active);
  for (const name of names) result.delete(name);
  return result;
}

function isIdentifierReference(node) {
  const parent = node.parent;
  if (parent === undefined) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent)) &&
    parent.name === node &&
    !ts.isComputedPropertyName(parent.name)
  )
    return false;
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent)) &&
    parent.name === node
  )
    return false;
  return true;
}

function referencesRuntime(node, runtimeNames) {
  if (
    ts.isIdentifier(node) &&
    runtimeNames.has(node.text) &&
    isIdentifierReference(node)
  )
    return true;
  const names = scopedNames(node);
  const scoped = names === undefined ? runtimeNames : withoutNames(runtimeNames, names);
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && referencesRuntime(child, scoped)) found = true;
  });
  return found;
}

function dynamicPreludeHelpers(sourceFile, metadataIndex) {
  const functions = [];
  for (let index = 0; index < metadataIndex; index += 1) {
    const statement = sourceFile.statements[index];
    if (
      statement !== undefined &&
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined
    )
      functions.push(statement);
  }
  const runtimeNames = new Set([
    ...builtInSeriesNames,
    "bar",
    ...runtimeSdkBindings(sourceFile),
  ]);
  const dynamic = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    const active = new Set(runtimeNames);
    for (const helper of dynamic) {
      if (helper.name !== undefined) active.add(helper.name.text);
    }
    for (const helper of functions) {
      if (dynamic.has(helper) || !referencesRuntime(helper, active)) continue;
      dynamic.add(helper);
      changed = true;
    }
  }
  return dynamic;
}

function blankStatements(sourceText, sourceFile, statements) {
  if (statements.size === 0) return sourceText;
  const ranges = [...statements]
    .map((statement) => [statement.getStart(sourceFile), statement.end])
    .sort((left, right) => left[0] - right[0]);
  let cursor = 0;
  let result = "";
  for (const [start, end] of ranges) {
    result += sourceText.slice(cursor, start);
    result += sourceText
      .slice(start, end)
      .replace(/[^\r\n]/gu, " ");
    cursor = end;
  }
  return result + sourceText.slice(cursor);
}

function newlineCount(value) {
  return [...value].filter((character) => character === "\n").length;
}

function uniqueIdentifier(sourceText, baseName) {
  let name = baseName;
  while (new RegExp(`\\b${name}\\b`, "u").test(sourceText)) name += "_";
  return name;
}

/**
 * Lowers the public metadata-only top-level authoring shape into the private
 * callback seam consumed by the existing scalar runtime.
 *
 * This is deliberately a source-preserving splice rather than a print/reparse
 * rewrite: statements after the metadata declaration keep their authored line
 * numbers for the later call-site diagnostics.
 */
export function transformIndicatorScript(
  sourceText,
  { fileName = "indicator.ts" } = {},
) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const defineIndicatorBindings = sdkNamedBindings(sourceFile, "defineIndicator");
  if (defineIndicatorBindings.size === 0)
    return { code: sourceText, changed: false };

  const metadataDeclarations = [];
  for (const statement of sourceFile.statements) {
    const call = metadataExport(statement, defineIndicatorBindings);
    if (call !== undefined) metadataDeclarations.push({ statement, call });
  }
  const metadataOnly = metadataDeclarations.filter(
    ({ call }) => call.arguments.length === 1,
  );
  if (metadataOnly.length === 0) return { code: sourceText, changed: false };
  if (metadataOnly.length !== 1 || metadataDeclarations.length !== 1)
    throw syntaxError(
      sourceFile,
      metadataOnly[0]?.call ?? sourceFile,
      "top-level indicator authoring requires exactly one exported metadata-only defineIndicator declaration",
    );

  const [{ statement: metadataStatement, call: metadataCall }] = metadataOnly;
  const metadataIndex = sourceFile.statements.indexOf(metadataStatement);
  const dynamicHelpers = dynamicPreludeHelpers(sourceFile, metadataIndex);
  for (let index = 0; index < metadataIndex; index += 1) {
    const statement = sourceFile.statements[index];
    if (statement !== undefined && dynamicHelpers.has(statement)) {
      if (statementHasExportModifier(statement))
        throw syntaxError(
          sourceFile,
          statement,
          "runtime-dependent indicator helpers cannot be exported",
        );
      continue;
    }
    if (
      statement !== undefined &&
      !isSafePreludeStatement(statement, dynamicHelpers)
    )
      throw syntaxError(
        sourceFile,
        statement,
        "per-bar indicator statements must follow the exported defineIndicator metadata declaration",
      );
  }
  for (let index = metadataIndex + 1; index < sourceFile.statements.length; index += 1) {
    const statement = sourceFile.statements[index];
    if (statement !== undefined && statementHasExportModifier(statement))
      throw syntaxError(
        sourceFile,
        statement,
        "top-level indicator script statements after defineIndicator cannot be exported",
      );
    if (statement !== undefined && ts.isImportDeclaration(statement))
      throw syntaxError(
        sourceFile,
        statement,
        "indicator imports must appear before the defineIndicator metadata declaration",
      );
  }

  const barIndex = uniqueIdentifier(sourceText, "__ercBarIndex");
  const barTime = uniqueIdentifier(sourceText, "__ercBarTime");
  const barConfirmed = uniqueIdentifier(sourceText, "__ercBarConfirmed");
  const metadataArgument = metadataCall.arguments[0];
  const removedSuffix = sourceText.slice(metadataArgument.end, metadataStatement.end);
  const preservedNewlines = "\n".repeat(newlineCount(removedSuffix));
  const seriesBinding = builtInSeriesNames.join(", ");
  const callbackPrefix =
    `, ({ ${seriesBinding}, index: ${barIndex}, openTimeMs: ${barTime}, isConfirmed: ${barConfirmed} }) => { ` +
    `const bar = { index: ${barIndex}, time: ${barTime}, confirmed: ${barConfirmed} };` +
    preservedNewlines;
  const moduleSource = blankStatements(sourceText, sourceFile, dynamicHelpers);
  let code = moduleSource.slice(0, metadataArgument.end) + callbackPrefix;
  const authoredRanges = [];
  const suffix = moduleSource.slice(metadataStatement.end);
  const suffixStart = code.length;
  code += suffix;
  authoredRanges.push({
    generatedStart: suffixStart,
    generatedEnd: suffixStart + suffix.length,
    originalStart: metadataStatement.end,
  });
  for (const helper of dynamicHelpers) {
    if (!code.endsWith("\n")) code += "\n";
    const originalStart = helper.getStart(sourceFile);
    const helperText = sourceText.slice(originalStart, helper.end);
    const generatedStart = code.length;
    code += helperText;
    authoredRanges.push({
      generatedStart,
      generatedEnd: generatedStart + helperText.length,
      originalStart,
    });
    code += "\n";
  }
  if (!code.endsWith("\n")) code += "\n";
  code += "});\n";

  const sourceLocationForPosition = (position) => {
    let originalPosition = position;
    if (position >= metadataArgument.end) {
      const range = authoredRanges.find(
        (candidate) =>
          position >= candidate.generatedStart &&
          position < candidate.generatedEnd,
      );
      if (range === undefined) return undefined;
      originalPosition = range.originalStart + (position - range.generatedStart);
    }
    const location = sourceFile.getLineAndCharacterOfPosition(originalPosition);
    return { line: location.line, character: location.character };
  };
  return { code, changed: true, sourceLocationForPosition };
}
