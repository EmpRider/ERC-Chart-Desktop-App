import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const maxAttempts = 3;
const retryDelayMs = 5000;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const auditArgs = [
  "audit",
  "--audit-level=high",
  "--omit=optional",
  "--fetch-timeout=60000",
];

async function runAudit() {
  return await new Promise((resolve, reject) => {
    const child = spawn(npmCommand, auditArgs, {
      stdio: "inherit",
      windowsHide: true,
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        console.error(`Dependency audit terminated by signal ${signal}.`);
        resolve(1);
        return;
      }

      resolve(code ?? 1);
    });
  });
}

let finalExitCode = 1;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  console.error(`Dependency audit attempt ${attempt}/${maxAttempts}.`);

  try {
    finalExitCode = await runAudit();
  } catch (error) {
    console.error(
      `Dependency audit could not start: ${error instanceof Error ? error.message : String(error)}`,
    );
    finalExitCode = 1;
  }

  if (finalExitCode === 0) {
    break;
  }

  if (attempt < maxAttempts) {
    const delayMs = retryDelayMs * attempt;
    console.error(`Dependency audit failed; retrying in ${delayMs} ms.`);
    await delay(delayMs);
  }
}

process.exitCode = finalExitCode;
