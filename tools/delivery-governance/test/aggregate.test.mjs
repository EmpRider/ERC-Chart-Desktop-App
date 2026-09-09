import assert from "node:assert/strict";
import test from "node:test";
import { aggregateResults } from "../src/aggregate.mjs";

const base = {
  governance: "success",
  applicationLinux: "skipped",
  applicationWindows: "skipped",
  applicationPresent: false,
  epicToMain: false,
};

test("governance failure always fails", () =>
  assert.equal(aggregateResults({ ...base, governance: "failure" }).ok, false));
test("no application accepts skipped jobs", () =>
  assert.equal(aggregateResults(base).ok, true));
test("no application rejects a falsely successful application job", () =>
  assert.equal(
    aggregateResults({ ...base, applicationLinux: "success" }).ok,
    false,
  ));
test("application manifest requires Linux success", () =>
  assert.equal(
    aggregateResults({
      ...base,
      applicationPresent: true,
      applicationLinux: "failure",
    }).ok,
    false,
  ));
test("task-to-epic accepts skipped Windows", () =>
  assert.equal(
    aggregateResults({
      ...base,
      applicationPresent: true,
      applicationLinux: "success",
    }).ok,
    true,
  ));
test("task-to-epic rejects a Windows job that ran", () =>
  assert.equal(
    aggregateResults({
      ...base,
      applicationPresent: true,
      applicationLinux: "success",
      applicationWindows: "success",
    }).ok,
    false,
  ));
test("epic-to-main requires Windows success", () =>
  assert.equal(
    aggregateResults({
      ...base,
      applicationPresent: true,
      applicationLinux: "success",
      epicToMain: true,
    }).ok,
    false,
  ));
test("epic-to-main passes with Windows success", () =>
  assert.equal(
    aggregateResults({
      ...base,
      applicationPresent: true,
      applicationLinux: "success",
      applicationWindows: "success",
      epicToMain: true,
    }).ok,
    true,
  ));
test("docs-only application accepts skipped application jobs", () =>
  assert.equal(
    aggregateResults({
      ...base,
      applicationPresent: true,
      docsOnly: true,
      epicToMain: true,
    }).ok,
    true,
  ));
test("docs-only application rejects an application job that ran", () =>
  assert.equal(
    aggregateResults({
      ...base,
      applicationPresent: true,
      docsOnly: true,
      applicationLinux: "success",
    }).ok,
    false,
  ));
test("cancelled jobs fail", () =>
  assert.equal(
    aggregateResults({
      ...base,
      applicationPresent: true,
      applicationLinux: "cancelled",
    }).ok,
    false,
  ));
