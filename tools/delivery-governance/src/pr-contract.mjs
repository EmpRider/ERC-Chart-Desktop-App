import { branchKind, extractBranchIssueKey } from "./policy.mjs";

export const REQUIRED_SECTIONS = [
  "Jira",
  "Acceptance criteria",
  "Out of scope",
  "Design",
  "Verification",
  "Performance",
  "Dependencies",
  "Risk and rollback",
  "Screenshots",
  "Security declaration",
];

const JIRA_PREFIX = "https://erc-chart.atlassian.net/browse/";

export function parsePullRequestBody(markdown) {
  if (typeof markdown !== "string") throw new TypeError("Pull-request body must be text.");
  const sections = new Map();
  let current = null;
  let buffer = [];
  let fence = null;

  const flush = () => {
    if (current !== null) {
      if (sections.has(current)) throw new Error(`Duplicate required heading: ${current}`);
      sections.set(current, buffer.join("\n").trim());
    }
  };

  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (fence === fenceMatch[1][0]) fence = null;
    }
    const heading = fence === null ? line.match(/^##\s+(.+?)\s*$/) : null;
    if (heading) {
      flush();
      current = heading[1];
      buffer = [];
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  flush();
  return Object.fromEntries(sections);
}

function jiraLinks(section) {
  return [...section.matchAll(/^- ([A-Za-z ]+): \[(ECDD-\d+)\]\((https:\/\/[^)]+)\)$/gm)].map(
    ([, label, key, url]) => ({ label, key, url }),
  );
}

export function validatePullRequestBody(markdown, context) {
  const errors = [];
  let sections;
  try {
    sections = parsePullRequestBody(markdown);
  } catch (error) {
    return [error.message];
  }

  for (const heading of REQUIRED_SECTIONS) {
    if (!Object.hasOwn(sections, heading)) errors.push(`Missing required section: ${heading}`);
  }
  if (/<!--/.test(markdown)) errors.push("Pull-request body still contains template instructions.");
  if (errors.length) return errors;

  const acceptance = sections["Acceptance criteria"];
  if (!/- \[x\] /i.test(acceptance) || /- \[ \] /.test(acceptance)) {
    errors.push("Every acceptance criterion must be checked.");
  }
  if (!/```[^\n]*\n[\s\S]*?\n```/.test(sections.Verification)) {
    errors.push("Verification must include a fenced command-output block.");
  }
  if (!/- \[x\] No secrets, credentials, installers, generated binaries, or local state are included\./i.test(
    sections["Security declaration"],
  )) {
    errors.push("The security declaration must be checked.");
  }

  const kind = branchKind(context.head ?? "");
  const jira = sections.Jira;
  if (kind === "bootstrap") {
    if (context.number !== 1 || !/^Not applicable — one-time bootstrap PR #1\.?$/m.test(jira)) {
      errors.push("Bootstrap PR 1 must declare Jira as not applicable using the approved one-time exception.");
    }
    return errors;
  }

  const links = jiraLinks(jira);
  for (const link of links) {
    if (link.url !== `${JIRA_PREFIX}${link.key}`) errors.push(`Jira URL for ${link.label} is invalid.`);
  }
  const headKey = extractBranchIssueKey(context.head ?? "");
  if (kind === "task") {
    const issue = links.find((link) => link.label === "Issue")?.key;
    const parent = links.find((link) => link.label === "Parent epic")?.key;
    const baseKey = extractBranchIssueKey(context.base ?? "");
    if (!issue || !parent || links.length !== 2) errors.push("Task PR Jira section must contain Issue and Parent epic links only.");
    if (issue !== headKey) errors.push("Task PR Issue must match the head branch Jira key.");
    if (parent !== baseKey) errors.push("Task PR Parent epic must match the target epic branch.");
  } else if (kind === "epic") {
    const epic = links.find((link) => link.label === "Epic")?.key;
    if (!epic || links.length !== 1) errors.push("Epic PR Jira section must contain one Epic link only.");
    if (epic !== headKey) errors.push("Epic PR Jira key must match the head branch.");
  }
  return errors;
}
