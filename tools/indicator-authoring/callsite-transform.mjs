import ts from "typescript";
import { scopedNames, scriptKind } from "./ast-scope.mjs";
import {
  semanticCallsiteKey,
  stableCallsiteId,
} from "./identity.mjs";

const sdkModule = "@erc-chart/indicator-sdk";
const sdkRoots = new Set([
  "input",
  "location",
  "plot",
  "series",
  "shape",
  "signal",
  "ta",
  "textSize",
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
const scalarPlotKinds = new Map([
  ["line", "line"],
  ["hline", "hline"],
  ["histogram", "histogram"],
  ["shape", "shape"],
]);
const staticPlotDeclarationOptions = new Set([
  "key",
  "title",
  "style",
  "direction",
  "shape",
  "location",
  "text",
  "textColor",
  "textSize",
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
  if (node.name !== undefined && ts.isIdentifier(node.name)) return node.name.text;
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
      result.unshift(`fn:${functionSemanticName(current, sourceFile, printer)}`);
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
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
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

function staticPrimitive(node, bindings) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  )
    return -Number(node.operand.text);
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression)
  ) {
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
    const value = staticPrimitive(property.initializer, bindings);
    if (
      staticPlotDeclarationOptions.has(name) &&
      typeof value !== "string"
    )
      throw syntaxError(
        sourceFile,
        property.initializer,
        `Plot declaration option "${name}" must use an SDK constant or static string literal.`,
      );
    if (value !== undefined) declaration[name] = value;
  }
  return Object.freeze(declaration);
}

function syntaxError(sourceFile, node, message) {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
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
      factory.createPropertyAssignment("id", factory.createStringLiteral(metadata.id)),
      factory.createPropertyAssignment(
        "kind",
        factory.createStringLiteral(metadata.kind),
      ),
      factory.createPropertyAssignment(
        "callee",
        factory.createStringLiteral(metadata.callee),
      ),
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
        if (existingId !== undefined && existingId.semanticKey !== semanticKey) {
          throw syntaxError(
            sourceFile,
            node,
            `stable call-site identity collision for ${classified.callee}; change the semantic binding and rebuild`,
          );
        }
        const metadata = Object.freeze({
          id,
          kind: classified.kind,
          callee: classified.callee,
          source: sourceLocation(node, sourceFile, sourceFileId),
        });
        callsiteByNode.set(node, {
          metadata,
          authorArity: classified.authorArity,
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
      names === undefined ? namespaceLike : withoutNameSet(namespaceLike, names);
    ts.forEachChild(node, (child) => collect(child, scopedBindings, scopedNamespace));
  };

  collect(sourceFile, rootBindings.named, rootBindings.namespaceLike);
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
