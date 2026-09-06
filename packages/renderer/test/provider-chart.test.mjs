import assert from "node:assert/strict";
import test from "node:test";
import { updateChartData } from "../dist/index.js";
import {
  applyProviderSeriesUpdate,
  applyProviderChartType,
  groupIndicatorSettingsFields,
  loadKLineHistoryPage,
  queueIndicatorSettingsDraftChange,
  toHeikinAshiData,
} from "../dist/provider-chart.js";

test("reloads authoritative canonical candles for rebuild series changes", () => {
  const updates = [];
  const resets = [];
  const chart = {
    getDataList: () => [
      { timestamp: 60_000, open: 1, high: 2, low: 0, close: 1 },
    ],
    resetData: () => resets.push(true),
  };
  const lastAppliedOpenTimeMs = { current: 60_000 };
  const authoritativeResetCandles = { current: undefined };
  const dataLoadGeneration = { current: 4 };
  const candles = [
    {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: 0,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
    },
    {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: 60_000,
      open: 11,
      high: 13,
      low: 10,
      close: 12,
    },
  ];

  applyProviderSeriesUpdate(
    chart,
    (data) => updates.push(data),
    candles,
    { generation: 2, revision: 8, kind: "rebuild", dirtyFromOpenTimeMs: 0 },
    "candlestick",
    lastAppliedOpenTimeMs,
    authoritativeResetCandles,
    dataLoadGeneration,
  );

  assert.deepEqual(updates, []);
  assert.deepEqual(resets, [true]);
  assert.deepEqual(authoritativeResetCandles.current, candles);
  assert.notEqual(authoritativeResetCandles.current, candles);
  assert.equal(lastAppliedOpenTimeMs.current, 60_000);
  assert.equal(dataLoadGeneration.current, 5);
});

test("groups indicator settings into Inputs and Style while preserving group order", () => {
  const fields = [
    {
      key: "length",
      label: "Length",
      group: "Core",
      type: "number",
      defaultValue: 14,
    },
    {
      key: "source",
      label: "Source",
      group: "Core",
      type: "string",
      defaultValue: "close",
      effect: "calculation",
    },
    {
      key: "lineColor",
      label: "Line color",
      group: "Display",
      type: "string",
      defaultValue: "#ffffff",
      effect: "presentation",
    },
    {
      key: "visible",
      label: "Visible",
      type: "boolean",
      defaultValue: true,
      effect: "presentation",
    },
  ];

  assert.deepEqual(
    groupIndicatorSettingsFields(fields, "inputs").map((group) => [
      group.name,
      group.fields.map((field) => field.key),
    ]),
    [["Core", ["length", "source"]]],
  );
  assert.deepEqual(
    groupIndicatorSettingsFields(fields, "style").map((group) => [
      group.name,
      group.fields.map((field) => field.key),
    ]),
    [
      ["Display", ["lineColor"]],
      ["Other", ["visible"]],
    ],
  );
});

test("captures indicator setting values before React releases the event target", () => {
  let queuedUpdate;
  let currentTarget = { value: "13" };
  const event = {
    get currentTarget() {
      return currentTarget;
    },
  };

  queueIndicatorSettingsDraftChange("length", event, (update) => {
    queuedUpdate = update;
  });

  currentTarget = null;
  assert.equal(typeof queuedUpdate, "function");
  assert.deepEqual(queuedUpdate({ length: "14" }), { length: "13" });
});

test("forwards live candles through the KLineCharts incremental bar callback", () => {
  const updates = [];
  updateChartData(
    (data) => updates.push(data),
    [
      {
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        openTimeMs: 1_800_000_000_000,
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
      },
      {
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        openTimeMs: 1_800_000_000_000,
        open: 100,
        high: 102,
        low: 99,
        close: 101.5,
        volume: 12,
      },
      {
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        openTimeMs: 1_800_000_060_000,
        open: 101.5,
        high: 103,
        low: 101,
        close: 102.5,
      },
    ],
  );

  assert.deepEqual(updates, [
    {
      timestamp: 1_800_000_000_000,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
    },
    {
      timestamp: 1_800_000_000_000,
      open: 100,
      high: 102,
      low: 99,
      close: 101.5,
      volume: 12,
    },
    {
      timestamp: 1_800_000_060_000,
      open: 101.5,
      high: 103,
      low: 101,
      close: 102.5,
    },
  ]);
});

test("transforms raw provider candles into Heikin-Ashi bars without mutating source data", () => {
  const candles = [
    {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: 60_000,
      open: 10,
      high: 14,
      low: 8,
      close: 12,
    },
    {
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      openTimeMs: 120_000,
      open: 12,
      high: 16,
      low: 11,
      close: 15,
      volume: 20,
    },
  ];

  const transformed = toHeikinAshiData(candles);

  assert.deepEqual(transformed, [
    {
      timestamp: 60_000,
      open: 11,
      high: 14,
      low: 8,
      close: 11,
    },
    {
      timestamp: 120_000,
      open: 11,
      high: 16,
      low: 11,
      close: 13.5,
      volume: 20,
    },
  ]);
  assert.equal(candles[0].open, 10);
});

test("feeds cached bars on init and pages older history through the provider bridge", async () => {
  const session = {
    profileId: "profile-a",
    providerId: "erc.provider.fixture",
    providerName: "Fixture",
    instrument: { id: "BTCUSD", symbol: "BTCUSD", name: "Bitcoin" },
    timeframeId: "1m",
    candles: [
      {
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        openTimeMs: 120_000,
        open: 2,
        high: 3,
        low: 1,
        close: 2.5,
      },
      {
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        openTimeMs: 180_000,
        open: 2.5,
        high: 4,
        low: 2,
        close: 3.5,
      },
    ],
  };
  const requests = [];
  const requestHistory = async (request) => {
    requests.push(request);
    return [
      {
        instrumentId: "BTCUSD",
        timeframeId: "1m",
        openTimeMs: 60_000,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
      },
    ];
  };

  const initial = await loadKLineHistoryPage(
    { type: "init", timestamp: null },
    session,
    requestHistory,
  );
  assert.equal(initial.data.length, 2);
  assert.deepEqual(initial.more, { forward: true, backward: false });
  assert.equal(requests.length, 0);

  const older = await loadKLineHistoryPage(
    { type: "forward", timestamp: 120_000 },
    session,
    requestHistory,
  );
  assert.deepEqual(requests, [
    {
      profileId: "profile-a",
      instrumentId: "BTCUSD",
      timeframeId: "1m",
      fromMs: 0,
      toMs: 119_999,
      limit: 500,
    },
  ]);
  assert.deepEqual(
    older.data.map(({ timestamp }) => timestamp),
    [60_000],
  );
  assert.deepEqual(older.more, { forward: false, backward: false });
});

test("maps persisted chart types to KLineCharts candle styles", () => {
  const styles = [];
  const chart = { setStyles: (value) => styles.push(value) };

  applyProviderChartType(chart, "candlestick");
  applyProviderChartType(chart, "heikin_ashi");
  applyProviderChartType(chart, "line");
  applyProviderChartType(chart, "area");

  assert.equal(styles[0].candle.type, "candle_solid");
  assert.equal(styles[1].candle.type, "candle_solid");
  assert.equal(styles[2].candle.type, "area");
  assert.equal(styles[2].candle.area.backgroundColor, "rgba(0, 0, 0, 0)");
  assert.equal(styles[3].candle.type, "area");
  assert.ok(Array.isArray(styles[3].candle.area.backgroundColor));
});
