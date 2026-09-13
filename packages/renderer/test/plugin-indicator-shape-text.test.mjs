import assert from "node:assert/strict";
import test from "node:test";

import { reconcilePluginIndicators } from "../dist/plugin-indicators.js";

async function renderFigure(plotDefinition, runtimePoint) {
  let template;
  let runtimeId;
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators() {
      return [];
    },
    createIndicator(value) {
      runtimeId = value.id;
      return "candle_pane";
    },
    overrideIndicator() {
      return true;
    },
    removeIndicator() {
      return true;
    },
  };
  const definition = {
    id: "erc.indicator.test.shape-text",
    name: "Shape text",
    placement: "overlay",
    inputs: [],
    outputs: [{ key: "marker", label: "Marker" }],
    plots: [{ key: "marker", outputKey: "marker", kind: "shape", ...plotDefinition }],
    requiresLiveTicks: false,
  };
  const summary = {
    pluginId: "erc.indicator.shape-text-test",
    pluginName: "Shape text test",
    version: "1.0.0",
    definition,
  };
  const indicator = {
    instanceId: "shape-text-instance",
    pluginId: summary.pluginId,
    definitionId: definition.id,
    enabled: true,
    parameters: {},
    inputs: { source: { kind: "candles" } },
  };
  const candle = {
    timestamp: 1_900_000_000_000,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
  };

  reconcilePluginIndicators(
    module,
    chart,
    [indicator],
    [summary],
    async () => ({
      kind: "snapshot",
      snapshot: {
        points: [{ openTimeMs: candle.timestamp, ...runtimePoint }],
        overlays: [],
        signals: [],
      },
    }),
    "TEST",
    "1m",
  );

  assert.ok(template);
  assert.ok(runtimeId);
  const [row] = await template.calc([candle], { id: runtimeId });
  return { figure: template.figures[0], row };
}

test("maps configured shape text, text color, semantic size, and below-bar baseline", async () => {
  const { figure, row } = await renderFigure(
    {
      shape: "label-up",
      location: "below-bar",
      text: "BUY",
      textColor: "#ffffff",
      textSize: "small",
      color: "#00aa00",
    },
    { values: { marker: 9 }, colors: {}, sizes: {} },
  );

  assert.deepEqual(figure.attrs({ data: { prev: null, current: row, next: null } }), {
    text: "BUY",
    baseline: "top",
  });
  const styles = figure.styles({ data: { prev: null, current: row, next: null } });
  assert.equal(styles.color, "#ffffff");
  assert.equal(styles.size, 10);
});

test("preserves non-text shape glyph behavior and runtime color/size", async () => {
  const { figure, row } = await renderFigure(
    { direction: "down", color: "#111111", width: 2 },
    {
      values: { marker: 12 },
      colors: { marker: "#abcdef" },
      sizes: { marker: 4 },
    },
  );

  assert.equal(figure.attrs({ data: { prev: null, current: row, next: null } }).text, "▼");
  const styles = figure.styles({ data: { prev: null, current: row, next: null } });
  assert.equal(styles.color, "#abcdef");
  assert.equal(styles.size, 4);
});
