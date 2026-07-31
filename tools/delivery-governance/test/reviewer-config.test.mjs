import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

const root = new URL("../../../", import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), "utf8");
}

test("CODEOWNERS assigns every path to EmpRider", async () => {
  assert.equal((await text(".github/CODEOWNERS")).trim(), "* @EmpRider");
});

test("CodeRabbit enforces the approved current-head review controls", async () => {
  const config = parseYaml(await text(".coderabbit.yaml"));
  assert.equal(config.reviews.profile, "assertive");
  assert.equal(config.reviews.request_changes_workflow, true);
  assert.equal(config.reviews.auto_review.drafts, false);
  assert.equal(config.reviews.auto_review.auto_incremental_review, true);
  assert.equal(config.reviews.auto_review.auto_pause_after_reviewed_commits, 0);
  assert.deepEqual(config.reviews.auto_review.base_branches, ["^epic/.*$"]);
  assert.equal(
    config.reviews.pre_merge_checks.override_requested_reviewers_only,
    true,
  );
  assert.deepEqual(
    config.reviews.pre_merge_checks.custom_checks.map(({ name }) => name),
    ["Scope alignment", "Performance safety", "Simplicity"],
  );
  assert.ok(
    config.reviews.pre_merge_checks.custom_checks.every(
      ({ mode }) => mode === "error",
    ),
  );
});

test("Qodo is stable-head manual only and Code Review AI is not auto-invoked", async () => {
  const raw = await text(".pr_agent.toml");
  const config = parseToml(raw);
  assert.equal(config.config.disable_auto_feedback, true);
  assert.equal(config.github_app.handle_push_trigger, false);
  assert.deepEqual(config.github_app.pr_commands, []);
  assert.deepEqual(config.github_app.push_commands, []);
  assert.equal(config.review_agent.comments_location_policy, "both");
  assert.equal(config.review_agent.inline_comments_severity_threshold, 3);
  assert.equal(/code review ai/i.test(raw), false);
});
