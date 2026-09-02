import assert from "node:assert/strict";
import test from "node:test";
import { restrictProviderRuntimeGlobals } from "../dist/provider-global-isolation.js";

test("removes implicit host globals from the provider execution realm", () => {
  const target = {
    process: { env: { ERC_HOST_SECRET: "must-not-leak" } },
    fetch: () => undefined,
    WebSocket: function WebSocket() {
      return undefined;
    },
    EventSource: function EventSource() {
      return undefined;
    },
    localStorage: { secret: "host-storage" },
    sessionStorage: { secret: "session-storage" },
    require: () => undefined,
    module: { exports: {} },
  };

  restrictProviderRuntimeGlobals(target);

  for (const key of Object.keys(target)) {
    assert.equal(target[key], undefined);
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    assert.equal(descriptor?.writable, false);
    assert.equal(descriptor?.configurable, false);
  }
  assert.throws(
    () => Object.defineProperty(target, "process", { value: { env: {} } }),
    TypeError,
  );
});
