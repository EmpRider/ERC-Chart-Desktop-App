import { readFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

const REPOSITORY = "EmpRider/ERC-Chart-Desktop-App";
const API_ROOT = `https://api.github.com/repos/${REPOSITORY}`;
const API_VERSION = "2026-03-10";

const repositorySettings = {
  allow_squash_merge: true,
  allow_merge_commit: true,
  allow_rebase_merge: false,
  delete_branch_on_merge: true,
};

const workflowPermissions = {
  default_workflow_permissions: "read",
  can_approve_pull_request_reviews: false,
};

async function loadRulesets() {
  return [
    JSON.parse(await readFile(new URL("../../../.github/rulesets/main.json", import.meta.url), "utf8")),
    JSON.parse(await readFile(new URL("../../../.github/rulesets/epic.json", import.meta.url), "utf8")),
  ];
}

function headers(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": API_VERSION,
  };
}

async function request(fetchImpl, token, method, url, body) {
  const response = await fetchImpl(url, {
    method,
    headers: headers(token),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${method} ${url} failed with ${response.status}: ${detail.slice(0, 300)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function reconcileRepository({
  apply = false,
  token,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  const desiredRulesets = await loadRulesets();
  if (!apply) {
    logger.log(`DRY RUN PATCH ${API_ROOT}`);
    logger.log(`DRY RUN PUT ${API_ROOT}/actions/permissions/workflow`);
    for (const ruleset of desiredRulesets) logger.log(`DRY RUN ruleset ${ruleset.name}`);
    return { applied: false, rulesets: desiredRulesets.map(({ name }) => name) };
  }
  if (!token) throw new Error("ERC_CHART_GITHUB_ADMIN_TOKEN is required with --apply.");

  await request(fetchImpl, token, "PATCH", API_ROOT, repositorySettings);
  await request(
    fetchImpl,
    token,
    "PUT",
    `${API_ROOT}/actions/permissions/workflow`,
    workflowPermissions,
  );
  const existing = await request(fetchImpl, token, "GET", `${API_ROOT}/rulesets`);
  const existingByName = new Map(existing.map((ruleset) => [ruleset.name, ruleset]));
  for (const desired of desiredRulesets) {
    const current = existingByName.get(desired.name);
    if (current) {
      await request(fetchImpl, token, "PUT", `${API_ROOT}/rulesets/${current.id}`, desired);
    } else {
      await request(fetchImpl, token, "POST", `${API_ROOT}/rulesets`, desired);
    }
  }
  logger.log(`Applied repository settings and ${desiredRulesets.length} rulesets.`);
  return { applied: true, rulesets: desiredRulesets.map(({ name }) => name) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes("--apply");
  try {
    await reconcileRepository({
      apply,
      token: process.env.ERC_CHART_GITHUB_ADMIN_TOKEN,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export { API_ROOT, API_VERSION, repositorySettings, workflowPermissions };
