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

function describeStdout(stdout) {
  const diagnostic = stdout.trim();
  return diagnostic.length === 0
    ? "Electron stdout was empty."
    : `Electron stdout (last ${maximumDiagnosticCharacters} characters):\n${diagnostic}`;
}

export function createElectronArguments({
  userDataPath,
  entryPath,
  smokeArgument,
}) {
  return [
    `--user-data-dir=${userDataPath}`,
    entryPath,
    "--erc-chart-smoke",
    `--erc-chart-user-data-path=${userDataPath}`,
    ...(smokeArgument === undefined ? [] : [smokeArgument]),
  ];
}

export async function runIndependentElectronProcesses({
  processes,
  runProcess = runElectronProcess,
}) {
  if (!Array.isArray(processes) || processes.length < 2) {
    throw new Error("Multi-instance smoke requires at least two processes.");
  }

  const results = await Promise.allSettled(
    processes.map((configuration) => runProcess(configuration)),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure !== undefined) throw failure.reason;
}

export function runElectronProcess({
  executable,
  args,
  cwd,
  env,
  timeoutMs,
  readyMarker,
  spawnProcess = spawn,
}) {
  return new Promise((resolve, reject) => {
    let ready = false;
    let finished = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    const child = spawnProcess(executable, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      if (finished) return;
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = appendDiagnostic(stdout, chunk);
      if (stdout.includes(readyMarker)) ready = true;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = appendDiagnostic(stderr, chunk);
    });
    child.on("error", (error) => {
      if (finished || timedOut) return;
      finished = true;
      clearTimeout(timeout);
      reject(
        new Error(`Electron smoke process could not start: ${error.message}`),
      );
    });
    child.on("close", (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (timedOut) {
        reject(
          new Error(
            `Electron smoke test timed out after ${timeoutMs} ms. ${describeStdout(stdout)} ${describeStderr(stderr)}`,
          ),
        );
        return;
      }
      if (code === 0 && ready) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Electron smoke test did not reach ready state (exit code ${String(code)}, signal ${signal ?? "none"}). ${describeStdout(stdout)} ${describeStderr(stderr)}`,
        ),
      );
    });
  });
}
