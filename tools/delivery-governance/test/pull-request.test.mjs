import assert from "node:assert/strict";
import test from "node:test";
import { contextFromEvent } from "../src/pull-request.mjs";

const event = {
  number: 1,
  pull_request: {
    number: 1,
    title: "Plan GitHub delivery governance bootstrap",
    body: "body",
    head: { ref: "bootstrap/delivery-governance", sha: "1".repeat(40) },
    base: { ref: "main", sha: "2".repeat(40) },
  },
};

test("missing PR_CHANGED_FILES remains missing", () => {
  const context = contextFromEvent(event, { PR_BASE_IS_ANCESTOR: "true" });
  assert.equal(context.changedFiles, null);
});

test("blank PR_CHANGED_FILES remains missing", () => {
  const context = contextFromEvent(event, {
    PR_BASE_IS_ANCESTOR: "true",
    PR_CHANGED_FILES: "\n  \n",
  });
  assert.equal(context.changedFiles, null);
});

test("provided changed-file metadata is normalized", () => {
  const context = contextFromEvent(event, {
    PR_BASE_IS_ANCESTOR: "true",
    PR_CHANGED_FILES: "README.md\n tools/check.mjs \n",
  });
  assert.deepEqual(context.changedFiles, ["README.md", "tools/check.mjs"]);
});
