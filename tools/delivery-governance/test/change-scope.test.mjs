import assert from "node:assert/strict";
import test from "node:test";
import { isDocsOnlyChange } from "../src/change-scope.mjs";

test("docs-only scope accepts documentation paths and Markdown files", () => {
  assert.equal(
    isDocsOnlyChange([
      "docs/superpowers/specs/example.md",
      "packages/renderer/README.md",
    ]),
    true,
  );
});

test("docs-only scope rejects empty changes", () => {
  assert.equal(isDocsOnlyChange([]), false);
});

test("docs-only scope rejects application or workflow changes", () => {
  assert.equal(
    isDocsOnlyChange([
      "docs/superpowers/specs/example.md",
      "packages/renderer/src/app.ts",
    ]),
    false,
  );
  assert.equal(isDocsOnlyChange([".github/workflows/delivery-gates.yml"]), false);
});
