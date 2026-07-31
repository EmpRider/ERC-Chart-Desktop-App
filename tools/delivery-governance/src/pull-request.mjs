import process from "node:process";
import { validateBranchPolicy } from "./policy.mjs";
import { validatePullRequestBody } from "./pr-contract.mjs";

function changedFilesFrom(environment) {
  if (typeof environment.PR_CHANGED_FILES !== "string") return null;
  const files = environment.PR_CHANGED_FILES
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  return files.length > 0 ? files : null;
}

export function contextFromEvent(event, environment = process.env) {
  const pullRequest = event.pull_request;
  if (!pullRequest) throw new Error("GitHub event does not contain a pull_request object.");
  return {
    number: pullRequest.number ?? event.number,
    title: pullRequest.title ?? "",
    head: pullRequest.head?.ref ?? "",
    base: pullRequest.base?.ref ?? "",
    baseSha: pullRequest.base?.sha ?? "",
    headSha: pullRequest.head?.sha ?? "",
    baseIsAncestor: environment.PR_BASE_IS_ANCESTOR === "true",
    body: pullRequest.body ?? "",
    changedFiles: changedFilesFrom(environment),
  };
}

export async function validatePullRequestEvent(_root, event, environment = process.env) {
  const context = contextFromEvent(event, environment);
  return [
    ...validateBranchPolicy(context),
    ...validatePullRequestBody(context.body, context),
  ];
}
