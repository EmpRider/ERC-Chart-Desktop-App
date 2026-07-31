import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const REQUIRED_APPLICATION_SCRIPTS = [
  "format:check",
  "lint",
  "typecheck",
  "test:unit",
  "test:integration",
  "build",
  "test:performance",
  "audit:ci",
  "version:check",
];

export const REQUIRED_WINDOWS_SCRIPTS = ["package:win", "smoke:installer"];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function validateApplicationContract(root) {
  const manifestPath = path.join(root, "package.json");
  if (!(await exists(manifestPath))) {
    return {
      applicationPresent: false,
      errors: [],
      message:
        "Application gates: not applicable; root package.json is absent.",
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    return {
      applicationPresent: true,
      errors: [`package.json is invalid JSON: ${error.message}`],
      message: "Application gates: invalid root package.json.",
    };
  }

  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest)
  ) {
    return {
      applicationPresent: true,
      errors: ["package.json must contain a JSON object."],
      message: "Application gates: invalid root package.json.",
    };
  }

  const scripts = manifest.scripts ?? {};
  const errors = [];
  for (const script of [
    ...REQUIRED_APPLICATION_SCRIPTS,
    ...REQUIRED_WINDOWS_SCRIPTS,
  ]) {
    if (typeof scripts[script] !== "string" || scripts[script].trim() === "") {
      errors.push(`Root package.json must define script '${script}'.`);
    }
  }
  return {
    applicationPresent: true,
    errors,
    message:
      errors.length === 0
        ? "Application gates: command contract is present."
        : `Application gates: ${errors.length} required script(s) are missing.`,
  };
}
