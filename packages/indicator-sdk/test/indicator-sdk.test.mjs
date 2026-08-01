import assert from "node:assert/strict";
import test from "node:test";
import {
  indicatorContractVersion,
  indicatorSdkVersion,
} from "../dist/index.js";

test("pins the indicator authoring API to the indicator contract", () => {
  assert.equal(indicatorSdkVersion, indicatorContractVersion);
  assert.equal(indicatorSdkVersion, 1);
});
