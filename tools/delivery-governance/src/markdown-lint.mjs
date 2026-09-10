import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "jsonc-parser";
import { formatLintResults } from "markdownlint/helpers";
import { lint } from "markdownlint/promise";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const excludedFiles = new Set([
  ".github/pull_request_template.md",
  "docs/architecture/v1/ARCHITECTURE-DECISIONS.md",
  "docs/architecture/v1/ERC-chart-Architecture-Specification-v1.md",
  "docs/architecture/v1/IMPLEMENTATION-BACKLOG.md",
  "docs/architecture/v1/README.md",
  "docs/architecture/v1/REFERENCE-FEATURE-CATALOG.md",
]);
const excludedDirectories = new Set([".git", "node_modules"]);

/** Collect markdown files covered by the repository governance lint policy. */
async function collectMarkdownFiles(directory) {
  const files = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        files.push(...(await collectMarkdownFiles(absolutePath)));
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
      continue;
    }
    const relativePath = path
      .relative(repositoryRoot, absolutePath)
      .split(path.sep)
      .join("/");
    if (!excludedFiles.has(relativePath)) {
      files.push(absolutePath);
    }
  }
  return files;
}

const configPath = path.join(repositoryRoot, ".markdownlint-cli2.jsonc");
const parseErrors = [];
const parsedConfig = parse(await fs.readFile(configPath, "utf8"), parseErrors, {
  allowTrailingComma: true,
});
if (parseErrors.length > 0) {
  throw new Error(
    `Unable to parse ${configPath}: ${JSON.stringify(parseErrors)}`,
  );
}
const config = parsedConfig?.config ?? parsedConfig;
const files = (await collectMarkdownFiles(repositoryRoot)).sort();
const results = await lint({ files, config });
const errors = formatLintResults(results);
if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exitCode = 1;
} else {
  console.log(`Markdown lint passed (${files.length} files).`);
}
