import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { parse as parseToml } from "smol-toml";
import { parseAllDocuments } from "yaml";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "coverage",
  "dist",
  "out",
  "release",
]);

const FORBIDDEN_BINARY_EXTENSIONS = new Set([
  ".exe",
  ".msi",
  ".dll",
  ".pdb",
  ".zip",
  ".7z",
  ".rar",
]);

const SECRET_PATTERNS = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["github-legacy-token", /\bgh[pour]_[A-Za-z0-9]{30,}\b/],
  ["github-fine-grained-token", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ["github-installation-token", /\bghs_[A-Za-z0-9._-]{36,}\b/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  [
    "quoted-secret-assignment",
    /\b(?:api[_-]?key|client[_-]?secret|password)\s*[:=]\s*["'][^"'\s]{8,}["']/i,
  ],
];

const SCHEMA_EXAMPLES = [
  [
    "docs/architecture/v1/contracts/plugin-manifest.schema.json",
    "docs/architecture/v1/examples/binomo-provider.plugin.json",
  ],
  [
    "docs/architecture/v1/contracts/workspace.schema.json",
    "docs/architecture/v1/examples/sample-workspace.json",
  ],
];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root) {
  const files = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  await walk(root);
  return files.sort();
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function parseJsonc(text) {
  return JSON.parse(
    text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,\s*([}\]])/g, "$1"),
  );
}

export async function validateStructuredFiles(root) {
  const errors = [];
  for (const file of await listFiles(root)) {
    const rel = relative(root, file);
    const ext = path.extname(file).toLowerCase();
    if (![".json", ".jsonc", ".yml", ".yaml", ".toml"].includes(ext)) continue;
    const text = await readFile(file, "utf8");
    try {
      if (ext === ".json") JSON.parse(text);
      else if (ext === ".jsonc") parseJsonc(text);
      else if (ext === ".toml") parseToml(text);
      else {
        const documents = parseAllDocuments(text);
        for (const document of documents) {
          if (document.errors.length) throw document.errors[0];
        }
      }
    } catch (error) {
      errors.push(`${rel}: invalid ${ext.slice(1).toUpperCase()} (${error.message})`);
    }
  }
  return errors;
}

export async function validateSchemaExamples(root) {
  const errors = [];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const [schemaRel, exampleRel] of SCHEMA_EXAMPLES) {
    const schemaPath = path.join(root, schemaRel);
    const examplePath = path.join(root, exampleRel);
    if (!(await exists(schemaPath)) || !(await exists(examplePath))) continue;
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    const example = JSON.parse(await readFile(examplePath, "utf8"));
    const validate = ajv.compile(schema);
    if (!validate(example)) {
      errors.push(`${exampleRel}: does not satisfy ${schemaRel}: ${ajv.errorsText(validate.errors)}`);
    }
  }
  return errors;
}

export async function validateMarkdownLinks(root) {
  const errors = [];
  for (const file of await listFiles(root)) {
    if (path.extname(file).toLowerCase() !== ".md") continue;
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
      const decoded = decodeURIComponent(target.split("#", 1)[0]);
      if (!decoded) continue;
      const resolved = path.resolve(path.dirname(file), decoded);
      if (!(await exists(resolved))) {
        errors.push(`${relative(root, file)}: broken relative link '${target}'`);
      }
    }
  }
  return errors;
}

function isScannableText(file) {
  const ext = path.extname(file).toLowerCase();
  return [
    "",
    ".css",
    ".gitignore",
    ".html",
    ".js",
    ".json",
    ".jsonc",
    ".jsx",
    ".md",
    ".mjs",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
  ].includes(ext);
}

export async function validateTrackedContent(root) {
  const errors = [];
  for (const file of await listFiles(root)) {
    const rel = relative(root, file);
    const ext = path.extname(file).toLowerCase();
    if (FORBIDDEN_BINARY_EXTENSIONS.has(ext)) {
      errors.push(`${rel}: forbidden generated or binary artifact`);
      continue;
    }
    if (!isScannableText(file)) continue;
    const info = await stat(file);
    if (info.size > 2_000_000) continue;
    const lines = (await readFile(file, "utf8")).split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      for (const [rule, pattern] of SECRET_PATTERNS) {
        if (pattern.test(lines[index])) errors.push(`${rel}:${index + 1}: ${rule}`);
      }
    }
  }
  return errors;
}

export async function validateRepository(root) {
  return [
    ...(await validateStructuredFiles(root)),
    ...(await validateSchemaExamples(root)),
    ...(await validateMarkdownLinks(root)),
    ...(await validateTrackedContent(root)),
  ];
}

export { EXCLUDED_DIRECTORIES, FORBIDDEN_BINARY_EXTENSIONS, SECRET_PATTERNS };
