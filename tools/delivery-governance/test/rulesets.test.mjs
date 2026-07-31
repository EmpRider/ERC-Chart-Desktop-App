import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const REQUIRED_CONTEXTS = [
  "CodeRabbit",
  "Delivery gates",
  "semgrep-cloud-platform/scan",
];

async function ruleset(name) {
  return JSON.parse(
    await readFile(new URL(`.github/rulesets/${name}.json`, root), "utf8"),
  );
}

function rule(document, type) {
  return document.rules.find((entry) => entry.type === type);
}

function contexts(document) {
  return rule(document, "required_status_checks")
    .parameters.required_status_checks.map(({ context }) => context)
    .sort();
}

function assertSoloMaintainer(document, mergeMethod) {
  const pullRequest = rule(document, "pull_request").parameters;
  assert.equal(pullRequest.required_approving_review_count, 0);
  assert.equal(pullRequest.require_code_owner_review, false);
  assert.equal(pullRequest.require_last_push_approval, false);
  assert.equal(pullRequest.required_review_thread_resolution, true);
  assert.equal(pullRequest.dismiss_stale_reviews_on_push, true);
  assert.deepEqual(pullRequest.allowed_merge_methods, [mergeMethod]);

  const statusChecks = rule(document, "required_status_checks").parameters;
  assert.equal(statusChecks.strict_required_status_checks_policy, true);
  assert.deepEqual(contexts(document), REQUIRED_CONTEXTS);

  assert.deepEqual(document.bypass_actors, []);
  assert.ok(rule(document, "deletion"));
  assert.ok(rule(document, "non_fast_forward"));
}

test("main ruleset enforces solo-maintainer epic review gates", async () => {
  const document = await ruleset("main");
  assert.equal(document.name, "ERC main");
  assert.equal(document.enforcement, "active");
  assert.deepEqual(document.conditions.ref_name.include, ["refs/heads/main"]);
  assertSoloMaintainer(document, "merge");
});

test("epic ruleset enforces solo-maintainer task review gates", async () => {
  const document = await ruleset("epic");
  assert.equal(document.name, "ERC epic branches");
  assert.equal(document.enforcement, "active");
  assert.deepEqual(document.conditions.ref_name.include, ["refs/heads/epic/*"]);
  assertSoloMaintainer(document, "squash");
});
