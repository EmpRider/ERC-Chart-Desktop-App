import assert from "node:assert/strict";
import test from "node:test";
import { providerContractVersion, providerSdkVersion } from "../dist/index.js";

test("pins the provider authoring API to the provider contract", () => {
  assert.equal(providerSdkVersion, providerContractVersion);
  assert.equal(providerSdkVersion, 1);
});
