import assert from "node:assert/strict";
import test from "node:test";

import { isInstalledIndicatorSummary } from "../dist/index.js";

const definition = {
  id: "erc.indicator.test.line",
  name: "Test line",
  placement: "overlay",
  inputs: [],
  outputs: [{ key: "line", label: "Line" }],
  plots: [
    {
      key: "line",
      kind: "line",
      outputKey: "line",
      color: "#111111",
      width: 2,
    },
  ],
  requiresLiveTicks: false,
};

function summary(runtimeEntryUrl, overrides = {}) {
  return {
    pluginId: "erc.indicator.test",
    pluginName: "Test indicator",
    version: "1.2.3-alpha.1+build.5",
    runtimeEntryUrl,
    definition,
    ...overrides,
  };
}

test("accepts only canonical erc-plugin runtime entry URLs for the installed plugin", () => {
  const valid =
    "erc-plugin://plugin/erc.indicator.test/1.2.3-alpha.1%2Bbuild.5/dist/index.js";
  assert.equal(isInstalledIndicatorSummary(summary(valid)), true);

  for (const invalid of [
    "erc-app://app/indicator-plugins/erc.indicator.test/1.2.3-alpha.1%2Bbuild.5/dist/index.js",
    "erc-plugin://other/erc.indicator.test/1.2.3-alpha.1%2Bbuild.5/dist/index.js",
    "erc-plugin://plugin/erc.indicator.other/1.2.3-alpha.1%2Bbuild.5/dist/index.js",
    "erc-plugin://plugin/erc.indicator.test/1.2.4/dist/index.js",
    "erc-plugin://plugin/erc.indicator.test/1.2.3-alpha.1%2Bbuild.5/plugin.json",
    "erc-plugin://plugin/erc.indicator.test/1.2.3-alpha.1%2Bbuild.5/dist/%2e%2e/plugin.json",
    `${valid}?cache=1`,
  ]) {
    assert.equal(isInstalledIndicatorSummary(summary(invalid)), false, invalid);
  }
});
