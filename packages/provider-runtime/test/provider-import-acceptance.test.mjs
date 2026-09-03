import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  activatePlugin,
  deletePlugin,
  disablePlugin,
  getPlugin,
  openStorageDatabase,
  putPlugin,
} from "../../storage/dist/index.js";
import { PluginPermissionReview } from "../../renderer/dist/index.js";
import { runProviderContractConformance } from "../../testing/dist/index.js";
import {
  createProviderUtilityRuntime,
  installStagedPlugin,
  removeInstalledPlugin,
  stagePluginPackage,
} from "../dist/index.js";

const examples = [
  {
    file: "tick-provider.js",
    id: "example.tick-provider",
    name: "Example Tick Provider",
    instrumentId: "EXAMPLE-TICK",
    liveKind: "ticks",
  },
  {
    file: "candle-provider.js",
    id: "example.candle-provider",
    name: "Example Candle Provider",
    instrumentId: "EXAMPLE-CANDLE",
    liveKind: "candles",
  },
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function createPort() {
  const messages = [];
  let listener = () => undefined;
  return {
    messages,
    port: {
      postMessage(message) {
        messages.push(message);
      },
      onMessage(next) {
        listener = next;
        return () => {
          listener = () => undefined;
        };
      },
    },
    send(message) {
      listener(message);
    },
  };
}

async function writePackage(root, example, entryContents) {
  const source = path.join(root, `${example.id}-source`);
  await mkdir(path.join(source, "dist"), { recursive: true });
  await writeFile(path.join(source, "dist", "index.js"), entryContents);
  const manifest = {
    manifestVersion: 1,
    id: example.id,
    kind: "provider",
    name: example.name,
    version: "1.0.0",
    apiVersion: "^1.0.0",
    entry: "dist/index.js",
    authoringLanguage: "typescript",
    permissions: {
      network: [],
      credentials: [],
      storage: ["provider-cache"],
    },
    integrity: {
      algorithm: "sha256",
      files: { "dist/index.js": sha256(entryContents) },
    },
  };
  await writeFile(path.join(source, "plugin.json"), JSON.stringify(manifest));
  return { source, manifest };
}

function reviewPermissions(manifest) {
  const markup = renderToStaticMarkup(
    createElement(PluginPermissionReview, {
      request: {
        requestId: `review-${manifest.id}`,
        pluginId: manifest.id,
        pluginName: manifest.name,
        pluginVersion: manifest.version,
        kind: manifest.kind,
        mode: "developer",
        trust: "unsigned",
        reason: "install",
        permissions: manifest.permissions,
      },
      onDecision: () => undefined,
    }),
  );
  assert.match(markup, new RegExp(manifest.name));
  assert.match(markup, /provider-cache/u);
  assert.match(markup, /Unsigned Developer Mode plugin/u);
  assert.match(markup, /Approve permissions/u);
}

function registerAndActivate(database, staged) {
  putPlugin(database, {
    pluginId: staged.manifest.id,
    version: staged.manifest.version,
    kind: staged.manifest.kind,
    trust: "unsigned",
    status: "disabled",
    manifest: staged.manifest,
    integrityHash: `sha256:${staged.packageHash}`,
    permissions: staged.manifest.permissions.storage.map(
      (permission) => `storage:${permission}`,
    ),
  });
  return activatePlugin(database, staged.manifest.id, staged.manifest.version);
}

async function startInstalledProvider(installed) {
  const transport = createPort();
  const runtime = createProviderUtilityRuntime(
    transport.port,
    `${installed.pluginId}.profile`,
  );
  transport.send({
    type: "provider-initialize",
    contractVersion: 1,
    launch: {
      installationPath: installed.installationPath,
      entry: installed.manifest.entry,
      pluginId: installed.pluginId,
      version: installed.version,
      permissions: installed.manifest.permissions,
      settings: {},
    },
  });
  const instance = await runtime.ready;
  assert.ok(transport.messages.some((message) => message.type === "ready"));
  return { runtime, instance };
}

test("imports, reviews, activates, starts, and validates public-SDK provider examples", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-import-"));
  const database = await openStorageDatabase(path.join(root, "storage.sqlite"));
  try {
    for (const example of examples) {
      const compiled = await readFile(
        path.resolve("packages", "provider-examples", "dist", example.file),
        "utf8",
      );
      assert.match(compiled, /@erc-chart\/provider-sdk/u);
      assert.doesNotMatch(
        compiled,
        /@erc-chart\/(?:contracts|provider-runtime|renderer|storage|indicator)/u,
      );

      const fixture = await writePackage(root, example, compiled);
      const staged = await stagePluginPackage(
        { kind: "folder", path: fixture.source },
        {
          stagingRoot: path.join(root, "staging"),
          trustPolicy: { mode: "developer", trustedPublisherKeys: {} },
        },
      );
      reviewPermissions(staged.manifest);
      const installed = await installStagedPlugin(staged, {
        installationRoot: path.join(root, "installed"),
      });
      assert.equal(registerAndActivate(database, staged).status, "active");

      const { runtime, instance } = await startInstalledProvider(installed);
      try {
        const request = {
          instrumentId: example.instrumentId,
          timeframeId: "1m",
        };
        const live = { candles: [], ticks: [] };
        const subscription = await instance.adapter.subscribe(request, {
          onCandles: (candles) => live.candles.push(...candles),
          onTicks: (ticks) => live.ticks.push(...ticks),
          onError: () => undefined,
        });
        await subscription.unsubscribe();
        assert.ok(live[example.liveKind].length > 0);

        const report = await runProviderContractConformance({
          definition: instance.definition,
          adapter: instance.adapter,
          historyRequest: { ...request, limit: 100 },
          subscriptionRequest: request,
        });
        assert.deepEqual(report, { ok: true, violations: [] });
      } finally {
        runtime.shutdown();
      }
    }
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("cleans registry and installed files when a provider fails during start", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "erc-provider-import-failure-"),
  );
  const database = await openStorageDatabase(path.join(root, "storage.sqlite"));
  const example = {
    id: "example.failed-provider",
    name: "Example Failed Provider",
  };
  let installed;
  try {
    const fixture = await writePackage(root, example, "export default {};\n");
    const staged = await stagePluginPackage(
      { kind: "folder", path: fixture.source },
      {
        stagingRoot: path.join(root, "staging"),
        trustPolicy: { mode: "developer", trustedPublisherKeys: {} },
      },
    );
    reviewPermissions(staged.manifest);
    installed = await installStagedPlugin(staged, {
      installationRoot: path.join(root, "installed"),
    });
    registerAndActivate(database, staged);

    const transport = createPort();
    const runtime = createProviderUtilityRuntime(
      transport.port,
      `${installed.pluginId}.profile`,
    );
    transport.send({
      type: "provider-initialize",
      contractVersion: 1,
      launch: {
        installationPath: installed.installationPath,
        entry: installed.manifest.entry,
        pluginId: installed.pluginId,
        version: installed.version,
        permissions: installed.manifest.permissions,
        settings: {},
      },
    });
    await assert.rejects(runtime.ready, /PROVIDER_DEFINITION_INVALID/u);
    runtime.shutdown();

    disablePlugin(database, installed.pluginId, installed.version);
    assert.equal(
      deletePlugin(database, installed.pluginId, installed.version),
      true,
    );
    assert.equal(
      await removeInstalledPlugin(
        { installationRoot: path.join(root, "installed") },
        installed.pluginId,
        installed.version,
      ),
      true,
    );
    assert.equal(
      getPlugin(database, installed.pluginId, installed.version),
      undefined,
    );
    await assert.rejects(stat(installed.installationPath), { code: "ENOENT" });
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
