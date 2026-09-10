import process from "node:process";
import { pathToFileURL } from "node:url";

function fail(summary) {
  return { ok: false, summary };
}

export function aggregateResults({
  governance,
  applicationLinux,
  applicationWindows,
  applicationPresent,
  docsOnly = false,
  governanceOnly = false,
  epicToMain,
}) {
  if (governance !== "success")
    return fail(`Delivery gates failed: Governance result is '${governance}'.`);

  if (docsOnly || governanceOnly) {
    if (applicationLinux !== "skipped" || applicationWindows !== "skipped") {
      return fail(
        "Delivery gates failed: application jobs must be skipped for documentation-only or delivery-governance-only pull requests.",
      );
    }
    return {
      ok: true,
      summary: docsOnly
        ? "Delivery gates passed. Application gates are not applicable to documentation-only changes."
        : "Delivery gates passed. Application gates are not applicable to delivery-governance-only changes.",
    };
  }

  if (!applicationPresent) {
    if (applicationLinux !== "skipped" || applicationWindows !== "skipped") {
      return fail(
        "Delivery gates failed: application jobs must be skipped when root package.json is absent.",
      );
    }
    return {
      ok: true,
      summary:
        "Delivery gates passed. Application gates are not applicable because root package.json is absent.",
    };
  }

  if (applicationLinux !== "success") {
    return fail(
      `Delivery gates failed: Application / Linux result is '${applicationLinux}'.`,
    );
  }
  if (epicToMain && applicationWindows !== "success") {
    return fail(
      `Delivery gates failed: Application / Windows result is '${applicationWindows}'.`,
    );
  }
  if (!epicToMain && applicationWindows !== "skipped") {
    return fail(
      "Delivery gates failed: Application / Windows must be skipped for task-to-epic pull requests.",
    );
  }
  return {
    ok: true,
    summary: epicToMain
      ? "Delivery gates passed for epic-to-main, including Windows packaging checks."
      : "Delivery gates passed for task-to-epic; Windows packaging checks are not applicable.",
  };
}

export function aggregateFromEnvironment(environment) {
  const applicationPresent =
    environment.APPLICATION_CONTRACT_PRESENT === undefined
      ? environment.APPLICATION_PRESENT === "true"
      : environment.APPLICATION_CONTRACT_PRESENT === "true";

  return aggregateResults({
    governance: environment.GOVERNANCE_RESULT,
    applicationLinux: environment.APPLICATION_LINUX_RESULT,
    applicationWindows: environment.APPLICATION_WINDOWS_RESULT,
    applicationPresent,
    docsOnly: environment.DOCS_ONLY === "true",
    governanceOnly: environment.GOVERNANCE_ONLY === "true",
    epicToMain: environment.EPIC_TO_MAIN === "true",
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = aggregateFromEnvironment(process.env);
  console.log(result.summary);
  if (!result.ok) process.exitCode = 1;
}
