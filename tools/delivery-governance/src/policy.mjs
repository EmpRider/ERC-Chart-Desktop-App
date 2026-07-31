const TASK_BRANCH = /^task\/(ECDD-\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EPIC_BRANCH = /^epic\/(ECDD-\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BOOTSTRAP_BRANCH = "bootstrap/delivery-governance";
const SHA = /^[0-9a-f]{40}$/;

const BOOTSTRAP_PATHS = [
  /^\.coderabbit\.yaml$/,
  /^\.gitignore$/,
  /^\.markdownlint-cli2\.jsonc$/,
  /^\.pr_agent\.toml$/,
  /^\.github\/(?:CODEOWNERS|pull_request_template\.md|workflows\/delivery-gates\.yml|rulesets\/(?:main|epic)\.json)$/,
  /^docs\/governance\//,
  /^docs\/superpowers\/plans\//,
  /^docs\/superpowers\/specs\//,
  /^tools\/delivery-governance\//,
];

export function extractBranchIssueKey(branch) {
  return TASK_BRANCH.exec(branch)?.[1] ?? EPIC_BRANCH.exec(branch)?.[1] ?? null;
}

export function branchKind(branch) {
  if (branch === BOOTSTRAP_BRANCH) return "bootstrap";
  if (TASK_BRANCH.test(branch)) return "task";
  if (EPIC_BRANCH.test(branch)) return "epic";
  return "invalid";
}

function jiraValue(body, label) {
  const match = body.match(new RegExp(`^- ${label}: \\[?(ECDD-\\d+)`, "mi"));
  return match?.[1] ?? null;
}

export function validateBranchPolicy(context) {
  const errors = [];
  const kind = branchKind(context.head ?? "");

  if (!SHA.test(context.baseSha ?? "") || !SHA.test(context.headSha ?? "")) {
    errors.push("Pull-request base and head SHAs must be 40-character lowercase hexadecimal values.");
  }
  if (context.baseIsAncestor === false) {
    errors.push("The pull-request branch must be based on the current target branch.");
  }

  if (kind === "bootstrap") {
    if (context.number !== 1) {
      errors.push("The delivery-governance bootstrap exception is restricted to PR 1.");
    }
    if (context.base !== "main") {
      errors.push("The delivery-governance bootstrap branch must target main.");
    }
    if (!Array.isArray(context.changedFiles) || context.changedFiles.length === 0) {
      errors.push("Bootstrap validation requires non-empty PR_CHANGED_FILES.");
      return errors;
    }
    for (const changedPath of context.changedFiles) {
      if (!BOOTSTRAP_PATHS.some((pattern) => pattern.test(changedPath))) {
        errors.push(`Bootstrap pull request contains a disallowed path: ${changedPath}`);
      }
    }
    return errors;
  }

  if (kind === "task") {
    const issue = extractBranchIssueKey(context.head);
    const parent = jiraValue(context.body ?? "", "Parent epic");
    const bodyIssue = jiraValue(context.body ?? "", "Issue");
    if (!EPIC_BRANCH.test(context.base ?? "") || extractBranchIssueKey(context.base) !== parent) {
      errors.push("Task branches must target their declared epic branch.");
    }
    if (issue !== bodyIssue) {
      errors.push("Task branch Jira key must match the pull-request Issue.");
    }
    if (!new RegExp(`^${issue}: (?!merge\\b).+`).test(context.title ?? "")) {
      errors.push("Task pull-request title must use 'ECDD-N: imperative summary'.");
    }
    return errors;
  }

  if (kind === "epic") {
    const issue = extractBranchIssueKey(context.head);
    const bodyEpic = jiraValue(context.body ?? "", "Epic");
    if (context.base !== "main") {
      errors.push("Epic branches must target main.");
    }
    if (issue !== bodyEpic) {
      errors.push("Epic branch Jira key must match the pull-request Epic.");
    }
    if (!new RegExp(`^${issue}: merge .+`).test(context.title ?? "")) {
      errors.push("Epic pull-request title must use 'ECDD-N: merge epic summary'.");
    }
    return errors;
  }

  errors.push("Head branch must be task/ECDD-N-slug, epic/ECDD-N-slug, or the one-time bootstrap branch.");
  return errors;
}

export { BOOTSTRAP_PATHS, BOOTSTRAP_BRANCH, TASK_BRANCH, EPIC_BRANCH };
