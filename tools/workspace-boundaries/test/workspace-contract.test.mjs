import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateWorkspace } from "../src/workspace-contract.mjs";

const contract = {
  nodeVersion: "24.18.1",
  npmVersion: "11.9.0",
  requiredScripts: [
    "format:check",
    "lint",
    "typecheck",
    "test:unit",
    "test:integration",
    "build",
    "test:performance",
    "audit:ci",
    "version:check",
    "package:win",
    "smoke:installer",
  ],
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
    "packages/chart-core/tsconfig.json": "{}",
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

test("rejects a root toolchain version that differs from the contract", async () => {
  const files = validFiles();
  const rootManifest = JSON.parse(files["package.json"]);
  rootManifest.engines.node = "24";
  files["package.json"] = JSON.stringify(rootManifest);

  const errors = await validateWorkspace(await fixture(files), contract);

  assert.ok(
    errors.includes("package.json: engines.node must be pinned to 24.18.1"),
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
      "package.json: packageManager must be pinned to npm@11.9.0",
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
