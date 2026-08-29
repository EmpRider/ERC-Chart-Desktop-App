import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runWorkspaceValidation } from "../src/cli.mjs";
import { validateWorkspace } from "../src/workspace-contract.mjs";

const contract = {
  nodeVersion: "26.8.1",
  npmVersion: "12.0.2",
  requiredScripts: [
    "format:check",
    "lint",
    "typecheck",
    "test:unit",
    "test:integration",
    "build",
    "build:runtime",
    "start",
    "smoke:electron",
    "test:performance",
    "audit:ci",
    "version:check",
    "package:win",
    "smoke:installer",
  ],
  toolWorkspaces: [],
  workspaces: {
    "packages/contracts": [],
    "packages/chart-core": ["packages/contracts"],
  },
};

async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-workspaces-"));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return root;
}

function manifest(name, dependencies = {}) {
  return JSON.stringify({
    name,
    version: "0.0.0",
    private: true,
    type: "module",
    description: `${name} test fixture`,
    types: "./dist/index.d.ts",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
    },
    dependencies,
  });
}

function validFiles() {
  const scripts = Object.fromEntries(
    contract.requiredScripts.map((name) => [name, "node --version"]),
  );
  return {
    "package.json": JSON.stringify({
      name: "erc-chart-desktop-app",
      version: "0.0.0",
      private: true,
      engines: { node: contract.nodeVersion },
      packageManager: `npm@${contract.npmVersion}`,
      workspaces: ["apps/*", "packages/*", "tools/*"],
      scripts,
    }),
    "package-lock.json": JSON.stringify({ lockfileVersion: 3 }),
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [
        { path: "./packages/contracts" },
        { path: "./packages/chart-core" },
      ],
    }),
    "packages/contracts/package.json": manifest("@erc-chart/contracts"),
    "packages/contracts/tsconfig.json": "{}",
    "packages/contracts/src/index.ts": "export {};\n",
    "packages/chart-core/package.json": manifest("@erc-chart/chart-core", {
      "@erc-chart/contracts": "workspace:*",
    }),
    "packages/chart-core/tsconfig.json": JSON.stringify({
      references: [{ path: "../contracts" }],
    }),
    "packages/chart-core/src/index.ts": "export {};\n",
  };
}

test("reports an approved workspace missing from the root", async () => {
  const files = validFiles();
  delete files["packages/chart-core/package.json"];
  delete files["packages/chart-core/tsconfig.json"];
  delete files["packages/chart-core/src/index.ts"];

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes("packages/chart-core: approved workspace is missing"),
  );
});

test("reports a workspace without a root-only public entry", async () => {
  const files = validFiles();
  const chartManifest = JSON.parse(files["packages/chart-core/package.json"]);
  delete chartManifest.exports;
  files["packages/chart-core/package.json"] = JSON.stringify(chartManifest);

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/chart-core/package.json: root export '.' is required",
    ),
  );
});

test("accepts the complete approved workspace inventory", async () => {
  const errors = await validateWorkspace(await fixture(validFiles()), contract);

  assert.deepEqual(errors, []);
});

test("rejects an unapproved workspace discovered by a root glob", async () => {
  const files = validFiles();
  files["packages/unapproved/package.json"] = manifest("@erc-chart/unapproved");

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/unapproved: workspace is not part of the approved inventory",
    ),
  );
});

test("rejects an unapproved tool workspace discovered by the root glob", async () => {
  const files = validFiles();
  files["tools/unapproved/package.json"] = JSON.stringify({
    name: "@erc-chart/unapproved-tool",
    private: true,
  });

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "tools/unapproved: workspace is not part of the approved inventory",
    ),
  );
});

test("rejects a manifest dependency outside the approved direction", async () => {
  const files = validFiles();
  const contractsManifest = JSON.parse(
    files["packages/contracts/package.json"],
  );
  contractsManifest.dependencies["@erc-chart/chart-core"] = "workspace:*";
  files["packages/contracts/package.json"] = JSON.stringify(contractsManifest);

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/contracts/package.json: dependency @erc-chart/chart-core is not allowed",
    ),
  );
});

for (const section of [
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]) {
  test(`rejects a workspace dependency outside the approved direction in ${section}`, async () => {
    const files = validFiles();
    const contractsManifest = JSON.parse(
      files["packages/contracts/package.json"],
    );
    contractsManifest[section] = {
      "@erc-chart/chart-core": "workspace:*",
    };
    files["packages/contracts/package.json"] =
      JSON.stringify(contractsManifest);

    const errors = await validateWorkspace(await fixture(files), contract);

    assert.ok(
      errors.includes(
        "packages/contracts/package.json: dependency @erc-chart/chart-core is not allowed",
      ),
    );
  });
}

test("rejects an unknown ERC Chart manifest dependency", async () => {
  const files = validFiles();
  const chartManifest = JSON.parse(files["packages/chart-core/package.json"]);
  chartManifest.dependencies["@erc-chart/unapproved"] = "workspace:*";
  files["packages/chart-core/package.json"] = JSON.stringify(chartManifest);

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/chart-core/package.json: dependency @erc-chart/unapproved does not resolve to an approved workspace",
    ),
  );
});

test("rejects an undeclared workspace package import", async () => {
  const files = validFiles();
  files["packages/chart-core/src/index.ts"] =
    'import "@erc-chart/contracts";\nimport "@erc-chart/indicator-sdk";\n';

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/chart-core/src/index.ts: @erc-chart/indicator-sdk is not a declared workspace dependency",
    ),
  );
});

test("rejects a deep workspace package import", async () => {
  const files = validFiles();
  files["packages/chart-core/src/index.ts"] =
    'export type { Candle } from "@erc-chart/contracts/src/market-data.js";\n';

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/chart-core/src/index.ts: deep workspace import @erc-chart/contracts/src/market-data.js is forbidden",
    ),
  );
});

test("rejects a relative import that escapes its workspace", async () => {
  const files = validFiles();
  files["packages/chart-core/src/index.ts"] =
    'export type { Candle } from "../../contracts/src/market-data.js";\n';

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/chart-core/src/index.ts: relative import ../../contracts/src/market-data.js escapes its workspace",
    ),
  );
});

test("rejects a circular workspace dependency", async () => {
  const files = validFiles();
  const contractsManifest = JSON.parse(
    files["packages/contracts/package.json"],
  );
  contractsManifest.dependencies["@erc-chart/chart-core"] = "workspace:*";
  files["packages/contracts/package.json"] = JSON.stringify(contractsManifest);
  const cyclicContract = {
    workspaces: {
      "packages/contracts": ["packages/chart-core"],
      "packages/chart-core": ["packages/contracts"],
    },
  };

  const errors = await validateWorkspace(await fixture(files), cyclicContract);

  assert.ok(
    errors.includes(
      "workspace dependency cycle: packages/chart-core -> packages/contracts -> packages/chart-core",
    ),
  );
});

test("rejects a cycle declared outside regular dependencies", async () => {
  const files = validFiles();
  const contractsManifest = JSON.parse(
    files["packages/contracts/package.json"],
  );
  contractsManifest.devDependencies = {
    "@erc-chart/chart-core": "workspace:*",
  };
  files["packages/contracts/package.json"] = JSON.stringify(contractsManifest);
  const cyclicContract = {
    workspaces: {
      "packages/contracts": ["packages/chart-core"],
      "packages/chart-core": ["packages/contracts"],
    },
  };

  const errors = await validateWorkspace(await fixture(files), cyclicContract);

  assert.ok(
    errors.includes(
      "workspace dependency cycle: packages/chart-core -> packages/contracts -> packages/chart-core",
    ),
  );
});

test("rejects a missing root command required by delivery gates", async () => {
  const files = validFiles();
  const rootManifest = JSON.parse(files["package.json"]);
  delete rootManifest.scripts.typecheck;
  files["package.json"] = JSON.stringify(rootManifest);

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes("package.json: required script typecheck is missing"),
  );
});

test("rejects a nested workspace lockfile", async () => {
  const files = validFiles();
  files["packages/contracts/package-lock.json"] = "{}";

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/contracts/package-lock.json: nested lockfiles are forbidden; use package-lock.json",
    ),
  );
});

test("rejects an approved TypeScript unit missing from root project references", async () => {
  const files = validFiles();
  const rootConfig = JSON.parse(files["tsconfig.json"]);
  rootConfig.references = rootConfig.references.filter(
    (reference) => reference.path !== "./packages/chart-core",
  );
  files["tsconfig.json"] = JSON.stringify(rootConfig);

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "tsconfig.json: project reference ./packages/chart-core is required",
    ),
  );
});

test("rejects a malformed direct TypeScript references value", async () => {
  const files = validFiles();
  files["packages/chart-core/tsconfig.json"] = JSON.stringify({
    references: "../contracts",
  });

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/chart-core/tsconfig.json: references must be an array",
    ),
  );
});

test("rejects malformed direct TypeScript project reference entries", async () => {
  const files = validFiles();
  files["packages/chart-core/tsconfig.json"] = JSON.stringify({
    references: [null, "../contracts", {}],
  });

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/chart-core/tsconfig.json: project reference ../contracts is required",
    ),
  );
});

test("rejects a missing direct TypeScript project reference", async () => {
  const files = validFiles();
  files["packages/chart-core/tsconfig.json"] = "{}";

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/chart-core/tsconfig.json: project reference ../contracts is required",
    ),
  );
});

test("rejects a root project reference outside the approved inventory", async () => {
  const files = validFiles();
  const rootConfig = JSON.parse(files["tsconfig.json"]);
  rootConfig.references.push({ path: "./packages/unapproved" });
  files["tsconfig.json"] = JSON.stringify(rootConfig);

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "tsconfig.json: project reference ./packages/unapproved is not approved",
    ),
  );
});

test("rejects a root toolchain version that differs from the contract", async () => {
  const files = validFiles();
  const rootManifest = JSON.parse(files["package.json"]);
  rootManifest.engines.node = "24";
  files["package.json"] = JSON.stringify(rootManifest);

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes("package.json: engines.node must be pinned to 26.8.1"),
  );
});

test("rejects a root npm version that differs from the contract", async () => {
  const files = validFiles();
  const rootManifest = JSON.parse(files["package.json"]);
  rootManifest.packageManager = "npm@11";
  files["package.json"] = JSON.stringify(rootManifest);

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "package.json: packageManager must be pinned to npm@12.0.2",
    ),
  );
});

test("rejects a root workspace pattern outside the approved set", async () => {
  const files = validFiles();
  const rootManifest = JSON.parse(files["package.json"]);
  rootManifest.workspaces.push("examples/*");
  files["package.json"] = JSON.stringify(rootManifest);

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "package.json: workspaces must be exactly apps/*, packages/*, tools/*",
    ),
  );
});

test("rejects a workspace package name that differs from its directory", async () => {
  const files = validFiles();
  const chartManifest = JSON.parse(files["packages/chart-core/package.json"]);
  chartManifest.name = "@erc-chart/chart";
  files["packages/chart-core/package.json"] = JSON.stringify(chartManifest);

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/chart-core/package.json: name must be @erc-chart/chart-core",
    ),
  );
});

test("rejects a package export below the public root", async () => {
  const files = validFiles();
  const chartManifest = JSON.parse(files["packages/chart-core/package.json"]);
  chartManifest.exports["./src/*"] = "./src/*";
  files["packages/chart-core/package.json"] = JSON.stringify(chartManifest);

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/chart-core/package.json: only the root export '.' is allowed",
    ),
  );
});

for (const [field, invalid, expected] of [
  ["description", "", "description must state the workspace purpose"],
  ["private", false, "private must be true for the unpublished baseline"],
  ["version", "", "version must be a non-empty string"],
  ["types", "", "types must point to the public declaration entry"],
]) {
  test(`rejects invalid workspace manifest field ${field}`, async () => {
    const files = validFiles();
    const chartManifest = JSON.parse(files["packages/chart-core/package.json"]);
    chartManifest[field] = invalid;
    files["packages/chart-core/package.json"] = JSON.stringify(chartManifest);

    const errors = await validateWorkspace(await fixture(files), contract);

    assert.ok(errors.includes(`packages/chart-core/package.json: ${expected}`));
  });
}

test("rejects an undeclared workspace package dynamic import", async () => {
  const files = validFiles();
  files["packages/chart-core/src/index.ts"] =
    'export const loadSdk = async () => import("@erc-chart/indicator-sdk");\n';

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/chart-core/src/index.ts: @erc-chart/indicator-sdk is not a declared workspace dependency",
    ),
  );
});

test("rejects a non-literal dynamic import", async () => {
  const files = validFiles();
  files["packages/chart-core/src/index.ts"] = `
const moduleName = "@erc-chart/contracts";
export const loadContracts = async () => import(moduleName);
`;

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/chart-core/src/index.ts: non-literal dynamic import is forbidden",
    ),
  );
});

test("parses TypeScript assertions with the file's script kind", async () => {
  const files = validFiles();
  files["packages/chart-core/src/index.ts"] =
    "const value = <number>1; export { value };\n";

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.deepEqual(errors, []);
});

test("fails closed when a workspace source cannot be parsed", async () => {
  const files = validFiles();
  files["packages/chart-core/src/index.ts"] = "import {\n";

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/chart-core/src/index.ts: source contains invalid syntax",
    ),
  );
});

test("validates JavaScript workspace imports", async () => {
  const files = validFiles();
  files["packages/chart-core/src/runtime.mjs"] =
    'import "@erc-chart/indicator-sdk";\n';

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes(
      "packages/chart-core/src/runtime.mjs: @erc-chart/indicator-sdk is not a declared workspace dependency",
    ),
  );
});

test("validates tool workspace imports", async () => {
  const files = validFiles();
  files["tools/check/package.json"] = manifest("@erc-chart/check");
  files["tools/check/src/index.mjs"] = 'import "@erc-chart/contracts";\n';
  const toolContract = {
    ...contract,
    toolWorkspaces: ["tools/check"],
  };

  const errors = await validateWorkspace(await fixture(files), toolContract);

  assert.ok(
    errors.includes(
      "tools/check/src/index.mjs: @erc-chart/contracts is not a declared workspace dependency",
    ),
  );
});

test("reports validation exceptions without an unhandled rejection", async () => {
  const stdout = [];
  const stderr = [];

  const exitCode = await runWorkspaceValidation({
    root: "/fixture",
    validate: async () => {
      throw new SyntaxError("invalid package.json");
    },
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, [
    "Workspace boundaries: validation failed: invalid package.json",
  ]);
});

for (const [file, expected] of [
  ["package.json", "package.json: root workspace manifest is required"],
  ["package-lock.json", "package-lock.json: root lockfile is required"],
  ["tsconfig.json", "tsconfig.json: root project references are required"],
  [
    "packages/contracts/tsconfig.json",
    "packages/contracts/tsconfig.json: TypeScript configuration is required",
  ],
  [
    "packages/contracts/src/index.ts",
    "packages/contracts/src/index.ts: public entry point is required",
  ],
]) {
  test(`rejects a missing required file: ${file}`, async () => {
    const files = validFiles();
    assert.equal(Reflect.deleteProperty(files, file), true);

    const errors = await validateWorkspace(await fixture(files), contract);

    assert.ok(errors.includes(expected));
  });
}

test("ignores workspace imports inside comments", async () => {
  const files = validFiles();
  files["packages/chart-core/src/index.ts"] = `
// import "@erc-chart/indicator-sdk";
/*
 * export type { Indicator } from "@erc-chart/indicator-sdk/src/index.js";
 * import("@erc-chart/indicator-sdk");
 */
export {};
`;

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.deepEqual(errors, []);
});

test("ignores import-like text inside string and template literals", async () => {
  const files = validFiles();
  files["packages/chart-core/src/index.ts"] = `
const staticExample = 'import "@erc-chart/indicator-sdk";';
const dynamicExample = "import('@erc-chart/indicator-sdk')";
const templateExample = \`export { value } from "@erc-chart/indicator-sdk/src/index.js";\`;
export { staticExample, dynamicExample, templateExample };
`;

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.deepEqual(errors, []);
});
