import { createHash, randomBytes } from "node:crypto";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type {
  ProviderRuntimeHostBroker,
  ProviderUtilityLaunchDescriptor,
} from "@erc-chart/provider-runtime";
import { isProviderNetworkRequestAllowed } from "@erc-chart/provider-runtime";
import type { WindowsGenericCredentialManager } from "@erc-chart/electron-main";
import { windowsCredentialTarget } from "@erc-chart/electron-main";

type ProviderNetworkRequest = Parameters<
  ProviderRuntimeHostBroker["requestNetwork"]
>[1];
type ProviderNetworkResponse = Awaited<
  ReturnType<ProviderRuntimeHostBroker["requestNetwork"]>
>;
type ProviderWebSocketOpen = NonNullable<
  ProviderRuntimeHostBroker["openWebSocket"]
>;
type ProviderWebSocketRequest = Parameters<ProviderWebSocketOpen>[1];
type ProviderWebSocketHandlers = Parameters<ProviderWebSocketOpen>[2];
type ProviderWebSocketConnection = Awaited<ReturnType<ProviderWebSocketOpen>>;
type ProviderStatus = Parameters<ProviderRuntimeHostBroker["reportStatus"]>[1];

const defaultProviderNetworkTimeoutMs = 30_000;
const minimumProviderNetworkTimeoutMs = 1;
const maximumProviderNetworkTimeoutMs = 120_000;
export const maximumProviderNetworkResponseBytes: number = 8 * 1024 * 1024;
export const maximumProviderWebSocketMessageBytes: number = 2 * 1024 * 1024;
const webSocketMagic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const protectedWebSocketHeaders = new Set([
  "connection",
  "host",
  "sec-websocket-accept",
  "sec-websocket-extensions",
  "sec-websocket-key",
  "sec-websocket-protocol",
  "sec-websocket-version",
  "transfer-encoding",
  "upgrade",
]);

export interface ProviderHostBrokerOptions {
  readonly launches: ReadonlyMap<string, ProviderUtilityLaunchDescriptor>;
  readonly credentialManager: WindowsGenericCredentialManager;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly log: (
    providerProfileId: string,
    level: "debug" | "info" | "warn" | "error",
    code: string,
    metadata?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly reportStatus: (
    providerProfileId: string,
    status: ProviderStatus,
  ) => void;
  readonly now: () => number;
}

function requireLaunch(
  launches: ReadonlyMap<string, ProviderUtilityLaunchDescriptor>,
  providerProfileId: string,
): ProviderUtilityLaunchDescriptor {
  const launch = launches.get(providerProfileId);
  if (launch === undefined) throw new Error("Provider profile is not active.");
  return launch;
}

function parseCredentialBundle(
  value: string | undefined,
): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Provider credential bundle is invalid.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Provider credential bundle is invalid.");
  }
  const entries = Object.entries(parsed);
  if (
    !entries.every(([key, item]) => key.length > 0 && typeof item === "string")
  ) {
    throw new Error("Provider credential bundle is invalid.");
  }
  return Object.fromEntries(entries);
}

function checkedWebSocketHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  if (headers === undefined) return {};
  for (const name of Object.keys(headers)) {
    if (protectedWebSocketHeaders.has(name.toLowerCase())) {
      throw new Error("Provider websocket header is managed by the host.");
    }
  }
  return headers;
}

function createClientWebSocketFrame(
  opcode: number,
  payload: Uint8Array,
): Buffer {
  const byteLength = payload.byteLength;
  const extendedLengthBytes =
    byteLength <= 125 ? 0 : byteLength <= 65_535 ? 2 : 8;
  const headerLength = 2 + extendedLengthBytes + 4;
  const frame = Buffer.allocUnsafe(headerLength + byteLength);
  frame[0] = 0x80 | opcode;
  if (extendedLengthBytes === 0) {
    frame[1] = 0x80 | byteLength;
  } else if (extendedLengthBytes === 2) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(byteLength, 2);
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(byteLength), 2);
  }
  const maskOffset = 2 + extendedLengthBytes;
  const payloadOffset = maskOffset + 4;
  const mask = randomBytes(4);
  mask.copy(frame, maskOffset);
  for (let index = 0; index < byteLength; index += 1) {
    frame[payloadOffset + index] =
      (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
  }
  return frame;
}

function encodeWebSocketClosePayload(code?: number, reason?: string): Buffer {
  if (code === undefined && reason === undefined) return Buffer.alloc(0);
  const closeCode = code ?? 1000;
  const reasonBytes = Buffer.from(reason ?? "", "utf8");
  if (reasonBytes.byteLength > 123) {
    throw new RangeError("Provider websocket close reason is too long.");
  }
  const payload = Buffer.allocUnsafe(2 + reasonBytes.byteLength);
  payload.writeUInt16BE(closeCode, 0);
  reasonBytes.copy(payload, 2);
  return payload;
}

function bindWebSocketFrames(
  socket: Duplex,
  head: Buffer,
  handlers: ProviderWebSocketHandlers,
): ProviderWebSocketConnection {
  let buffered = head;
  let fragmentedOpcode: number | undefined;
  let fragments: Buffer[] = [];
  let fragmentedBytes = 0;
  let closeSent = false;
  let closeNotified = false;
  const textDecoder = new TextDecoder("utf-8", { fatal: true });

  const notifyClose = (code: number, reason: string): void => {
    if (closeNotified) return;
    closeNotified = true;
    handlers.onClose({ code, reason });
  };

  const writeFrame = (opcode: number, payload: Uint8Array): void => {
    if (socket.destroyed) throw new Error("Provider websocket is closed.");
    socket.write(createClientWebSocketFrame(opcode, payload));
  };

  const protocolFailure = (): void => {
    handlers.onError("PROVIDER_WEBSOCKET_PROTOCOL_ERROR");
    try {
      if (!closeSent) {
        closeSent = true;
        writeFrame(0x8, encodeWebSocketClosePayload(1002, "Protocol error"));
      }
    } catch {
      // The socket is already unusable.
    }
    notifyClose(1002, "Protocol error");
    socket.destroy();
  };

  const deliverDataMessage = (opcode: number, payload: Buffer): void => {
    if (payload.byteLength > maximumProviderWebSocketMessageBytes) {
      protocolFailure();
      return;
    }
    if (opcode === 0x1) {
      try {
        handlers.onMessage(textDecoder.decode(payload));
      } catch {
        protocolFailure();
      }
      return;
    }
    handlers.onMessage(Uint8Array.from(payload));
  };

  const processBufferedFrames = (): void => {
    while (buffered.byteLength >= 2 && !socket.destroyed) {
      const first = buffered[0] ?? 0;
      const second = buffered[1] ?? 0;
      const final = (first & 0x80) !== 0;
      const reserved = first & 0x70;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let payloadLength = second & 0x7f;
      let headerLength = 2;
      if (reserved !== 0 || masked) {
        protocolFailure();
        return;
      }
      if (payloadLength === 126) {
        if (buffered.byteLength < 4) return;
        payloadLength = buffered.readUInt16BE(2);
        headerLength = 4;
      } else if (payloadLength === 127) {
        if (buffered.byteLength < 10) return;
        const longLength = buffered.readBigUInt64BE(2);
        if (longLength > BigInt(maximumProviderWebSocketMessageBytes)) {
          protocolFailure();
          return;
        }
        payloadLength = Number(longLength);
        headerLength = 10;
      }
      const isControl = opcode >= 0x8;
      if (
        (isControl && (!final || payloadLength > 125)) ||
        payloadLength > maximumProviderWebSocketMessageBytes
      ) {
        protocolFailure();
        return;
      }
      const frameLength = headerLength + payloadLength;
      if (buffered.byteLength < frameLength) return;
      const payload = buffered.subarray(headerLength, frameLength);
      buffered = buffered.subarray(frameLength);

      if (opcode === 0x8) {
        if (payload.byteLength === 1) {
          protocolFailure();
          return;
        }
        const code = payload.byteLength >= 2 ? payload.readUInt16BE(0) : 1005;
        let reason = "";
        try {
          if (payload.byteLength > 2)
            reason = textDecoder.decode(payload.subarray(2));
        } catch {
          protocolFailure();
          return;
        }
        if (!closeSent) {
          closeSent = true;
          try {
            writeFrame(0x8, payload);
          } catch {
            // Peer already closed the transport.
          }
        }
        notifyClose(code, reason);
        socket.end();
        return;
      }
      if (opcode === 0x9) {
        try {
          writeFrame(0x0a, payload);
        } catch {
          socket.destroy();
        }
        continue;
      }
      if (opcode === 0x0a) continue;
      if (opcode === 0x0) {
        if (fragmentedOpcode === undefined) {
          protocolFailure();
          return;
        }
        fragmentedBytes += payload.byteLength;
        if (fragmentedBytes > maximumProviderWebSocketMessageBytes) {
          protocolFailure();
          return;
        }
        fragments.push(payload);
        if (final) {
          const complete = Buffer.concat(fragments, fragmentedBytes);
          const completeOpcode = fragmentedOpcode;
          fragmentedOpcode = undefined;
          fragments = [];
          fragmentedBytes = 0;
          deliverDataMessage(completeOpcode, complete);
        }
        continue;
      }
      if (opcode !== 0x1 && opcode !== 0x2) {
        protocolFailure();
        return;
      }
      if (fragmentedOpcode !== undefined) {
        protocolFailure();
        return;
      }
      if (final) {
        deliverDataMessage(opcode, payload);
      } else {
        fragmentedOpcode = opcode;
        fragments = [payload];
        fragmentedBytes = payload.byteLength;
      }
    }
  };

  socket.on("data", (chunk: Buffer) => {
    buffered =
      buffered.byteLength === 0 ? chunk : Buffer.concat([buffered, chunk]);
    processBufferedFrames();
  });
  socket.on("error", () =>
    handlers.onError("PROVIDER_WEBSOCKET_TRANSPORT_ERROR"),
  );
  socket.on("close", () => notifyClose(1006, ""));
  processBufferedFrames();

  return Object.freeze({
    send: (data: Parameters<ProviderWebSocketConnection["send"]>[0]): void => {
      const payload =
        typeof data === "string" ? Buffer.from(data, "utf8") : data;
      if (payload.byteLength > maximumProviderWebSocketMessageBytes) {
        throw new RangeError("Provider websocket message is too large.");
      }
      writeFrame(typeof data === "string" ? 0x1 : 0x2, payload);
    },
    close: (code?: number, reason?: string): void => {
      if (closeSent || socket.destroyed) return;
      closeSent = true;
      writeFrame(0x8, encodeWebSocketClosePayload(code, reason));
    },
  });
}

async function connectProviderWebSocket(
  request: ProviderWebSocketRequest,
  handlers: ProviderWebSocketHandlers,
): Promise<ProviderWebSocketConnection> {
  const target = new URL(request.url);
  if (target.protocol !== "wss:") {
    throw new Error("Provider websocket protocol is not supported.");
  }
  const handshakeTarget = new URL(target);
  handshakeTarget.protocol = "https:";
  const headers = checkedWebSocketHeaders(request.headers);
  const key = randomBytes(16).toString("base64");
  const expectedAccept = createHash("sha1")
    .update(`${key}${webSocketMagic}`)
    .digest("base64");

  return new Promise<ProviderWebSocketConnection>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const client = httpsRequest(handshakeTarget, {
      method: "GET",
      headers: {
        ...headers,
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": key,
        "Sec-WebSocket-Version": "13",
        ...(request.protocols === undefined || request.protocols.length === 0
          ? {}
          : { "Sec-WebSocket-Protocol": request.protocols.join(", ") }),
      },
    });
    client.setTimeout(defaultProviderNetworkTimeoutMs, () =>
      client.destroy(new Error("Provider websocket handshake timed out.")),
    );
    client.once("error", fail);
    client.once("response", (response: IncomingMessage) => {
      response.resume();
      fail(
        new Error(
          `Provider websocket handshake failed with HTTP ${response.statusCode ?? 0}.`,
        ),
      );
    });
    client.once(
      "upgrade",
      (response: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (settled) {
          socket.destroy();
          return;
        }
        if (
          response.statusCode !== 101 ||
          response.headers["sec-websocket-accept"] !== expectedAccept
        ) {
          socket.destroy();
          fail(new Error("Provider websocket handshake validation failed."));
          return;
        }
        const selectedProtocol = response.headers["sec-websocket-protocol"];
        if (
          selectedProtocol !== undefined &&
          (request.protocols === undefined ||
            !request.protocols.includes(selectedProtocol))
        ) {
          socket.destroy();
          fail(
            new Error("Provider websocket selected an unexpected protocol."),
          );
          return;
        }
        client.setTimeout(0);
        settled = true;
        resolve(bindWebSocketFrames(socket, head, handlers));
      },
    );
    client.end();
  });
}

async function fetchProviderNetwork(
  fetcher: ProviderHostBrokerOptions["fetch"],
  request: ProviderNetworkRequest,
  signal?: AbortSignal,
): Promise<ProviderNetworkResponse> {
  const controller = new AbortController();
  const abortFromCaller = (): void => controller.abort();
  if (signal?.aborted === true) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timer = setTimeout(
    () => controller.abort(),
    resolveProviderNetworkTimeoutMs(request.timeoutMs),
  );
  try {
    const body =
      request.body === undefined
        ? undefined
        : typeof request.body === "string"
          ? request.body
          : Uint8Array.from(request.body).buffer;
    const response = await fetcher(request.url, {
      ...(request.method === undefined ? {} : { method: request.method }),
      ...(request.headers === undefined ? {} : { headers: request.headers }),
      ...(body === undefined ? {} : { body }),
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > maximumProviderNetworkResponseBytes
    ) {
      throw new Error("Provider network response exceeds the allowed size.");
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    if (reader !== undefined) {
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          byteLength += result.value.byteLength;
          if (byteLength > maximumProviderNetworkResponseBytes) {
            await reader.cancel().catch(() => undefined);
            throw new Error(
              "Provider network response exceeds the allowed size.",
            );
          }
          chunks.push(result.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const responseBody = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      responseBody.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseBody,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export function resolveProviderNetworkTimeoutMs(
  requestedTimeoutMs: number | undefined,
): number {
  if (
    requestedTimeoutMs === undefined ||
    !Number.isFinite(requestedTimeoutMs)
  ) {
    return defaultProviderNetworkTimeoutMs;
  }
  return Math.min(
    maximumProviderNetworkTimeoutMs,
    Math.max(minimumProviderNetworkTimeoutMs, Math.trunc(requestedTimeoutMs)),
  );
}

export function createDesktopProviderHostBroker(
  options: ProviderHostBrokerOptions,
): ProviderRuntimeHostBroker {
  return {
    requestNetwork: (providerProfileId, request, signal) => {
      const launch = requireLaunch(options.launches, providerProfileId);
      if (
        !isProviderNetworkRequestAllowed(
          request.url,
          launch.permissions.network,
        )
      ) {
        throw new Error("Provider network request is not permitted.");
      }
      if (new URL(request.url).protocol !== "https:") {
        throw new Error("Provider network request protocol is not supported.");
      }
      return fetchProviderNetwork(options.fetch, request, signal);
    },
    openWebSocket: async (providerProfileId, request, handlers) => {
      const launch = requireLaunch(options.launches, providerProfileId);
      if (
        !isProviderNetworkRequestAllowed(
          request.url,
          launch.permissions.network,
        )
      ) {
        throw new Error("Provider websocket request is not permitted.");
      }
      return connectProviderWebSocket(request, handlers);
    },
    getCredential: async (providerProfileId, credentialKey) => {
      const launch = requireLaunch(options.launches, providerProfileId);
      if (!launch.permissions.credentials.includes(credentialKey)) {
        throw new Error("Provider credential access is not permitted.");
      }
      const raw = await options.credentialManager.read(
        windowsCredentialTarget(launch.pluginId, providerProfileId),
      );
      return parseCredentialBundle(raw)[credentialKey] ?? null;
    },
    log: options.log,
    reportStatus: options.reportStatus,
    now: options.now,
  };
}
