import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { parse as parseToml } from "smol-toml";
import { parseAllDocuments } from "yaml";

const MAX_SCAN_BYTES = 2_000_000;
const MAX_ROOT_PACKAGE_LOCK_BYTES = 20_000_000;

const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules"]);
const FORBIDDEN_GENERATED_DIRECTORIES = new Set(["coverage", "dist", "out", "release"]);

const FORBIDDEN_BINARY_EXTENSIONS = new Set([
  ".exe",
  ".msi",
  ".dll",
  ".pdb",
  ".zip",
  ".7z",
  ".rar",
]);

const STRUCTURED_EXTENSIONS = new Set([".json", ".jsonc", ".yml", ".yaml", ".toml"]);

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
  [
    "docs/governance/calibration-evidence.schema.json",
    "docs/governance/calibration-evidence.example.json",
  ],
];

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function structuredFileLimit(root, file) {
  return relative(root, file) === "package-lock.json"
    ? MAX_ROOT_PACKAGE_LOCK_BYTES
    : MAX_SCAN_BYTES;
}

async function scanTree(root) {
  const files = [];
  const errors = [];

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const rel = relative(root, absolute);

      if (entry.isSymbolicLink()) {
        errors.push(`${rel}: symlinks are forbidden`);
        continue;
      }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
        if (FORBIDDEN_GENERATED_DIRECTORIES.has(entry.name)) {
          errors.push(`${rel}: generated output directory is forbidden`);
          continue;
        }
        await walk(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      } else {
        errors.push(`${rel}: unsupported filesystem entry`);
      }
    }
  }

  await walk(root);
  return { files, errors };
}

function stripJsoncComments(text) {
  let result = "";
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < text.length) {
    const character = text[index];
    const next = text[index + 1];

    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      index += 1;
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      index += 1;
      continue;
    }

    if (character === "/" && next === "/") {
      index += 2;
      while (index < text.length && text[index] !== "\n") index += 1;
      continue;
    }

    if (character === "/" && next === "*") {
      index += 2;
      let closed = false;
      while (index < text.length) {
        if (text[index] === "*" && text[index + 1] === "/") {
          index += 2;
          closed = true;
          break;
        }
        if (text[index] === "\n") result += "\n";
        index += 1;
      }
      if (!closed) throw new Error("Invalid JSONC: unterminated block comment");
      continue;
    }

    result += character;
    index += 1;
  }

  if (inString) throw new Error("Invalid JSONC: unterminated string");
  return result;
}

function stripJsoncTrailingCommas(text) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }

    if (character === ",") {
      let lookahead = index + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead])) lookahead += 1;
      if (text[lookahead] === "}" || text[lookahead] === "]") continue;
    }

    result += character;
  }

  return result;
}

export function parseJsonc(text) {
  try {
    return JSON.parse(stripJsoncTrailingCommas(stripJsoncComments(text)));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid JSONC:")) throw error;
    throw new Error(`Invalid JSONC: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidDate(value) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

function isValidDateTime(value) {
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match || !isValidDate(match[1])) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  const offsetHour = match[6] === undefined ? 0 : Number(match[6]);
  const offsetMinute = match[7] === undefined ? 0 : Number(match[7]);
  return hour <= 23 && minute <= 59 && second <= 60 && offsetHour <= 23 && offsetMinute <= 59;
}

async function validateStructuredFilesFrom(root, files) {
  const errors = [];
  for (const file of files) {
    const rel = relative(root, file);
    const ext = path.extname(file).toLowerCase();
    if (!STRUCTURED_EXTENSIONS.has(ext)) continue;
    const info = await stat(file);
    const limit = structuredFileLimit(root, file);
    if (info.size > limit) {
      errors.push(`${rel}: structured file exceeds ${limit}-byte validation limit`);
      continue;
    }
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

export async function validateStructuredFiles(root) {
  const scan = await scanTree(root);
  return [...scan.errors, ...(await validateStructuredFilesFrom(root, scan.files))];
}

export async function validateSchemaExamples(root) {
  const errors = [];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addFormat("date", { type: "string", validate: isValidDate });
  ajv.addFormat("date-time", { type: "string", validate: isValidDateTime });

  for (const [schemaRel, exampleRel] of SCHEMA_EXAMPLES) {
    const schemaPath = path.join(root, schemaRel);
    const examplePath = path.join(root, exampleRel);
    if (!(await exists(schemaPath)) || !(await exists(examplePath))) continue;
    if ((await stat(schemaPath)).size > MAX_SCAN_BYTES || (await stat(examplePath)).size > MAX_SCAN_BYTES) {
      errors.push(`${exampleRel}: schema validation input exceeds ${MAX_SCAN_BYTES}-byte limit`);
      continue;
    }
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    const example = JSON.parse(await readFile(examplePath, "utf8"));
    const validate = ajv.compile(schema);
    if (!validate(example)) {
      errors.push(`${exampleRel}: does not satisfy ${schemaRel}: ${ajv.errorsText(validate.errors)}`);
    }
  }
  return errors;
}

function isAbsoluteLocalPath(value) {
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function escapesRoot(root, resolved) {
  const relation = path.relative(path.resolve(root), resolved);
  return relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation);
}

async function validateMarkdownLinksFrom(root, files) {
  const errors = [];
  for (const file of files) {
    if (path.extname(file).toLowerCase() !== ".md") continue;
    const rel = relative(root, file);
    const info = await stat(file);
    if (info.size > MAX_SCAN_BYTES) {
      errors.push(`${rel}: Markdown file exceeds ${MAX_SCAN_BYTES}-byte validation limit`);
      continue;
    }
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
      const encodedPath = target.split(/[?#]/, 1)[0];
      if (!encodedPath) continue;

      let decoded;
      try {
        decoded = decodeURIComponent(encodedPath);
      } catch {
        errors.push(`${rel}: malformed percent-encoding in link '${target}'`);
        continue;
      }

      if (isAbsoluteLocalPath(decoded)) {
        errors.push(`${rel}: absolute local path is forbidden in link '${target}'`);
        continue;
      }

      const resolved = path.resolve(path.dirname(file), decoded);
      if (escapesRoot(root, resolved)) {
        errors.push(`${rel}: link escapes repository root '${target}'`);
      } else if (!(await exists(resolved))) {
        errors.push(`${rel}: broken relative link '${target}'`);
      }
    }
  }
  return errors;
}

export async function validateMarkdownLinks(root) {
  const scan = await scanTree(root);
  return [...scan.errors, ...(await validateMarkdownLinksFrom(root, scan.files))];
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

async function validateTrackedContentFrom(root, files) {
  const errors = [];
  for (const file of files) {
    const rel = relative(root, file);
    const ext = path.extname(file).toLowerCase();
    if (FORBIDDEN_BINARY_EXTENSIONS.has(ext)) {
      errors.push(`${rel}: forbidden generated or binary artifact`);
      continue;
    }
    if (!isScannableText(file)) continue;
    const info = await stat(file);
    if (info.size > MAX_SCAN_BYTES) {
      if (!STRUCTURED_EXTENSIONS.has(ext) && ext !== ".md") {
        errors.push(`${rel}: text file exceeds ${MAX_SCAN_BYTES}-byte validation limit`);
      }
      continue;
    }
    const lines = (await readFile(file, "utf8")).split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      for (const [rule, pattern] of SECRET_PATTERNS) {
        if (pattern.test(lines[index])) errors.push(`${rel}:${index + 1}: ${rule}`);
      }
    }
  }
  return errors;
}

export async function validateTrackedContent(root) {
  const scan = await scanTree(root);
  return [...scan.errors, ...(await validateTrackedContentFrom(root, scan.files))];
}

export async function validateRepository(root) {
  const scan = await scanTree(root);
  return [
    ...scan.errors,
    ...(await validateStructuredFilesFrom(root, scan.files)),
    ...(await validateSchemaExamples(root)),
    ...(await validateMarkdownLinksFrom(root, scan.files)),
    ...(await validateTrackedContentFrom(root, scan.files)),
  ];
}

export {
  EXCLUDED_DIRECTORIES,
  FORBIDDEN_BINARY_EXTENSIONS,
  FORBIDDEN_GENERATED_DIRECTORIES,
  MAX_ROOT_PACKAGE_LOCK_BYTES,
  MAX_SCAN_BYTES,
  SECRET_PATTERNS,
};
