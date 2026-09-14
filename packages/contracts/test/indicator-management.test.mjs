import assert from "node:assert/strict";
import test from "node:test";

import * as indicatorContracts from "../dist/index.js";
import {
  isIndicatorRuntimeSnapshot,
  isInstalledIndicatorDefinition,
  isInstalledIndicatorSummary,
} from "../dist/index.js";

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

test("worker history snapshots use validated Float64Array columns and round-trip candles", () => {
  assert.equal(
    typeof indicatorContracts.createIndicatorWorkerCandleSnapshot,
    "function",
  );
  assert.equal(
    typeof indicatorContracts.isIndicatorWorkerCandleSnapshot,
    "function",
  );
  assert.equal(
    typeof indicatorContracts.materializeIndicatorWorkerCandleSnapshot,
    "function",
  );

  const candles = [
    {
      instrumentId: "TEST",
      timeframeId: "1m",
      openTimeMs: 60_000,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
      volume: 5,
    },
    {
      instrumentId: "TEST",
      timeframeId: "1m",
      openTimeMs: 120_000,
      open: 11,
      high: 13,
      low: 10,
      close: 12,
    },
  ];
  const snapshot =
    indicatorContracts.createIndicatorWorkerCandleSnapshot(candles);

  for (const key of ["openTimeMs", "open", "high", "low", "close", "volume"]) {
    assert.equal(snapshot[key] instanceof Float64Array, true, key);
  }
  assert.deepEqual([...snapshot.openTimeMs], [60_000, 120_000]);
  assert.deepEqual([...snapshot.close], [11, 12]);
  assert.equal(snapshot.volume[0], 5);
  assert.equal(Number.isNaN(snapshot.volume[1]), true);
  assert.equal(
    indicatorContracts.isIndicatorWorkerCandleSnapshot(snapshot),
    true,
  );
  assert.deepEqual(
    indicatorContracts.materializeIndicatorWorkerCandleSnapshot(
      snapshot,
      "TEST",
      "1m",
    ),
    candles,
  );
});

test("accepts only canonical erc-plugin runtime entry URLs for the installed plugin", () => {
  const revision = "a".repeat(64);
  const valid = `erc-plugin://plugin/erc.indicator.test/1.2.3-alpha.1%2Bbuild.5/dist/index.js?revision=${revision}`;
  assert.equal(isInstalledIndicatorSummary(summary(valid)), true);

  for (const invalid of [
    "erc-app://app/indicator-plugins/erc.indicator.test/1.2.3-alpha.1%2Bbuild.5/dist/index.js",
    "erc-plugin://other/erc.indicator.test/1.2.3-alpha.1%2Bbuild.5/dist/index.js",
    "erc-plugin://plugin/erc.indicator.other/1.2.3-alpha.1%2Bbuild.5/dist/index.js",
    "erc-plugin://plugin/erc.indicator.test/1.2.4/dist/index.js",
    "erc-plugin://plugin/erc.indicator.test/1.2.3-alpha.1%2Bbuild.5/plugin.json",
    "erc-plugin://plugin/erc.indicator.test/1.2.3-alpha.1%2Bbuild.5/dist/%2e%2e/plugin.json",
    "erc-plugin://plugin/erc.indicator.test/1.2.3-alpha.1%2Bbuild.5/dist/index.js",
    `${valid}&cache=1`,
    `${valid}&revision=${revision}`,
    `${valid}#fragment`,
  ]) {
    assert.equal(isInstalledIndicatorSummary(summary(invalid)), false, invalid);
  }
});

test("indicator timeframe input keys must reference declared timeframe inputs", () => {
  const timeframeInput = {
    key: "input_timeframe",
    label: "Timeframe",
    type: "string",
    defaultValue: "chart",
    editor: "timeframe",
  };
  const withSource = (inputs, inputKey) => ({
    ...definition,
    inputs,
    source: {
      timeframe: {
        requestedTimeframeId: "chart",
        inputKey,
      },
      taTimeframeIds: [],
    },
  });

  assert.equal(
    isInstalledIndicatorDefinition(
      withSource([timeframeInput], timeframeInput.key),
    ),
    true,
  );
  assert.equal(
    isInstalledIndicatorDefinition(withSource([timeframeInput], "missing")),
    false,
  );
  assert.equal(
    isInstalledIndicatorDefinition(
      withSource(
        [
          {
            ...timeframeInput,
            editor: "text",
          },
        ],
        timeframeInput.key,
      ),
    ),
    false,
  );
});

test("indicator candle type input keys must reference declared candle type inputs", () => {
  const candleInput = {
    key: "input_candle",
    label: "Candle Type",
    type: "string",
    defaultValue: "standard",
    editor: "candle-type",
    options: [
      { value: "standard", label: "Standard" },
      { value: "heikin-ashi", label: "Heikin Ashi" },
    ],
  };
  const withSource = (inputs, inputKey) => ({
    ...definition,
    inputs,
    source: {
      candleType: {
        requestedCandleType: "standard",
        inputKey,
      },
      taTimeframeIds: [],
    },
  });

  assert.equal(
    isInstalledIndicatorDefinition(withSource([candleInput], candleInput.key)),
    true,
  );
  assert.equal(
    isInstalledIndicatorDefinition(withSource([candleInput], "missing")),
    false,
  );
  assert.equal(
    isInstalledIndicatorDefinition(
      withSource([{ ...candleInput, editor: "text" }], candleInput.key),
    ),
    false,
  );
});

test("runtime signals validate source revision and synthetic provenance", () => {
  const source = {
    providerProfileId: "profile-a",
    instrumentId: "TEST",
    timeframeId: "1h",
    activeTimeframeId: "1h",
    openTimeMs: 0,
    generation: 7,
    revision: 11,
    provenance: { kind: "synthetic", candleType: "heikin-ashi" },
  };
  const snapshot = {
    points: [],
    overlays: [],
    signals: [
      {
        id: "signal:test",
        occurredAtMs: 0,
        direction: "long",
        finalized: true,
        sources: [source],
      },
    ],
  };
  assert.equal(isIndicatorRuntimeSnapshot(snapshot), true);
  assert.equal(
    isIndicatorRuntimeSnapshot({
      ...snapshot,
      signals: [
        {
          ...snapshot.signals[0],
          sources: [{ ...source, providerProfileId: "" }],
        },
      ],
    }),
    false,
  );
  assert.equal(
    isIndicatorRuntimeSnapshot({
      ...snapshot,
      signals: [
        { ...snapshot.signals[0], sources: [{ ...source, revision: -1 }] },
      ],
    }),
    false,
  );
  assert.equal(
    isIndicatorRuntimeSnapshot({
      ...snapshot,
      signals: [
        {
          ...snapshot.signals[0],
          sources: [
            {
              ...source,
              provenance: { kind: "market", candleType: "heikin-ashi" },
            },
          ],
        },
      ],
    }),
    false,
  );
});
