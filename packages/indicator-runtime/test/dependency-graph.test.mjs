import assert from "node:assert/strict";
import test from "node:test";

import {
  IndicatorDependencyGraphError,
  createIndicatorDependencyPlan,
} from "../dist/index.js";

function node(instanceId, outputKeys, bindings = {}) {
  return { instanceId, outputKeys, bindings };
}

test("cross-indicator bindings produce deterministic topological layers", () => {
  const plan = createIndicatorDependencyPlan([
    node("base-b", ["line"]),
    node("base-a", ["line"]),
    node("middle", ["value"], {
      source: { instanceId: "base-a", outputKey: "line" },
    }),
    node("leaf", ["signal"], {
      left: { instanceId: "middle", outputKey: "value" },
      right: { instanceId: "base-b", outputKey: "line" },
    }),
  ]);

  assert.deepEqual(plan.layers, [["base-b", "base-a"], ["middle"], ["leaf"]]);
  assert.deepEqual(plan.orderedInstanceIds, [
    "base-b",
    "base-a",
    "middle",
    "leaf",
  ]);
  assert.deepEqual(plan.bindingsByInstanceId.get("leaf"), [
    { inputKey: "left", instanceId: "middle", outputKey: "value" },
    { inputKey: "right", instanceId: "base-b", outputKey: "line" },
  ]);
});

test("dependency planning rejects a binding to an unknown instance or output", () => {
  assert.throws(
    () =>
      createIndicatorDependencyPlan([
        node("consumer", ["value"], {
          source: { instanceId: "missing", outputKey: "line" },
        }),
      ]),
    (error) =>
      error instanceof IndicatorDependencyGraphError &&
      error.code === "INDICATOR_DEPENDENCY_MISSING_INSTANCE",
  );

  assert.throws(
    () =>
      createIndicatorDependencyPlan([
        node("source", ["line"]),
        node("consumer", ["value"], {
          source: { instanceId: "source", outputKey: "missing" },
        }),
      ]),
    (error) =>
      error instanceof IndicatorDependencyGraphError &&
      error.code === "INDICATOR_DEPENDENCY_MISSING_OUTPUT",
  );
});

test("dependency planning rejects self-reference and multi-node cycles", () => {
  assert.throws(
    () =>
      createIndicatorDependencyPlan([
        node("self", ["line"], {
          source: { instanceId: "self", outputKey: "line" },
        }),
      ]),
    (error) =>
      error instanceof IndicatorDependencyGraphError &&
      error.code === "INDICATOR_DEPENDENCY_SELF_REFERENCE",
  );

  assert.throws(
    () =>
      createIndicatorDependencyPlan([
        node("a", ["line"], {
          source: { instanceId: "c", outputKey: "line" },
        }),
        node("b", ["line"], {
          source: { instanceId: "a", outputKey: "line" },
        }),
        node("c", ["line"], {
          source: { instanceId: "b", outputKey: "line" },
        }),
      ]),
    (error) =>
      error instanceof IndicatorDependencyGraphError &&
      error.code === "INDICATOR_DEPENDENCY_CYCLE",
  );
});

test("dependency planning rejects duplicate instance identities", () => {
  assert.throws(
    () =>
      createIndicatorDependencyPlan([
        node("duplicate", ["line"]),
        node("duplicate", ["other"]),
      ]),
    (error) =>
      error instanceof IndicatorDependencyGraphError &&
      error.code === "INDICATOR_DEPENDENCY_DUPLICATE_INSTANCE",
  );
});
