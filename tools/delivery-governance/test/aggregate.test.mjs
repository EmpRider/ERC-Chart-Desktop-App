import assert from "node:assert/strict";
import test from "node:test";
import { aggregateResults } from "../src/aggregate.mjs";

const base = {
  governance: "success",
  applicationWindows: "skipped",
  applicationPresent: false,
  epicToMain: false,
};

test("governance failure always fails", () =>
  assert.equal(aggregateResults({ ...base, governance: "failure" }).ok, false));
test("no application accepts skipped Windows job", () =>
  assert.equal(aggregateResults(base).ok, true));
test("no application rejects a falsely successful Windows job", () =>
  assert.equal(
    aggregateResults({ ...base, applicationWindows: "success" }).ok,
    false,
  ));
test("task-to-epic accepts skipped Windows", () =>
  assert.equal(
    aggregateResults({
      ...base,
      applicationPresent: true,
    }).ok,
    true,
  ));
test("task-to-epic rejects a Windows job that ran", () =>
  assert.equal(
    aggregateResults({
      ...base,
      applicationPresent: true,
      applicationWindows: "success",
    }).ok,
    false,
  ));
test("epic-to-main requires Windows success", () =>
  assert.equal(
    aggregateResults({
      ...base,
      applicationPresent: true,
      epicToMain: true,
    }).ok,
    false,
  ));
test("epic-to-main passes with Windows success", () =>
  assert.equal(
    aggregateResults({
      ...base,
      applicationPresent: true,
      applicationWindows: "success",
      epicToMain: true,
    }).ok,
    true,
  ));
test("docs-only application accepts skipped Windows job", () =>
  assert.equal(
    aggregateResults({
      ...base,
      applicationPresent: true,
      docsOnly: true,
      epicToMain: true,
    }).ok,
    true,
  ));
test("docs-only application rejects a Windows job that ran", () =>
  assert.equal(
    aggregateResults({
      ...base,
      applicationPresent: true,
      docsOnly: true,
      applicationWindows: "success",
    }).ok,
    false,
  ));
test("governance-only application accepts skipped Windows job", () =>
  assert.equal(
    aggregateResults({
      ...base,
      applicationPresent: true,
      governanceOnly: true,
    }).ok,
    true,
  ));
test("cancelled required Windows job fails", () =>
  assert.equal(
    aggregateResults({
      ...base,
      applicationPresent: true,
      applicationWindows: "cancelled",
      epicToMain: true,
    }).ok,
    false,
  ));
