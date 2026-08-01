import { spawn } from "node:child_process";

const maximumDiagnosticCharacters = 8_192;

function appendDiagnostic(current, chunk) {
  return `${current}${chunk}`.slice(-maximumDiagnosticCharacters);
}

function describeStderr(stderr) {
  const diagnostic = stderr.trim();
  return diagnostic.length === 0
    ? "Electron stderr was empty."
    : `Electron stderr (last ${maximumDiagnosticCharacters} characters):\n${diagnostic}`;
}

export function createElectronArguments({ platform, userDataPath, entryPath }) {
  const args = [];
  if (platform === "linux") args.push("--no-sandbox");
  args.push(`--user-data-dir=${userDataPath}`, entryPath, "--erc-chart-smoke");
  return args;
}

export function runElectronProcess({
  executable,
  args,
  cwd,
  env,
  timeoutMs,
  readyMarker,
}) {
  return new Promise((resolve, reject) => {
    let ready = false;
    let finished = false;
    let stderr = "";
    const child = spawn(executable, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill();
      reject(
        new Error(
          `Electron smoke test timed out after ${timeoutMs} ms. ${describeStderr(stderr)}`,
        ),
      );
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (chunk.includes(readyMarker)) ready = true;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = appendDiagnostic(stderr, chunk);
    });
    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(
        new Error(`Electron smoke process could not start: ${error.message}`),
      );
    });
    child.on("exit", (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (code === 0 && ready) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Electron smoke test did not reach ready state (exit code ${String(code)}, signal ${signal ?? "none"}). ${describeStderr(stderr)}`,
        ),
      );
    });
  });
}
