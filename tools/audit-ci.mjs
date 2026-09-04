import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const npmExecPath = process.env.npm_execpath;
const npmCommand = npmExecPath ? process.execPath : "npm";
const npmAuditArgs = [
  "audit",
  "--audit-level=high",
  "--omit=optional",
  "--json",
  "--fetch-timeout=60000",
];
const npmServiceFailurePatterns = [
  /audit endpoint returned an error/i,
  /audit network timeout/i,
  /service unavailable/i,
  /\bE(?:CONN|AI_AGAIN|HOST|NET|TIMEDOUT)/i,
  /\b(?:502|503|504)\b/,
];
const osvBatchSize = 500;
const osvRequestTimeoutMs = 30000;

function writeCapturedOutput(stdout, stderr) {
  if (stdout) {
    process.stdout.write(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
  }
  if (stderr) {
    process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
  }
}

async function runNpmAudit() {
  return await new Promise((resolve, reject) => {
    const commandArgs = npmExecPath
      ? [npmExecPath, ...npmAuditArgs]
      : npmAuditArgs;
    const child = spawn(npmCommand, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code: code ?? 1, signal, stdout, stderr });
    });
  });
}

function isNpmServiceFailure(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  return (
    result.signal !== null ||
    npmServiceFailurePatterns.some((pattern) => pattern.test(output))
  );
}

function getLockedPackages(lockfile) {
  const packages = new Map();

  for (const [packagePath, metadata] of Object.entries(
    lockfile.packages ?? {},
  )) {
    if (!metadata?.version || metadata.optional === true) {
      continue;
    }

    const nodeModulesIndex = packagePath.lastIndexOf("node_modules/");
    if (nodeModulesIndex === -1) {
      continue;
    }

    const name = packagePath.slice(nodeModulesIndex + "node_modules/".length);
    if (!name || name.includes("/node_modules/")) {
      continue;
    }

    packages.set(`${name}@${metadata.version}`, {
      package: { name, ecosystem: "npm" },
      version: metadata.version,
    });
  }

  return [...packages.values()];
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(osvRequestTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}.`);
  }

  return await response.json();
}

async function queryOsv(packages) {
  const vulnerabilityIds = new Set();

  for (let offset = 0; offset < packages.length; offset += osvBatchSize) {
    const queries = packages.slice(offset, offset + osvBatchSize);
    const payload = await fetchJson("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries }),
    });

    for (const result of payload.results ?? []) {
      for (const vulnerability of result.vulns ?? []) {
        if (vulnerability?.id) {
          vulnerabilityIds.add(vulnerability.id);
        }
      }
    }
  }

  return [...vulnerabilityIds];
}

function severityLabels(vulnerability) {
  const labels = [];
  const databaseSeverity = vulnerability.database_specific?.severity;
  if (typeof databaseSeverity === "string") {
    labels.push(databaseSeverity);
  }

  for (const affected of vulnerability.affected ?? []) {
    const affectedSeverity = affected.database_specific?.severity;
    if (typeof affectedSeverity === "string") {
      labels.push(affectedSeverity);
    }
  }

  for (const severity of vulnerability.severity ?? []) {
    if (typeof severity?.score === "string") {
      labels.push(severity.score);
    }
  }

  return labels;
}

function isBlockingSeverity(vulnerability) {
  const labels = severityLabels(vulnerability);
  let explicitlyBelowHigh = false;

  for (const label of labels) {
    const normalized = label.trim().toUpperCase();
    if (normalized === "HIGH" || normalized === "CRITICAL") {
      return true;
    }
    if (
      normalized === "LOW" ||
      normalized === "MODERATE" ||
      normalized === "MEDIUM"
    ) {
      explicitlyBelowHigh = true;
      continue;
    }

    const numericScore = Number.parseFloat(normalized);
    if (Number.isFinite(numericScore)) {
      if (numericScore >= 7) {
        return true;
      }
      explicitlyBelowHigh = true;
    }
  }

  // Fail closed when OSV reports a vulnerability without a severity we can
  // confidently classify below npm audit's HIGH threshold.
  return !explicitlyBelowHigh;
}

async function runOsvFallback() {
  const lockfile = JSON.parse(await readFile("package-lock.json", "utf8"));
  const packages = getLockedPackages(lockfile);
  console.error(
    `npm audit service unavailable; scanning ${packages.length} locked package versions with OSV.`,
  );

  const vulnerabilityIds = await queryOsv(packages);
  if (vulnerabilityIds.length === 0) {
    console.error("OSV fallback audit found no known vulnerabilities.");
    return 0;
  }

  const vulnerabilities = await Promise.all(
    vulnerabilityIds.map((id) =>
      fetchJson(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`),
    ),
  );
  const blocking = vulnerabilities.filter(isBlockingSeverity);

  if (blocking.length === 0) {
    console.error(
      `OSV fallback audit found ${vulnerabilities.length} known vulnerabilities, but none are HIGH or CRITICAL.`,
    );
    return 0;
  }

  console.error(
    `OSV fallback audit found ${blocking.length} blocking vulnerabilities:`,
  );
  for (const vulnerability of blocking) {
    console.error(
      `- ${vulnerability.id}: ${vulnerability.summary ?? "No summary provided"}`,
    );
  }
  return 1;
}

let npmResult;
try {
  npmResult = await runNpmAudit();
} catch (error) {
  console.error(
    `npm audit could not start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}

if (npmResult) {
  writeCapturedOutput(npmResult.stdout, npmResult.stderr);

  if (npmResult.code === 0 && npmResult.signal === null) {
    process.exitCode = 0;
  } else if (!isNpmServiceFailure(npmResult)) {
    process.exitCode = npmResult.code || 1;
  } else {
    try {
      process.exitCode = await runOsvFallback();
    } catch (error) {
      console.error(
        `OSV fallback audit failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  }
}
