import assert from "node:assert/strict";
import test from "node:test";

import { reconcilePluginIndicators } from "../dist/plugin-indicators.js";

test("passes runtime point colors into KLineChart figure styles", async () => {
  let template;
  const module = {
    registerIndicator(value) {
      template = value;
    },
  };
  const chart = {
    getIndicators() {
      return [];
    },
    createIndicator() {
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
    id: "erc.indicator.test.dynamic-color",
    name: "Dynamic color",
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
  const summary = {
    pluginId: "erc.indicator.test",
    pluginName: "Test",
    version: "1.0.0",
    definition,
  };
  const indicator = {
    instanceId: "dynamic-color-instance",
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
      points: [
        {
          openTimeMs: candle.timestamp,
          values: { line: 11 },
          colors: { line: "#abcdef" },
          sizes: { line: 4 },
        },
      ],
      overlays: [],
      signals: [],
    }),
    "TEST",
    "1m",
  );

  assert.ok(template);
  const [row] = await template.calc([candle]);
  assert.equal(row.line, 11);
  const styles = template.figures[0].styles({
    data: { prev: null, current: row, next: null },
  });
  assert.equal(styles.color, "#abcdef");
  assert.equal(styles.size, 4);
  assert.equal(styles.lineCap, "round");
  assert.equal(styles.lineJoin, "round");
});
