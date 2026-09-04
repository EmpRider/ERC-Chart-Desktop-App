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

test("Binomo provider is authored only against the public provider SDK", async () => {
  const source = await readFile(
    new URL("../../provider-examples/src/binomo-provider.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /@erc-chart\/provider-sdk/u);
  assert.doesNotMatch(
    source,
    /@erc-chart\/(?:contracts|provider-runtime|renderer|storage|data-service|electron-main)/u,
  );
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
});

test("aggregates derived 3m history from epoch-aligned 1m candles", async () => {
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
          created_at: "2026-09-03T12:01:00.000000Z",
        },
        {
          open: 101,
          high: 104,
          low: 100,
          close: 103,
          created_at: "2026-09-03T12:02:00.000000Z",
        },
        {
          open: 103,
          high: 105,
          low: 98,
          close: 102,
          created_at: "2026-09-03T12:03:00.000000Z",
        },
        {
          open: 102,
          high: 106,
          low: 101,
          close: 105,
          created_at: "2026-09-03T12:04:00.000000Z",
        },
        {
          open: 105,
          high: 107,
          low: 103,
          close: 104,
          created_at: "2026-09-03T12:05:00.000000Z",
        },
        {
          open: 104,
          high: 108,
          low: 102,
          close: 107,
          created_at: "2026-09-03T12:06:00.000000Z",
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

  const candles = await adapter.requestHistory({
    instrumentId: "Z-CRY/IDX",
    timeframeId: "3m",
    fromMs: Date.UTC(2026, 8, 3, 12, 0, 0),
    toMs: Date.UTC(2026, 8, 3, 12, 6, 0),
    limit: 2,
  });

  assert.equal(fixture.requests.length, 1);
  assert.equal(
    fixture.requests[0].url,
    "https://api.binomo.com/candles/v1/Z-CRY%2FIDX/2026-09-03T00:00:00/60?locale=en",
  );
  assert.deepEqual(candles, [
    {
      instrumentId: "Z-CRY/IDX",
      timeframeId: "3m",
      openTimeMs: Date.UTC(2026, 8, 3, 12, 0, 0),
      open: 100,
      high: 105,
      low: 98,
      close: 102,
    },
    {
      instrumentId: "Z-CRY/IDX",
      timeframeId: "3m",
      openTimeMs: Date.UTC(2026, 8, 3, 12, 3, 0),
      open: 102,
      high: 108,
      low: 101,
      close: 107,
    },
  ]);
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

test("authenticated Binomo websocket flow emits compressed live ticks and candle updates", async () => {
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
  assert.equal(candles.at(-1).openTimeMs, Date.UTC(2026, 8, 3, 12, 0, 0));
  assert.equal(candles.at(-1).open, 200);
  assert.equal(candles.at(-1).high, 205.5);
  assert.equal(candles.at(-1).low, 198);
  assert.equal(candles.at(-1).close, 205.5);

  await subscription.unsubscribe();
  await adapter.disconnect();
  assert.equal(assetStream.closed.length, 1);
  assert.equal(phoenix.closed.length, 1);
});

test("derived 2m websocket subscription seeds from 1m history and updates the target bucket", async () => {
  const { default: definition } =
    await import("../../provider-examples/dist/binomo-provider.js");
  const now = Date.UTC(2026, 8, 3, 12, 1, 30);
  const fixture = createWebSocketHost(
    [
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
    ],
    now,
  );
  const adapter = await definition.create(fixture.host, {
    symbol: "Z-CRY/IDX",
    pollIntervalMs: 60_000,
  });
  const candles = [];
  let subscription;

  await adapter.connect();
  try {
    subscription = await adapter.subscribe(
      { instrumentId: "Z-CRY/IDX", timeframeId: "2m" },
      {
        onCandles: (value) => candles.push(...value),
        onTicks: () => undefined,
        onError: (code) => assert.fail(`Unexpected provider error: ${code}`),
      },
    );
    const assetStream = fixture.sockets[1];
    const liveMessage = JSON.stringify({
      success: true,
      data: [
        {
          action: "assets",
          assets: [
            {
              ric: "Z-CRY/IDX",
              rate: "205.5",
              created_at: "2026-09-03T12:01:15.000Z",
            },
          ],
        },
      ],
    });
    assetStream.handlers.onMessage(deflateRawSync(Buffer.from(liveMessage)));
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(fixture.requests.length, 2);
    assert.match(fixture.requests[0].url, /\/60\?locale=en$/u);
    assert.equal(candles.at(-1).timeframeId, "2m");
    assert.equal(candles.at(-1).openTimeMs, Date.UTC(2026, 8, 3, 12, 0, 0));
    assert.equal(candles.at(-1).open, 200);
    assert.equal(candles.at(-1).high, 205.5);
    assert.equal(candles.at(-1).low, 198);
    assert.equal(candles.at(-1).close, 205.5);
  } finally {
    await subscription?.unsubscribe();
    await adapter.disconnect();
  }
  assert.equal(fixture.sockets[1].closed.length, 1);
});
