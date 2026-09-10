import ts from "typescript";

export function scriptKind(fileName) {
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

export function collectBindingNames(name, target) {
  if (ts.isIdentifier(name)) {
    target.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, target);
  }
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
    )
      return;
    if (
      ts.isVariableDeclarationList(current) &&
      (current.flags & ts.NodeFlags.BlockScoped) === 0
    ) {
      for (const declaration of current.declarations)
        collectBindingNames(declaration.name, names);
    }
    ts.forEachChild(current, visit);
  };
  visit(body);
}

export function functionBindings(node) {
  const names = new Set();
  for (const parameter of node.parameters) collectBindingNames(parameter.name, names);
  if (node.name !== undefined && ts.isIdentifier(node.name)) names.add(node.name.text);
  collectFunctionScopedVarBindings(node, names);
  return names;
}

function directBlockBindings(block) {
  const names = new Set();
  const statements = ts.isCaseBlock(block)
    ? block.clauses.flatMap((clause) => [...clause.statements])
    : block.statements;
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations)
        collectBindingNames(declaration.name, names);
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined
    )
      names.add(statement.name.text);
  }
  return names;
}

function loopBindings(node) {
  const names = new Set();
  const initializer = node.initializer;
  if (initializer !== undefined && ts.isVariableDeclarationList(initializer)) {
    for (const declaration of initializer.declarations)
      collectBindingNames(declaration.name, names);
  }
  return names;
}

export function scopedNames(node) {
  if (ts.isFunctionLike(node)) return functionBindings(node);
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isCaseBlock(node))
    return directBlockBindings(node);
  if (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  )
    return loopBindings(node);
  if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
    const names = new Set();
    collectBindingNames(node.variableDeclaration.name, names);
    return names;
  }
  return undefined;
}
