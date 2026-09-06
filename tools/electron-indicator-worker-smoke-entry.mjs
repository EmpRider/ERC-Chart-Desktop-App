import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, net, protocol } from "electron";

import {
  indicatorPluginSchemeRegistration,
  rendererSchemeRegistration,
} from "../packages/electron-main/dist/index.js";
import { installRendererProtocol } from "../apps/desktop/dist/protocol.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const runtimeWorkerPath = path.join(
  repoRoot,
  "apps",
  "desktop",
  "dist",
  "runtime",
  "indicator-worker.js",
);
const root = path.join(
  os.tmpdir(),
  `erc-indicator-worker-smoke-${process.pid}`,
);
const rendererRoot = path.join(root, "renderer");
const pluginRoot = path.join(root, "plugins");
const pluginId = "erc.indicator.worker-smoke";
const version = "1.0.0";
const pluginEntry = path.join(
  pluginRoot,
  pluginId,
  version,
  "dist",
  "index.js",
);

const stage = (name) => console.log(`ERC_CHART_INDICATOR_WORKER_STAGE ${name}`);

protocol.registerSchemesAsPrivileged([
  rendererSchemeRegistration,
  indicatorPluginSchemeRegistration,
]);

function websocketServer() {
  let acceptedConnections = 0;
  const server = createServer();
  server.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    acceptedConnections += 1;
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );
  });
  return {
    server,
    acceptedConnections: () => acceptedConnections,
  };
}

function pluginSource(wsUrl) {
  return `
const nodeGlobalsBlocked =
  typeof globalThis.process === "undefined" &&
  typeof globalThis.require === "undefined";

let fetchBlocked = false;
try {
  await fetch("erc-app://app/index.html");
} catch {
  fetchBlocked = true;
}

const websocketBlocked = await new Promise((resolve) => {
  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    resolve(value);
  };
  try {
    const socket = new WebSocket(${JSON.stringify(wsUrl)});
    const timer = setTimeout(() => {
      try { socket.close(); } catch {}
      finish(true);
    }, 750);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      try { socket.close(); } catch {}
      finish(false);
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      finish(true);
    }, { once: true });
  } catch {
    finish(true);
  }
});

if (!nodeGlobalsBlocked || !fetchBlocked || !websocketBlocked) {
  throw new Error(
    "Worker isolation failed: " +
      JSON.stringify({ nodeGlobalsBlocked, fetchBlocked, websocketBlocked }),
  );
}

const definition = {
  id: "erc.indicator.worker-smoke.main",
  name: "Worker Smoke",
  placement: "overlay",
  inputs: [],
  outputs: [{ key: "value", label: "Value" }],
  plots: [{ key: "value", kind: "line", outputKey: "value" }],
  requiresLiveTicks: false,
};

export default {
  definition,
  createInstance() {
    let last;
    return {
      onHistory(history) { last = history.at(-1); },
      onBuildingBar(candle) { last = candle; },
      onFinalizedBar(candle) { last = candle; },
      snapshot() {
        return {
          points: last === undefined
            ? []
            : [{ openTimeMs: last.openTimeMs, values: { value: last.close } }],
          overlays: [],
          signals: [],
        };
      },
      dispose() {},
    };
  },
};
`;
}

async function run() {
  const ws = websocketServer();
  let removeProtocols;
  let window;
  let exitCode = 1;

  try {
    stage("prepare-files");
    await mkdir(rendererRoot, { recursive: true });
    await mkdir(path.dirname(pluginEntry), { recursive: true });
    await writeFile(
      path.join(rendererRoot, "index.html"),
      "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'none'\">",
      "utf8",
    );
    await writeFile(
      path.join(rendererRoot, "indicator-worker.js"),
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(runtimeWorkerPath, "utf8"),
      ),
      "utf8",
    );

    await new Promise((resolve, reject) => {
      ws.server.once("error", reject);
      ws.server.listen(0, "127.0.0.1", resolve);
    });
    stage("websocket-listening");
    const address = ws.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Worker smoke WebSocket server did not bind a TCP port.");
    }
    await writeFile(
      pluginEntry,
      pluginSource(`ws://127.0.0.1:${address.port}`),
      "utf8",
    );

    await app.whenReady();
    stage("app-ready");
    removeProtocols = await installRendererProtocol(
      {
        handle: (scheme, handler) => protocol.handle(scheme, handler),
        unhandle: (scheme) => protocol.unhandle(scheme),
        fetch: (url) => net.fetch(url),
      },
      rendererRoot,
      pluginRoot,
    );
    stage("protocols-installed");

    window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await window.loadURL("erc-app://app/index.html");
    stage("page-loaded");
    const result = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const worker = new Worker("erc-app://app/indicator-worker.js", { type: "module" });
        const timer = setTimeout(() => {
          worker.terminate();
          resolve({ type: "timeout" });
        }, 3000);
        worker.addEventListener("error", (event) => {
          clearTimeout(timer);
          worker.terminate();
          resolve({ type: "worker-error", message: event.message });
        }, { once: true });
        worker.addEventListener("message", (event) => {
          clearTimeout(timer);
          worker.terminate();
          resolve(event.data);
        }, { once: true });
        worker.postMessage({
          type: "sync",
          instanceId: "worker-smoke",
          runtimeEntryUrl: "erc-plugin://plugin/${pluginId}/${version}/dist/index.js",
          pluginId: "${pluginId}",
          definitionId: "erc.indicator.worker-smoke.main",
          instrumentId: "fixture.instrument",
          timeframeId: "1m",
          parameters: {},
        data: {
          kind: "snapshot",
          candles: [{
            instrumentId: "fixture.instrument",
            timeframeId: "1m",
            openTimeMs: 1800000000000,
            open: 100,
            high: 102,
            low: 99,
            close: 101,
            volume: 10
          }]
        },
          sequence: 1,
          dataRevision: 1,
          configGeneration: 1
        });
      })
    `);
    stage("worker-result");

    if (
      result?.type !== "result" ||
      result?.result?.kind !== "snapshot" ||
      result?.result?.snapshot?.points?.[0]?.values?.value !== 101 ||
      ws.acceptedConnections() !== 0
    ) {
      throw new Error(
        `Indicator worker isolation smoke failed: ${JSON.stringify({ result, websocketConnections: ws.acceptedConnections() })}`,
      );
    }

    console.log("ERC_CHART_INDICATOR_WORKER_SMOKE_READY");
    exitCode = 0;
  } catch (error) {
    console.error(error);
  } finally {
    window?.destroy();
    removeProtocols?.();
    await new Promise((resolve) => ws.server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
    app.exit(exitCode);
  }
}

void run();
