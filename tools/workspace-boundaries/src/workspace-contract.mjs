import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function importSpecifiers(source, fileName) {
  const extension = path.extname(fileName).toLowerCase();
  const scriptKind =
    extension === ".tsx"
      ? ts.ScriptKind.TSX
      : extension === ".jsx"
        ? ts.ScriptKind.JSX
        : [".js", ".mjs", ".cjs"].includes(extension)
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const specifiers = [];
  let hasNonLiteralDynamicImport = false;

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [argument] = node.arguments;
      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        specifiers.push(argument.text);
      } else {
        hasNonLiteralDynamicImport = true;
      }
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return {
    hasNonLiteralDynamicImport,
    hasParseErrors: (sourceFile.parseDiagnostics ?? []).length > 0,
    specifiers,
  };
}

async function directoryNames(directory) {
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function sourceFiles(directory) {
  if (!(await exists(directory))) return [];
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(absolute)));
    else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name))
      files.push(absolute);
  }
  return files;
}

async function nestedLockfiles(root, current = root) {
  const found = [];
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory())
      found.push(...(await nestedLockfiles(root, absolute)));
    else if (
      entry.isFile() &&
      entry.name === "package-lock.json" &&
      current !== root
    ) {
      found.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  return found;
}

function workspacePackageName(workspace) {
  return `@erc-chart/${path.basename(workspace)}`;
}

function findCycles(graph) {
  const errors = [];
  const complete = new Set();
  const active = new Set();
  const stack = [];

  function visit(workspace) {
    if (complete.has(workspace)) return;
    if (active.has(workspace)) {
      const start = stack.indexOf(workspace);
      errors.push(
        `workspace dependency cycle: ${[...stack.slice(start), workspace].join(" -> ")}`,
      );
      return;
    }

    active.add(workspace);
    stack.push(workspace);
    for (const dependency of [...(graph.get(workspace) ?? [])].sort())
      visit(dependency);
    stack.pop();
    active.delete(workspace);
    complete.add(workspace);
  }

  for (const workspace of [...graph.keys()].sort()) visit(workspace);
  return [...new Set(errors)];
}

async function defaultContract() {
  return readJson(new URL("../workspace-contract.json", import.meta.url));
}

export async function validateWorkspace(root, contract = undefined) {
  contract ??= await defaultContract();
  const errors = [];
  const manifests = new Map();
  const graph = new Map();

  const approvedWorkspaces = new Set([
    ...Object.keys(contract.workspaces),
    ...(contract.toolWorkspaces ?? []),
  ]);
  for (const group of ["apps", "packages", "tools"]) {
    for (const name of await directoryNames(path.join(root, group))) {
      const workspace = `${group}/${name}`;
      if (
        group === "tools" &&
        !(await exists(path.join(root, workspace, "package.json")))
      ) {
        continue;
      }
      if (!approvedWorkspaces.has(workspace)) {
        errors.push(
          `${workspace}: workspace is not part of the approved inventory`,
        );
      }
    }
  }
  for (const workspace of contract.toolWorkspaces ?? []) {
    const manifestPath = path.join(root, workspace, "package.json");
    if (!(await exists(manifestPath))) {
      errors.push(`${workspace}: approved workspace is missing`);
    } else {
      manifests.set(workspace, await readJson(manifestPath));
    }
  }

  const rootManifestPath = path.join(root, "package.json");
  if (!(await exists(rootManifestPath))) {
    errors.push("package.json: root workspace manifest is required");
  } else {
    const rootManifest = await readJson(rootManifestPath);
    if (rootManifest.engines?.node !== contract.nodeVersion) {
      errors.push(
        `package.json: engines.node must be pinned to ${contract.nodeVersion}`,
      );
    }
    if (rootManifest.packageManager !== `npm@${contract.npmVersion}`) {
      errors.push(
        `package.json: packageManager must be pinned to npm@${contract.npmVersion}`,
      );
    }
    const expectedWorkspaces = ["apps/*", "packages/*", "tools/*"];
    if (
      !Array.isArray(rootManifest.workspaces) ||
      rootManifest.workspaces.length !== expectedWorkspaces.length ||
      rootManifest.workspaces.some(
        (workspace, index) => workspace !== expectedWorkspaces[index],
      )
    ) {
      errors.push(
        "package.json: workspaces must be exactly apps/*, packages/*, tools/*",
      );
    }
    for (const script of contract.requiredScripts ?? []) {
      if (
        typeof rootManifest.scripts?.[script] !== "string" ||
        rootManifest.scripts[script] === ""
      ) {
        errors.push(`package.json: required script ${script} is missing`);
      }
    }
  }

  if (!(await exists(path.join(root, "package-lock.json")))) {
    errors.push("package-lock.json: root lockfile is required");
  }
  for (const lockfile of await nestedLockfiles(root)) {
    errors.push(
      `${lockfile}: nested lockfiles are forbidden; use package-lock.json`,
    );
  }

  const rootTsconfigPath = path.join(root, "tsconfig.json");
  if (!(await exists(rootTsconfigPath))) {
    errors.push("tsconfig.json: root project references are required");
  } else {
    const rootTsconfig = await readJson(rootTsconfigPath);
    const references = new Set(
      (rootTsconfig.references ?? []).map((reference) => reference.path),
    );
    const expectedReferences = new Set(
      Object.keys(contract.workspaces).map((workspace) => `./${workspace}`),
    );
    for (const workspace of Object.keys(contract.workspaces).sort()) {
      const expected = `./${workspace}`;
      if (!references.has(expected)) {
        errors.push(`tsconfig.json: project reference ${expected} is required`);
      }
    }
    for (const reference of [...references].sort()) {
      if (!expectedReferences.has(reference)) {
        errors.push(
          `tsconfig.json: project reference ${reference} is not approved`,
        );
      }
    }
  }

  for (const workspace of Object.keys(contract.workspaces).sort()) {
    const workspaceRoot = path.join(root, workspace);
    const manifestPath = path.join(workspaceRoot, "package.json");
    if (!(await exists(manifestPath))) {
      errors.push(`${workspace}: approved workspace is missing`);
      continue;
    }

    const manifest = await readJson(manifestPath);
    manifests.set(workspace, manifest);
    const expectedName = workspacePackageName(workspace);
    if (manifest.name !== expectedName) {
      errors.push(`${workspace}/package.json: name must be ${expectedName}`);
    }
    if (
      typeof manifest.description !== "string" ||
      manifest.description.trim() === ""
    ) {
      errors.push(
        `${workspace}/package.json: description must state the workspace purpose`,
      );
    }
    if (manifest.private !== true) {
      errors.push(
        `${workspace}/package.json: private must be true for the unpublished baseline`,
      );
    }
    if (
      typeof manifest.version !== "string" ||
      manifest.version.trim() === ""
    ) {
      errors.push(
        `${workspace}/package.json: version must be a non-empty string`,
      );
    }
    if (typeof manifest.types !== "string" || manifest.types.trim() === "") {
      errors.push(
        `${workspace}/package.json: types must point to the public declaration entry`,
      );
    }
    if (manifest.exports?.["."] === undefined) {
      errors.push(`${workspace}/package.json: root export '.' is required`);
    }
    if (
      manifest.exports !== undefined &&
      (typeof manifest.exports !== "object" ||
        manifest.exports === null ||
        Object.keys(manifest.exports).some((exportName) => exportName !== "."))
    ) {
      errors.push(
        `${workspace}/package.json: only the root export '.' is allowed`,
      );
    }
    const tsconfigPath = path.join(workspaceRoot, "tsconfig.json");
    if (!(await exists(tsconfigPath))) {
      errors.push(
        `${workspace}/tsconfig.json: TypeScript configuration is required`,
      );
    } else {
      const tsconfig = await readJson(tsconfigPath);
      const references = new Set(
        (tsconfig.references ?? []).map((reference) => reference.path),
      );
      for (const dependency of contract.workspaces[workspace] ?? []) {
        const expected = path
          .relative(workspace, dependency)
          .split(path.sep)
          .join("/");
        const normalizedExpected = expected.startsWith(".")
          ? expected
          : `./${expected}`;
        if (!references.has(normalizedExpected)) {
          errors.push(
            `${workspace}/tsconfig.json: project reference ${normalizedExpected} is required`,
          );
        }
      }
    }
    if (!(await exists(path.join(workspaceRoot, "src/index.ts")))) {
      errors.push(`${workspace}/src/index.ts: public entry point is required`);
    }
  }

  const packageToWorkspace = new Map(
    [...manifests].map(([workspace, manifest]) => [manifest.name, workspace]),
  );

  for (const [workspace, manifest] of manifests) {
    const allowed = new Set(contract.workspaces[workspace] ?? []);
    const dependencies = Object.fromEntries(
      DEPENDENCY_FIELDS.flatMap((field) =>
        Object.entries(manifest[field] ?? {}),
      ),
    );
    const workspaceDependencies = [];

    for (const dependencyName of Object.keys(dependencies).sort()) {
      const dependencyWorkspace =
        packageToWorkspace.get(dependencyName) ??
        (dependencyName.startsWith("@erc-chart/")
          ? Object.keys(contract.workspaces).find(
              (candidate) => workspacePackageName(candidate) === dependencyName,
            )
          : undefined);
      if (dependencyWorkspace === undefined) {
        if (dependencyName.startsWith("@erc-chart/")) {
          errors.push(
            `${workspace}/package.json: dependency ${dependencyName} does not resolve to an approved workspace`,
          );
        }
        continue;
      }
      workspaceDependencies.push(dependencyWorkspace);
      if (!allowed.has(dependencyWorkspace)) {
        errors.push(
          `${workspace}/package.json: dependency ${dependencyName} is not allowed`,
        );
      }
    }
    graph.set(workspace, workspaceDependencies);

    for (const file of await sourceFiles(path.join(root, workspace, "src"))) {
      const relativeFile = path.relative(root, file).split(path.sep).join("/");
      const source = await readFile(file, "utf8");
      const { hasNonLiteralDynamicImport, hasParseErrors, specifiers } =
        importSpecifiers(source, file);
      if (hasParseErrors) {
        errors.push(`${relativeFile}: source contains invalid syntax`);
        continue;
      }
      if (hasNonLiteralDynamicImport) {
        errors.push(`${relativeFile}: non-literal dynamic import is forbidden`);
      }
      for (const specifier of specifiers) {
        if (specifier.startsWith(".")) {
          const resolved = path.resolve(path.dirname(file), specifier);
          const workspaceRoot = path.resolve(root, workspace);
          if (
            resolved !== workspaceRoot &&
            !resolved.startsWith(`${workspaceRoot}${path.sep}`)
          ) {
            errors.push(
              `${relativeFile}: relative import ${specifier} escapes its workspace`,
            );
          }
          continue;
        }
        if (!specifier.startsWith("@erc-chart/")) continue;
        const segments = specifier.split("/");
        const packageName = segments.slice(0, 2).join("/");
        if (segments.length > 2) {
          errors.push(
            `${relativeFile}: deep workspace import ${specifier} is forbidden`,
          );
          continue;
        }
        if (dependencies[packageName] === undefined) {
          errors.push(
            `${relativeFile}: ${packageName} is not a declared workspace dependency`,
          );
        }
      }
    }
  }

  errors.push(...findCycles(graph));

  return errors;
}
