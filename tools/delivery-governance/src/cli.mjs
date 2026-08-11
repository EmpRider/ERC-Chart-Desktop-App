import { readFile } from "node:fs/promises";
import process from "node:process";

async function repository(root) {
  const { validateRepository } = await import("./repository.mjs");
  return validateRepository(root);
}

async function pullRequest(root) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath)
    throw new Error(
      "GITHUB_EVENT_PATH is required for pull-request validation.",
    );
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  const { validatePullRequestEvent } = await import("./pull-request.mjs");
  return validatePullRequestEvent(root, event);
}

async function applicationContract(root) {
  const { validateApplicationContract } =
    await import("./application-contract.mjs");
  const result = await validateApplicationContract(root);
  return result.errors;
}

async function aggregate() {
  const { aggregateFromEnvironment } = await import("./aggregate.mjs");
  const result = aggregateFromEnvironment(process.env);
  if (!result.ok) return [result.summary];
  console.log(result.summary);
  return [];
}

const handlers = new Map([
  ["repository", repository],
  ["pull-request", pullRequest],
  ["application-contract", applicationContract],
  ["aggregate", aggregate],
]);

const [command, root = process.cwd()] = process.argv.slice(2);
const handler = handlers.get(command);
if (!handler) {
  console.error(`Unknown governance command: ${command ?? "<missing>"}`);
  process.exitCode = 2;
} else {
  try {
    const errors = await handler(root);
    for (const error of errors) console.error(error);
    if (errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
