import {
  config,
  defineProvider,
  hostApiVersion,
  providerSdkVersion,
  type Candle,
  type InstrumentId,
  type ProviderAdapter,
  type ProviderConfiguration,
  type ProviderDataSink,
  type ProviderDefinition,
  type ProviderHistoryRequest,
  type ProviderHostServices,
  type ProviderId,
  type ProviderSubscription,
  type ProviderSubscriptionRequest,
  type ProviderWebSocketConnection,
  type ProviderWebSocketData,
  type Tick,
  type TimeframeId,
} from "@erc-chart/provider-sdk";

const providerId = "erc.provider.binomo" as ProviderId;
const defaultSymbol = "Z-CRY/IDX";
const apiEndpoint = "https://api.binomo.com/candles/v1";
const assetStreamEndpoint = "wss://as.binomo.com/";
const phoenixEndpoint = "wss://ws.binomo.com/?v=2&vsn=2.0.0";
const binomoCookieCredentialKey = "binomo_cookie";
const browserUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0";
const maximumHistoryBatches = 64;
const retryAttempts = 3;
const retryBaseDelayMs = 250;

const nativeTimeframeSeconds: Readonly<Record<string, number>> = Object.freeze({
  "5s": 5,
  "15s": 15,
  "30s": 30,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
});

const derivedTimeframes: Readonly<
  Record<
    string,
    { readonly seconds: number; readonly baseTimeframeId: TimeframeId }
  >
> = Object.freeze({
  "2m": { seconds: 120, baseTimeframeId: "1m" as TimeframeId },
  "3m": { seconds: 180, baseTimeframeId: "1m" as TimeframeId },
});

const nativeTimeframeIds = Object.keys(nativeTimeframeSeconds) as TimeframeId[];
const derivedTimeframeIds = Object.keys(derivedTimeframes) as TimeframeId[];

const chunkMilliseconds: Readonly<Record<number, number>> = Object.freeze({
  5: 60 * 60 * 1000,
  15: 4 * 60 * 60 * 1000,
  30: 12 * 60 * 60 * 1000,
  60: 24 * 60 * 60 * 1000,
  300: 4 * 24 * 60 * 60 * 1000,
  900: 12 * 24 * 60 * 60 * 1000,
  1800: 24 * 24 * 60 * 60 * 1000,
});

interface BinomoCandlePayload {
  readonly open: number | string;
  readonly high: number | string;
  readonly low: number | string;
  readonly close: number | string;
  readonly created_at: string;
}

interface ActiveBinomoSubscription {
  cancelled: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  socket: ProviderWebSocketConnection | undefined;
}

interface BinomoAssetTickPayload {
  readonly rate?: number | string;
  readonly created_at?: string;
  readonly ric?: string;
}

interface BinomoAssetMessageItem {
  readonly action?: string;
  readonly assets?: readonly BinomoAssetTickPayload[];
}

interface BinomoAssetMessage {
  readonly success?: boolean;
  readonly data?: readonly BinomoAssetMessageItem[];
}

function requireStringSetting(
  settings: ProviderConfiguration,
  key: string,
  fallback: string,
): string {
  const value = settings[key];
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function requireNumberSetting(
  settings: ProviderConfiguration,
  key: string,
  fallback: number,
): number {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function secondsForTimeframe(timeframeId: TimeframeId): number {
  const seconds =
    nativeTimeframeSeconds[timeframeId] ??
    derivedTimeframes[timeframeId]?.seconds;
  if (seconds === undefined) {
    throw new RangeError(`Unsupported Binomo timeframe: ${timeframeId}.`);
  }
  return seconds;
}

function aggregateCandles(
  baseCandles: readonly Candle[],
  instrumentId: InstrumentId,
  timeframeId: TimeframeId,
  seconds: number,
): readonly Candle[] {
  const timeframeMs = seconds * 1000;
  const buckets = new Map<number, Candle>();
  const sorted = [...baseCandles].sort(
    (left, right) => left.openTimeMs - right.openTimeMs,
  );
  for (const candle of sorted) {
    const openTimeMs =
      Math.floor(candle.openTimeMs / timeframeMs) * timeframeMs;
    const current = buckets.get(openTimeMs);
    if (current === undefined) {
      buckets.set(openTimeMs, {
        instrumentId,
        timeframeId,
        openTimeMs,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        ...(candle.volume === undefined ? {} : { volume: candle.volume }),
      });
      continue;
    }
    buckets.set(openTimeMs, {
      ...current,
      high: Math.max(current.high, candle.high),
      low: Math.min(current.low, candle.low),
      close: candle.close,
      ...(current.volume === undefined || candle.volume === undefined
        ? {}
        : { volume: current.volume + candle.volume }),
    });
  }
  return [...buckets.values()].sort(
    (left, right) => left.openTimeMs - right.openTimeMs,
  );
}

function chunkMsForTimeframe(seconds: number): number {
  return chunkMilliseconds[seconds] ?? 24 * 60 * 60 * 1000;
}

function formatApiTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString().replace(/\.\d{3}Z$/u, "");
}

function buildHistoryUrl(
  symbol: string,
  seconds: number,
  cursorMs: number,
): string {
  return `${apiEndpoint}/${encodeURIComponent(symbol)}/${formatApiTimestamp(cursorMs)}/${seconds}?locale=en`;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function websocketHeaders(cookie: string): Readonly<Record<string, string>> {
  return Object.freeze({
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    "User-Agent": browserUserAgent,
    Origin: "https://binomo.com",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: cookie,
  });
}

async function inflateRawWebSocketData(
  data: Uint8Array,
): Promise<string | undefined> {
  if (typeof DecompressionStream !== "function") return undefined;
  try {
    const decompressor = new DecompressionStream("deflate-raw");
    const writer = decompressor.writable.getWriter();
    await writer.write(Uint8Array.from(data));
    await writer.close();
    const reader = decompressor.readable.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      byteLength += result.value.byteLength;
      if (byteLength > 2_000_000) return undefined;
      chunks.push(result.value);
    }
    const combined = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(combined);
  } catch {
    return undefined;
  }
}

async function decodeWebSocketData(
  data: ProviderWebSocketData,
): Promise<string | undefined> {
  if (typeof data === "string") return data;
  const plain = new TextDecoder().decode(data);
  const trimmed = plain.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return plain;
  return inflateRawWebSocketData(data);
}

function parseAssetTicks(
  messageData: string,
  instrumentId: InstrumentId,
  symbol: string,
): readonly Tick[] {
  if (
    !messageData.includes('"success"') ||
    !messageData.includes('"data"') ||
    !messageData.includes('"assets"') ||
    !messageData.includes('"rate"') ||
    !messageData.includes('"created_at"')
  ) {
    return [];
  }
  let message: BinomoAssetMessage;
  try {
    const parsed: unknown = JSON.parse(messageData);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return [];
    }
    message = parsed as BinomoAssetMessage;
  } catch {
    return [];
  }
  if (message.success !== true || !Array.isArray(message.data)) return [];
  const ticks: Tick[] = [];
  for (const item of message.data) {
    if (item.action !== "assets" || !Array.isArray(item.assets)) continue;
    for (const asset of item.assets) {
      if (asset.ric !== undefined && asset.ric !== symbol) continue;
      const price = Number(asset.rate);
      const timestampMs =
        typeof asset.created_at === "string"
          ? Date.parse(asset.created_at)
          : Number.NaN;
      if (!Number.isFinite(price) || !Number.isSafeInteger(timestampMs))
        continue;
      ticks.push({ instrumentId, timestampMs, price });
    }
  }
  return ticks;
}

function updateCandleFromTick(
  current: Candle | undefined,
  tick: Tick,
  timeframeId: TimeframeId,
  seconds: number,
): Candle {
  const timeframeMs = seconds * 1000;
  const openTimeMs = Math.floor(tick.timestampMs / timeframeMs) * timeframeMs;
  if (current === undefined || current.openTimeMs !== openTimeMs) {
    return {
      instrumentId: tick.instrumentId,
      timeframeId,
      openTimeMs,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
    };
  }
  return {
    ...current,
    high: Math.max(current.high, tick.price),
    low: Math.min(current.low, tick.price),
    close: tick.price,
  };
}

function parsePayload(body: Uint8Array): readonly BinomoCandlePayload[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch (error) {
    throw new Error("Binomo returned malformed candle JSON.", { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Binomo returned an invalid candle response.");
  }
  const data = (parsed as { readonly data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error("Binomo candle response is missing its data array.");
  }
  return data.filter((item): item is BinomoCandlePayload => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return false;
    }
    const candle = item as Partial<BinomoCandlePayload>;
    return (
      (typeof candle.open === "number" || typeof candle.open === "string") &&
      (typeof candle.high === "number" || typeof candle.high === "string") &&
      (typeof candle.low === "number" || typeof candle.low === "string") &&
      (typeof candle.close === "number" || typeof candle.close === "string") &&
      typeof candle.created_at === "string"
    );
  });
}

function normalizeCandle(
  payload: BinomoCandlePayload,
  instrumentId: InstrumentId,
  timeframeId: TimeframeId,
  seconds: number,
): Candle | undefined {
  const closingMs = Date.parse(payload.created_at);
  const open = Number(payload.open);
  const high = Number(payload.high);
  const low = Number(payload.low);
  const close = Number(payload.close);
  if (
    !Number.isFinite(closingMs) ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    high < open ||
    high < close ||
    low > open ||
    low > close
  ) {
    return undefined;
  }
  return {
    instrumentId,
    timeframeId,
    openTimeMs: closingMs - seconds * 1000,
    open,
    high,
    low,
    close,
  };
}

async function requestChunk(
  host: ProviderHostServices,
  url: string,
): Promise<readonly BinomoCandlePayload[]> {
  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    const response = await host.network.request({ url, method: "GET" });
    lastStatus = response.status;
    if (response.status >= 200 && response.status < 300) {
      return parsePayload(response.body);
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable) break;
    if (attempt < retryAttempts) {
      await sleep(retryBaseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw new Error(`Binomo candle request failed with HTTP ${lastStatus ?? 0}.`);
}

function createBinomoAdapter(
  host: ProviderHostServices,
  settings: ProviderConfiguration,
): ProviderAdapter {
  const symbol = requireStringSetting(settings, "symbol", defaultSymbol);
  const instrumentId = symbol as InstrumentId;
  const pollIntervalMs = Math.max(
    250,
    Math.min(60_000, requireNumberSetting(settings, "pollIntervalMs", 1000)),
  );
  const activeSubscriptions = new Set<ActiveBinomoSubscription>();
  let sessionCookie: string | null = null;
  let phoenixSocket: ProviderWebSocketConnection | undefined;
  let phoenixPingTimer: ReturnType<typeof setTimeout> | undefined;

  const requestNativeHistory = async (
    timeframeId: TimeframeId,
    seconds: number,
    fromMs: number,
    toMs: number,
    requestedLimit: number,
  ): Promise<readonly Candle[]> => {
    const chunkMs = chunkMsForTimeframe(seconds);
    const candles = new Map<number, Candle>();
    let cursor = Math.floor(toMs / chunkMs) * chunkMs;

    for (let batch = 0; batch < maximumHistoryBatches; batch += 1) {
      const payload = await requestChunk(
        host,
        buildHistoryUrl(symbol, seconds, cursor),
      );
      if (payload.length === 0) break;
      let oldestOpenMs = Number.POSITIVE_INFINITY;
      for (const item of payload) {
        const candle = normalizeCandle(
          item,
          instrumentId,
          timeframeId,
          seconds,
        );
        if (candle === undefined) continue;
        oldestOpenMs = Math.min(oldestOpenMs, candle.openTimeMs);
        if (candle.openTimeMs >= fromMs && candle.openTimeMs <= toMs) {
          candles.set(candle.openTimeMs, candle);
        }
      }
      if (
        oldestOpenMs <= fromMs ||
        candles.size >= requestedLimit ||
        !Number.isFinite(oldestOpenMs)
      ) {
        break;
      }
      const nextCursor = Math.floor(oldestOpenMs / chunkMs) * chunkMs - chunkMs;
      if (nextCursor >= cursor) break;
      cursor = nextCursor;
    }

    return [...candles.values()]
      .sort((left, right) => left.openTimeMs - right.openTimeMs)
      .slice(-requestedLimit);
  };

  const requestHistory = async (
    request: ProviderHistoryRequest,
  ): Promise<readonly Candle[]> => {
    if (request.instrumentId !== instrumentId) return [];
    const seconds = secondsForTimeframe(request.timeframeId);
    const toMs = request.toMs ?? host.now();
    const requestedLimit = Math.max(1, Math.min(request.limit ?? 1000, 10_000));
    const fromMs =
      request.fromMs ?? Math.max(0, toMs - requestedLimit * seconds * 1000);
    const derived = derivedTimeframes[request.timeframeId];
    if (derived === undefined) {
      return requestNativeHistory(
        request.timeframeId,
        seconds,
        fromMs,
        toMs,
        requestedLimit,
      );
    }

    const baseSeconds = secondsForTimeframe(derived.baseTimeframeId);
    const targetMs = seconds * 1000;
    const alignedFromMs = Math.floor(fromMs / targetMs) * targetMs;
    const baseCandles = await requestNativeHistory(
      derived.baseTimeframeId,
      baseSeconds,
      alignedFromMs,
      toMs,
      Math.min(
        10_000,
        requestedLimit * Math.ceil(seconds / baseSeconds) +
          Math.ceil(seconds / baseSeconds),
      ),
    );
    return aggregateCandles(
      baseCandles,
      instrumentId,
      request.timeframeId,
      seconds,
    )
      .filter(
        (candle) => candle.openTimeMs >= fromMs && candle.openTimeMs <= toMs,
      )
      .slice(-requestedLimit);
  };

  const subscribe = async (
    request: ProviderSubscriptionRequest,
    sink: ProviderDataSink,
  ): Promise<ProviderSubscription> => {
    if (request.instrumentId !== instrumentId) {
      throw new RangeError("Binomo instrument is unavailable.");
    }
    const seconds = secondsForTimeframe(request.timeframeId);
    const state: ActiveBinomoSubscription = {
      cancelled: false,
      timer: undefined,
      socket: undefined,
    };
    activeSubscriptions.add(state);
    let lastFingerprint = "";
    let currentCandle: Candle | undefined;

    const poll = async (): Promise<void> => {
      if (state.cancelled) return;
      try {
        const now = host.now();
        const candles = await requestHistory({
          instrumentId,
          timeframeId: request.timeframeId,
          fromMs: Math.max(0, now - seconds * 3000),
          toMs: now,
          limit: 1,
        });
        if (state.cancelled) return;
        const latest = candles.at(-1);
        if (latest !== undefined) {
          const fingerprint = `${latest.openTimeMs}:${latest.open}:${latest.high}:${latest.low}:${latest.close}`;
          if (fingerprint !== lastFingerprint) {
            lastFingerprint = fingerprint;
            sink.onCandles([latest]);
          }
        }
      } catch {
        if (!state.cancelled) sink.onError("BINOMO_POLL_FAILED");
      } finally {
        if (!state.cancelled) {
          state.timer = setTimeout(() => void poll(), pollIntervalMs);
        }
      }
    };

    const startPollingFallback = (): void => {
      if (state.cancelled || state.timer !== undefined) return;
      void poll();
    };

    const handleAssetMessage = async (
      data: ProviderWebSocketData,
    ): Promise<void> => {
      if (state.cancelled) return;
      const messageData = await decodeWebSocketData(data);
      if (messageData === undefined || state.cancelled) return;
      const ticks = parseAssetTicks(messageData, instrumentId, symbol);
      if (ticks.length === 0) return;
      sink.onTicks(ticks);
      const updates: Candle[] = [];
      for (const tick of ticks) {
        currentCandle = updateCandleFromTick(
          currentCandle,
          tick,
          request.timeframeId,
          seconds,
        );
        updates.push(currentCandle);
      }
      sink.onCandles(updates);
    };

    if (host.websocket !== undefined && sessionCookie !== null) {
      try {
        const seed = await requestHistory({
          instrumentId,
          timeframeId: request.timeframeId,
          fromMs: Math.max(0, host.now() - seconds * 3000),
          toMs: host.now(),
          limit: 1,
        });
        currentCandle = seed.at(-1);
        if (currentCandle !== undefined) sink.onCandles([currentCandle]);

        const socket = await host.websocket.connect(
          {
            url: assetStreamEndpoint,
            headers: websocketHeaders(sessionCookie),
          },
          {
            onMessage: (data): void => {
              void handleAssetMessage(data);
            },
            onError: (): void => {
              if (!state.cancelled) sink.onError("BINOMO_WEBSOCKET_ERROR");
            },
            onClose: (): void => {
              state.socket = undefined;
              if (state.cancelled) return;
              sink.onError("BINOMO_WEBSOCKET_CLOSED");
              startPollingFallback();
            },
          },
        );
        if (state.cancelled) {
          socket.close(1000, "Subscription cancelled");
        } else {
          state.socket = socket;
          socket.send(JSON.stringify({ action: "subscribe", rics: [symbol] }));
          socket.send(
            JSON.stringify({
              action: "subscribe",
              event_type: "reconnect_request",
            }),
          );
        }
      } catch {
        if (!state.cancelled) {
          sink.onError("BINOMO_WEBSOCKET_CONNECT_FAILED");
          startPollingFallback();
        }
      }
    } else {
      startPollingFallback();
    }

    return {
      unsubscribe: async (): Promise<void> => {
        if (state.cancelled) return;
        state.cancelled = true;
        if (state.timer !== undefined) clearTimeout(state.timer);
        state.socket?.close(1000, "Subscription cancelled");
        state.socket = undefined;
        activeSubscriptions.delete(state);
      },
    };
  };

  return {
    connect: async (): Promise<void> => {
      host.reportStatus("connecting");
      try {
        sessionCookie = await host.credentials.get(binomoCookieCredentialKey);
      } catch {
        sessionCookie = null;
        host.logger.warn("BINOMO_CREDENTIAL_UNAVAILABLE");
      }
      if (sessionCookie !== null && host.websocket !== undefined) {
        try {
          const socket = await host.websocket.connect(
            {
              url: phoenixEndpoint,
              headers: websocketHeaders(sessionCookie),
            },
            {
              onMessage: (): void => undefined,
              onError: (): void =>
                host.logger.warn("BINOMO_PHOENIX_SOCKET_ERROR"),
              onClose: (): void => {
                phoenixSocket = undefined;
                if (phoenixPingTimer !== undefined) {
                  clearTimeout(phoenixPingTimer);
                  phoenixPingTimer = undefined;
                }
              },
            },
          );
          phoenixSocket = socket;
          const joins = [
            {
              topic: "connection",
              event: "phx_join",
              payload: {},
              ref: "6",
              join_ref: "6",
            },
            {
              topic: "bo",
              event: "phx_join",
              payload: {},
              ref: "9",
              join_ref: "9",
            },
            {
              topic: "user",
              event: "phx_join",
              payload: {},
              ref: "12",
              join_ref: "12",
            },
            {
              topic: "tournament",
              event: "phx_join",
              payload: {},
              ref: "18",
              join_ref: "18",
            },
            {
              topic: "cfd_zero_spread",
              event: "phx_join",
              payload: {},
              ref: "25",
              join_ref: "25",
            },
            {
              topic: "asset",
              event: "phx_join",
              payload: {},
              ref: "28",
              join_ref: "28",
            },
            {
              topic: "copy_trading",
              event: "phx_join",
              payload: {},
              ref: "32",
              join_ref: "32",
            },
            {
              topic: `asset:${symbol}`,
              event: "phx_join",
              payload: {},
              ref: "35",
              join_ref: "35",
            },
          ] as const;
          for (const join of joins) socket.send(JSON.stringify(join));
          const schedulePing = (): void => {
            phoenixPingTimer = setTimeout(() => {
              if (phoenixSocket !== socket) return;
              socket.send(
                JSON.stringify({
                  topic: "connection",
                  event: "ping",
                  payload: {},
                  ref: String(host.now()),
                  join_ref: "6",
                }),
              );
              schedulePing();
            }, 25_000);
          };
          schedulePing();
        } catch {
          phoenixSocket = undefined;
          host.logger.warn("BINOMO_PHOENIX_CONNECT_FAILED");
        }
      }
      host.reportStatus("connected");
    },
    disconnect: async (): Promise<void> => {
      for (const state of activeSubscriptions) {
        state.cancelled = true;
        if (state.timer !== undefined) clearTimeout(state.timer);
        state.socket?.close(1000, "Provider disconnected");
      }
      activeSubscriptions.clear();
      if (phoenixPingTimer !== undefined) clearTimeout(phoenixPingTimer);
      phoenixPingTimer = undefined;
      phoenixSocket?.close(1000, "Provider disconnected");
      phoenixSocket = undefined;
      sessionCookie = null;
      host.reportStatus("disconnected");
    },
    getCapabilities: async () => ({
      instruments: true,
      nativeTimeframes: nativeTimeframeIds,
      liveData: true,
      derivedTimeframes: true,
      derivedTimeframeIds,
    }),
    getInstruments: async () => [{ id: instrumentId, symbol, name: symbol }],
    requestHistory,
    subscribe,
  };
}

const provider: ProviderDefinition = defineProvider({
  metadata: {
    id: providerId,
    name: "Binomo",
    providerContractVersion: providerSdkVersion,
    hostCompatibility: {
      minimumHostApiVersion: hostApiVersion,
      maximumHostApiVersion: hostApiVersion,
    },
  },
  version: "0.1.1",
  config: {
    symbol: config.string({
      label: "Symbol",
      description: "Binomo market symbol used by the candle API.",
      defaultValue: defaultSymbol,
      required: true,
      maxLength: 128,
      requiresReconnect: true,
    }),
    pollIntervalMs: config.number({
      label: "Live poll interval (ms)",
      description:
        "REST fallback refresh interval when the Binomo websocket is unavailable.",
      defaultValue: 1000,
      minimum: 250,
      maximum: 60_000,
      step: 250,
    }),
    sessionCookie: config.secret(binomoCookieCredentialKey, {
      label: "Binomo session cookie",
      description:
        "Optional Binomo web session cookie used for authenticated live websocket data.",
      required: false,
      requiresReconnect: true,
    }),
  },
  create: (host, settings): ProviderAdapter =>
    createBinomoAdapter(host, settings),
});

export default provider;
