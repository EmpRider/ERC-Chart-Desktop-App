import assert from "node:assert/strict";
import test from "node:test";

import { isInstalledIndicatorDefinition } from "@erc-chart/contracts";
import { defineIndicator, plot } from "../dist/index.js";

const context = { instrumentId: "TEST", timeframeId: "1m" };

function candle(index, { high = 12 + index, low = 8 + index } = {}) {
  return {
    ...context,
    openTimeMs: index * 60_000,
    open: 10 + index,
    high,
    low,
    close: 11 + index,
    volume: 1,
  };
}

function shapeDefinition(overrides = {}) {
  return {
    id: "erc.indicator.shape-contract.main",
    name: "Shape contract",
    placement: "overlay",
    inputs: [],
    outputs: [{ key: "buy", label: "Buy" }],
    plots: [
      {
        key: "buy",
        outputKey: "buy",
        kind: "shape",
        shape: "label-up",
        location: "below-bar",
        text: "BUY",
        textColor: "#ffffff",
        textSize: "small",
        color: "#00aa00",
        ...overrides,
      },
    ],
    requiresLiveTicks: false,
  };
}

test("plot.shape carries v2 text metadata across history, building replacement, and finalization", () => {
  const plugin = defineIndicator(
    { id: "erc.indicator.shape-text.main", name: "Shape text" },
    () => {
      plot.shape(true, {
        title: "Buy",
        shape: "label-up",
        location: "below-bar",
        text: "BUY",
        textColor: "#ffffff",
        textSize: "small",
        color: "#00aa00",
      });
    },
  );

  assert.deepEqual(plugin.definition.plots[0], {
    key: "plot_0",
    outputKey: "plot_0",
    kind: "shape",
    label: "Buy",
    color: "#00aa00",
    shape: "label-up",
    location: "below-bar",
    text: "BUY",
    textColor: "#ffffff",
    textSize: "small",
  });

  const instance = plugin.createInstance({}, context);
  const first = candle(0, { low: 7 });
  const building = candle(1, { low: 9 });
  instance.onHistory([first, building]);
  assert.deepEqual(
    instance.snapshot().points.map((point) => point.values.plot_0),
    [7, 9],
  );

  const replacement = candle(1, { low: 5 });
  instance.onBuildingBar(replacement);
  assert.equal(instance.snapshot().points.at(-1).values.plot_0, 5);

  instance.onFinalizedBar(replacement);
  assert.deepEqual(
    instance.snapshot().points.map((point) => point.values.plot_0),
    [7, 5],
  );
  instance.dispose();
});

test("plot.shape supports text-only and marker-plus-text overloads including empty text", () => {
  const textOnly = defineIndicator(
    { id: "erc.indicator.shape-text-only.main", name: "Shape text only" },
    () => plot.shape(true, ""),
  );
  assert.equal(textOnly.definition.plots[0].text, "");

  const markerAndText = defineIndicator(
    {
      id: "erc.indicator.shape-marker-text.main",
      name: "Shape marker text",
    },
    () => plot.shape(true, "label-up", "BUY"),
  );
  assert.equal(markerAndText.definition.plots[0].shape, "label-up");
  assert.equal(markerAndText.definition.plots[0].text, "BUY");
});

test("installed shape metadata accepts the v2 contract and rejects malformed values", () => {
  assert.equal(isInstalledIndicatorDefinition(shapeDefinition()), true);
  assert.equal(
    isInstalledIndicatorDefinition(shapeDefinition({ text: "" })),
    true,
    "empty configured text is valid and renders no label text",
  );

  for (const overrides of [
    { text: "x".repeat(257) },
    { textColor: "" },
    { textSize: "huge" },
    { location: "sideways" },
    { shape: "starburst" },
  ]) {
    assert.equal(
      isInstalledIndicatorDefinition(shapeDefinition(overrides)),
      false,
      `invalid shape metadata was accepted: ${JSON.stringify(overrides)}`,
    );
  }
});
