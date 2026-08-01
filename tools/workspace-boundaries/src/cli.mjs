import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateWorkspace } from "./workspace-contract.mjs";

export async function runWorkspaceValidation({
  root = process.cwd(),
  validate = validateWorkspace,
  stdout = console.log,
  stderr = console.error,
} = {}) {
  try {
    const errors = await validate(root);
    for (const error of errors) stderr(error);
    if (errors.length > 0) return 1;
    stdout("Workspace boundaries: valid.");
    return 0;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown error";
    stderr(`Workspace boundaries: validation failed: ${message}`);
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = await runWorkspaceValidation();
