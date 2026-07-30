import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonc } from "../src/repository.mjs";

test("JSONC parsing preserves comment-like and trailing-comma text in strings", () => {
  const parsed = parseJsonc(`{
    // A real comment.
    "url": "https://example.test/path/*keep*/",
    "text": "value, }",
    "enabled": true,
  }`);
  assert.deepEqual(parsed, {
    url: "https://example.test/path/*keep*/",
    text: "value, }",
    enabled: true,
  });
});

test("invalid JSONC produces a deterministic parse error", () => {
  assert.throws(() => parseJsonc('{ "value": ] }'), /Invalid JSONC/);
});
