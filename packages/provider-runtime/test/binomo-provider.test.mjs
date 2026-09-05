import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

const encoder = new TextEncoder();

function response(data, status = 200) {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: encoder.encode(JSON.stringify(data)),
  };
}

function createHost(responses, now = Date.UTC(2026, 8, 3, 12, 0, 0)) {
  const requests = [];
  const statuses = [];
  return {
    requests,
    statuses,
    host: {
      network: {
        async request(request) {
          requests.push(request);
          const next = responses.shift();
          if (next === undefined)
            throw new Error("Unexpected network request.");
          return next;
        },
      },
      credentials: { get: async () => null },
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      now: () => now,
      reportStatus: (status) => statuses.push(status),
    },
  };
}

function createWebSocketHost(responses, now = Date.UTC(2026, 8, 3, 12, 0, 0)) {
  const fixture = createHost(responses, now);
  const sockets = [];
  fixture.host.credentials = {
    async get(credentialKey) {
      assert.equal(credentialKey, "binomo_cookie");
      return "authtoken=test-token; device_type=web; device_id=test-device";
    },
  };
  fixture.host.websocket = {
    async connect(request, handlers) {
      const socket = {
        request,
        handlers,
        sent: [],
        closed: [],
      };
      sockets.push(socket);
      return {
        send(data) {
          socket.sent.push(data);
        },
        close(code = 1000, reason = "") {
          socket.closed.push({ code, reason });
          handlers.onClose({ code, reason });
        },
      };
    },
  };
  return { ...fixture, sockets };
}

test("ECDD-98 acceptance: Binomo provider uses only host services and requires no browser tab or hook", async () => {
  const source = await readFile(
    new URL("../../provider-examples/src/binomo-provider.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /@erc-chart\/provider-sdk/u);
  assert.doesNotMatch(
    source,
    /@erc-chart\/(?:contracts|provider-runtime|renderer|storage|data-service|electron-main)/u,
  );
  assert.doesNotMatch(
    source,
    /\b(?:BrowserWindow|webContents|executeJavaScript|document|window|chrome|browser)\b/u,
  );
  assert.doesNotMatch(source, /\b(?:fetch|WebSocket)\s*\(/u);
  assert.match(source, /host\.network/u);
  assert.match(source, /host\.websocket/u);
});

test("loads Binomo candles with the userscript timestamp and chunk semantics", async () => {
  const { default: definition } =
    await import("../../provider-examples/dist/binomo-provider.js");
  const fixture = createHost([
    response({
      data: [
        {
          open: 100,
          high: 102,
          low: 99,
          close: 101,
          created_at: "2026-09-03T11:59:00.000000Z",
        },
        {
          open: 101,
          high: 103,
          low: 100,
          close: 102,
          created_at: "2026-09-03T12:00:00.000000Z",
        },
      ],
      errors: [],
      success: true,
    }),
  ]);
  const adapter = await definition.create(fixture.host, {
    symbol: "Z-CRY/IDX",
    pollIntervalMs: 1000,
  });

  await adapter.connect();
  const instruments = await adapter.getInstruments();
  assert.deepEqual(instruments, [
    {
      id: "Z-CRY/IDX",
      symbol: "Z-CRY/IDX",
      name: "Z-CRY/IDX",
    },
  ]);
  const candles = await adapter.requestHistory({
    instrumentId: "Z-CRY/IDX",
    timeframeId: "1m",
    fromMs: Date.UTC(2026, 8, 3, 11, 58, 0),
    toMs: Date.UTC(2026, 8, 3, 12, 0, 0),
    limit: 10,
  });

  assert.equal(fixture.requests.length, 1);
  assert.equal(
    fixture.requests[0].url,
    "https://api.binomo.com/candles/v1/Z-CRY%2FIDX/2026-09-03T00:00:00/60?locale=en",
  );
  assert.deepEqual(candles, [
    {
      instrumentId: "Z-CRY/IDX",
      timeframeId: "1m",
      openTimeMs: Date.UTC(2026, 8, 3, 11, 58, 0),
      open: 100,
      high: 102,
      low: 99,
      close: 101,
    },
    {
      instrumentId: "Z-CRY/IDX",
      timeframeId: "1m",
      openTimeMs: Date.UTC(2026, 8, 3, 11, 59, 0),
      open: 101,
      high: 103,
      low: 100,
      close: 102,
    },
  ]);
  assert.deepEqual(fixture.statuses, ["connecting", "connected"]);
  await adapter.disconnect();
  assert.equal(fixture.statuses.at(-1), "disconnected");
});

test("advertises native and derived Binomo timeframes separately", async () => {
  const { default: definition } =
    await import("../../provider-examples/dist/binomo-provider.js");
  const fixture = createHost([]);
  const adapter = await definition.create(fixture.host, {
    symbol: "Z-CRY/IDX",
    pollIntervalMs: 1000,
  });

  const capabilities = await adapter.getCapabilities();

  assert.deepEqual(capabilities.nativeTimeframes, [
    "5s",
    "15s",
    "30s",
    "1m",
    "5m",
    "15m",
    "30m",
  ]);
  assert.equal(capabilities.derivedTimeframes, true);
  assert.deepEqual(capabilities.derivedTimeframeIds, ["2m", "3m"]);
  assert.deepEqual(
    capabilities.timeframes.map(
      ({ id, seconds, native, derivedFromTimeframeId, alignment }) => ({
        id,
        seconds,
        native,
        derivedFromTimeframeId,
        alignment,
      }),
    ),
    [
      ["5s", 5],
      ["15s", 15],
      ["30s", 30],
      ["1m", 60],
      ["5m", 300],
      ["15m", 900],
      ["30m", 1800],
    ]
      .map(([id, seconds]) => ({
        id,
        seconds,
        native: true,
        derivedFromTimeframeId: undefined,
        alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
      }))
      .concat([
        {
          id: "2m",
          seconds: 120,
          native: false,
          derivedFromTimeframeId: "1m",
          alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
        },
        {
          id: "3m",
          seconds: 180,
          native: false,
          derivedFromTimeframeId: "1m",
          alignment: { mode: "epoch", originMs: 0, timeZone: "UTC" },
        },
      ]),
  );
});

test("leaves derived history ownership to the data service", async () => {
  const { default: definition } =
    await import("../../provider-examples/dist/binomo-provider.js");
  const fixture = createHost([]);
  const adapter = await definition.create(fixture.host, {
    symbol: "Z-CRY/IDX",
    pollIntervalMs: 1000,
  });

  await assert.rejects(
    adapter.requestHistory({
      instrumentId: "Z-CRY/IDX",
      timeframeId: "3m",
      limit: 2,
    }),
    /Unsupported native Binomo timeframe/u,
  );
  assert.equal(fixture.requests.length, 0);
});

test("polling subscription emits the current Binomo candle and stops cleanly", async () => {
  const { default: definition } =
    await import("../../provider-examples/dist/binomo-provider.js");
  const fixture = createHost([
    response({
      data: [
        {
          open: 200,
          high: 204,
          low: 198,
          close: 203,
          created_at: "2026-09-03T12:00:00.000000Z",
        },
      ],
      errors: [],
      success: true,
    }),
  ]);
  const adapter = await definition.create(fixture.host, {
    symbol: "Z-CRY/IDX",
    pollIntervalMs: 60_000,
  });
  const received = [];

  await adapter.connect();
  const subscription = await adapter.subscribe(
    { instrumentId: "Z-CRY/IDX", timeframeId: "1m" },
    {
      onCandles: (candles) => received.push(...candles),
      onTicks: () => undefined,
      onError: (code) => assert.fail(`Unexpected provider error: ${code}`),
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  await subscription.unsubscribe();
  await adapter.disconnect();

  assert.equal(fixture.requests.length, 1);
  assert.equal(received.length, 1);
  assert.equal(received[0].openTimeMs, Date.UTC(2026, 8, 3, 11, 59, 0));
  assert.equal(received[0].close, 203);
});

test("polling subscription drops an in-flight candle after unsubscribe", async () => {
  const { default: definition } =
    await import("../../provider-examples/dist/binomo-provider.js");
  let resolveRequest;
  const fixture = createHost([]);
  fixture.host.network.request = async (request) => {
    fixture.requests.push(request);
    return new Promise((resolve) => {
      resolveRequest = resolve;
    });
  };
  const adapter = await definition.create(fixture.host, {
    symbol: "Z-CRY/IDX",
    pollIntervalMs: 60_000,
  });
  const received = [];
  const errors = [];

  await adapter.connect();
  const subscription = await adapter.subscribe(
    { instrumentId: "Z-CRY/IDX", timeframeId: "1m" },
    {
      onCandles: (candles) => received.push(...candles),
      onTicks: () => undefined,
      onError: (code) => errors.push(code),
    },
  );
  await subscription.unsubscribe();
  assert.equal(typeof resolveRequest, "function");
  resolveRequest(
    response({
      data: [
        {
          open: 200,
          high: 204,
          low: 199,
          close: 203,
          created_at: "2026-09-03T12:00:00.000000Z",
        },
      ],
      errors: [],
      success: true,
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  await adapter.disconnect();

  assert.deepEqual(received, []);
  assert.deepEqual(errors, []);
});

test("authenticated Binomo websocket flow emits compressed live ticks without building candles", async () => {
  const { default: definition } =
    await import("../../provider-examples/dist/binomo-provider.js");
  const fixture = createWebSocketHost([
    response({
      data: [
        {
          open: 200,
          high: 204,
          low: 198,
          close: 203,
          created_at: "2026-09-03T12:01:00.000000Z",
        },
      ],
      errors: [],
      success: true,
    }),
  ]);
  const adapter = await definition.create(fixture.host, {
    symbol: "Z-CRY/IDX",
    pollIntervalMs: 60_000,
  });
  const candles = [];
  const ticks = [];
  const errors = [];

  await adapter.connect();
  assert.equal(fixture.sockets.length, 1);
  const phoenix = fixture.sockets[0];
  assert.equal(phoenix.request.url, "wss://ws.binomo.com/?v=2&vsn=2.0.0");
  assert.match(phoenix.request.headers.Cookie, /authtoken=test-token/u);
  assert.ok(
    phoenix.sent.some((message) =>
      message.includes('"topic":"asset:Z-CRY/IDX"'),
    ),
  );

  const subscription = await adapter.subscribe(
    { instrumentId: "Z-CRY/IDX", timeframeId: "1m" },
    {
      onCandles: (value) => candles.push(...value),
      onTicks: (value) => ticks.push(...value),
      onError: (code) => errors.push(code),
    },
  );
  assert.equal(fixture.sockets.length, 2);
  const assetStream = fixture.sockets[1];
  assert.equal(assetStream.request.url, "wss://as.binomo.com/");
  assert.deepEqual(
    assetStream.sent.map((message) => JSON.parse(message)),
    [
      { action: "subscribe", rics: ["Z-CRY/IDX"] },
      { action: "subscribe", event_type: "reconnect_request" },
    ],
  );

  const liveMessage = JSON.stringify({
    success: true,
    data: [
      {
        action: "assets",
        assets: [
          {
            ric: "Z-CRY/IDX",
            rate: "205.5",
            created_at: "2026-09-03T12:00:15.000Z",
          },
        ],
      },
    ],
  });
  assetStream.handlers.onMessage(deflateRawSync(Buffer.from(liveMessage)));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(errors, []);
  assert.deepEqual(ticks, [
    {
      instrumentId: "Z-CRY/IDX",
      timestampMs: Date.UTC(2026, 8, 3, 12, 0, 15),
      price: 205.5,
    },
  ]);
  assert.equal(candles.length, 1);
  assert.equal(candles[0].openTimeMs, Date.UTC(2026, 8, 3, 12, 0, 0));
  assert.equal(candles[0].close, 203);

  await subscription.unsubscribe();
  await adapter.disconnect();
  assert.equal(assetStream.closed.length, 1);
  assert.equal(phoenix.closed.length, 1);
});

test("Binomo websocket reconnects with backoff and resubscribes after an unexpected close", async () => {
  const { default: definition } =
    await import("../../provider-examples/dist/binomo-provider.js");
  const fixture = createWebSocketHost([
    response({
      data: [
        {
          open: 200,
          high: 204,
          low: 198,
          close: 203,
          created_at: "2026-09-03T12:01:00.000000Z",
        },
      ],
      errors: [],
      success: true,
    }),
    response({ data: [], errors: [], success: true }),
  ]);
  const adapter = await definition.create(fixture.host, {
    symbol: "Z-CRY/IDX",
    pollIntervalMs: 60_000,
  });
  const errors = [];

  await adapter.connect();
  const subscription = await adapter.subscribe(
    { instrumentId: "Z-CRY/IDX", timeframeId: "1m" },
    {
      onCandles: () => undefined,
      onTicks: () => undefined,
      onError: (code) => errors.push(code),
    },
  );
  const firstAssetStream = fixture.sockets[1];
  firstAssetStream.handlers.onClose({ code: 1006, reason: "network lost" });

  await new Promise((resolve) => setTimeout(resolve, 320));

  assert.equal(fixture.sockets.length, 3);
  const reconnected = fixture.sockets[2];
  assert.equal(reconnected.request.url, "wss://as.binomo.com/");
  assert.deepEqual(
    reconnected.sent.map((message) => JSON.parse(message)),
    [
      { action: "subscribe", rics: ["Z-CRY/IDX"] },
      { action: "subscribe", event_type: "reconnect_request" },
    ],
  );
  assert.ok(errors.includes("BINOMO_WEBSOCKET_CLOSED"));
  assert.ok(fixture.statuses.includes("reconnecting"));
  assert.equal(fixture.statuses.at(-1), "connected");

  await subscription.unsubscribe();
  await adapter.disconnect();
});

test("Binomo authentication close is surfaced without reconnecting with the same credential", async () => {
  const { default: definition } =
    await import("../../provider-examples/dist/binomo-provider.js");
  const fixture = createWebSocketHost([
    response({ data: [], errors: [], success: true }),
    response({ data: [], errors: [], success: true }),
  ]);
  const adapter = await definition.create(fixture.host, {
    symbol: "Z-CRY/IDX",
    pollIntervalMs: 60_000,
  });
  const errors = [];

  await adapter.connect();
  const subscription = await adapter.subscribe(
    { instrumentId: "Z-CRY/IDX", timeframeId: "1m" },
    {
      onCandles: () => undefined,
      onTicks: () => undefined,
      onError: (code) => errors.push(code),
    },
  );
  fixture.sockets[1].handlers.onClose({ code: 4401, reason: "unauthorized" });
  await new Promise((resolve) => setTimeout(resolve, 320));

  assert.deepEqual(errors, ["BINOMO_AUTHENTICATION_FAILED"]);
  assert.equal(fixture.sockets.length, 2);
  assert.equal(fixture.statuses.at(-1), "degraded");

  await subscription.unsubscribe();
  await adapter.disconnect();
});

test("leaves derived live subscription ownership to the data service", async () => {
  const { default: definition } =
    await import("../../provider-examples/dist/binomo-provider.js");
  const fixture = createHost([]);
  const adapter = await definition.create(fixture.host, {
    symbol: "Z-CRY/IDX",
    pollIntervalMs: 60_000,
  });

  await assert.rejects(
    adapter.subscribe(
      { instrumentId: "Z-CRY/IDX", timeframeId: "2m" },
      {
        onCandles: () => undefined,
        onTicks: () => undefined,
        onError: () => undefined,
      },
    ),
    /Unsupported native Binomo timeframe/u,
  );
});
