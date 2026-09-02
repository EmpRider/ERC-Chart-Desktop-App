import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ProviderRuntimeError,
  instantiateInstalledProvider,
} from "../dist/index.js";

const pluginId = "com.example.fixture";
const version = "1.0.0";

function providerEntry(overrides = {}) {
  const definition = {
    metadata: {
      id: pluginId,
      name: "Fixture Provider",
      providerContractVersion: 1,
      hostCompatibility: {
        minimumHostApiVersion: 1,
        maximumHostApiVersion: 1,
      },
    },
    version,
    config: {
      endpoint: {
        type: "string",
        required: true,
        defaultValue: "https://api.example.com/v1/",
      },
      retries: { type: "number", defaultValue: 2, minimum: 0, maximum: 5 },
      token: {
        type: "secret",
        credentialKey: "auth_token",
        required: true,
      },
    },
    async create(host, settings) {
      const token = await host.credentials.get("auth_token");
      await host.network.request({
        url: `${settings.endpoint}instruments`,
        headers: token === null ? {} : { authorization: `Bearer ${token}` },
      });
      host.logger.info("PROVIDER_CONNECTED", {
        endpoint: settings.endpoint,
        token,
        nested: { authorization: token },
      });
      host.reportStatus("connected");
      return {
        connect: async () => undefined,
        disconnect: async () => undefined,
        getCapabilities: async () => ({
          instruments: true,
          nativeTimeframes: ["1m"],
          liveData: true,
          derivedTimeframes: false,
        }),
        getInstruments: async () => [],
        requestHistory: async () => [],
        subscribe: async () => ({ unsubscribe: async () => undefined }),
      };
    },
    ...overrides,
  };
  return `export default ${serializeDefinition(definition)};\n`;
}

function serializeDefinition(definition) {
  const metadata = JSON.stringify(definition.metadata);
  const config = JSON.stringify(definition.config);
  const createSource = definition.create
    .toString()
    .replace(/^async create\(/u, "async function(")
    .replace(/^create\(/u, "function(");
  return `{
    metadata: ${metadata},
    version: ${JSON.stringify(definition.version)},
    config: ${config},
    create: ${createSource}
  }`;
}

async function withInstalledFixture(entryContents, callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-instance-"));
  const installationPath = path.join(root, pluginId, version);
  await mkdir(path.join(installationPath, "dist"), { recursive: true });
  await writeFile(
    path.join(installationPath, "dist", "index.js"),
    entryContents,
  );
  try {
    await callback({ root, installationPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function createBroker() {
  const network = [];
  const credentials = [];
  const logs = [];
  const statuses = [];
  return {
    network,
    credentials,
    logs,
    statuses,
    broker: {
      async requestNetwork(providerProfileId, request) {
        network.push({ providerProfileId, request });
        return { status: 200, headers: {}, body: new Uint8Array() };
      },
      async getCredential(providerProfileId, credentialKey) {
        credentials.push({ providerProfileId, credentialKey });
        return "fixture-secret";
      },
      log(providerProfileId, level, code, metadata) {
        logs.push({ providerProfileId, level, code, metadata });
      },
      reportStatus(providerProfileId, status) {
        statuses.push({ providerProfileId, status });
      },
      now: () => 1234,
    },
  };
}

function options(installationPath, broker, overrides = {}) {
  return {
    providerProfileId: "profile-a",
    installationPath,
    entry: "dist/index.js",
    pluginId,
    version,
    permissions: {
      network: ["https://api.example.com/v1/"],
      credentials: ["auth_token"],
      storage: [],
    },
    settings: {},
    hostBroker: broker,
    ...overrides,
  };
}

test("loads an installed provider and brokers only approved host capabilities", async () => {
  await withInstalledFixture(providerEntry(), async ({ installationPath }) => {
    const fixture = createBroker();
    const instance = await instantiateInstalledProvider(
      options(installationPath, fixture.broker),
    );

    assert.equal(instance.definition.metadata.id, pluginId);
    assert.equal(instance.definition.version, version);
    assert.deepEqual(instance.settings, {
      endpoint: "https://api.example.com/v1/",
      retries: 2,
    });
    assert.deepEqual(fixture.credentials, [
      { providerProfileId: "profile-a", credentialKey: "auth_token" },
    ]);
    assert.equal(fixture.network.length, 1);
    assert.equal(
      fixture.network[0].request.url,
      "https://api.example.com/v1/instruments",
    );
    assert.equal(
      fixture.network[0].request.headers.authorization,
      "Bearer fixture-secret",
    );
    assert.deepEqual(fixture.statuses, [
      { providerProfileId: "profile-a", status: "connected" },
    ]);
    assert.equal(fixture.logs[0].metadata.token, "[REDACTED]");
    assert.equal(fixture.logs[0].metadata.nested.authorization, "[REDACTED]");
  });
});

test("rejects secret values in persisted provider settings", async () => {
  await withInstalledFixture(providerEntry(), async ({ installationPath }) => {
    const fixture = createBroker();
    await assert.rejects(
      instantiateInstalledProvider(
        options(installationPath, fixture.broker, {
          settings: { token: "must-not-persist" },
        }),
      ),
      (error) =>
        error instanceof ProviderRuntimeError &&
        error.code === "PROVIDER_CONFIG_INVALID" &&
        /credential lease/u.test(error.message),
    );
    assert.deepEqual(fixture.credentials, []);
    assert.deepEqual(fixture.network, []);
  });
});

test("rejects undeclared credential and network permissions before broker access", async () => {
  await withInstalledFixture(providerEntry(), async ({ installationPath }) => {
    const fixture = createBroker();
    await assert.rejects(
      instantiateInstalledProvider(
        options(installationPath, fixture.broker, {
          permissions: {
            network: ["https://api.example.com/v1/"],
            credentials: [],
            storage: [],
          },
        }),
      ),
      (error) =>
        error instanceof ProviderRuntimeError &&
        error.code === "PROVIDER_PERMISSION_DENIED",
    );
    assert.deepEqual(fixture.credentials, []);
    assert.deepEqual(fixture.network, []);

    const blockedNetworkEntry = providerEntry({
      async create(host) {
        await host.network.request({ url: "https://evil.example/v1/data" });
        return {
          connect: async () => undefined,
          disconnect: async () => undefined,
          getCapabilities: async () => ({
            instruments: true,
            nativeTimeframes: [],
            liveData: false,
            derivedTimeframes: false,
          }),
          getInstruments: async () => [],
          requestHistory: async () => [],
          subscribe: async () => ({ unsubscribe: async () => undefined }),
        };
      },
    });
    await writeFile(
      path.join(installationPath, "dist", "blocked.js"),
      blockedNetworkEntry,
    );
    await assert.rejects(
      instantiateInstalledProvider(
        options(installationPath, fixture.broker, { entry: "dist/blocked.js" }),
      ),
      (error) =>
        error instanceof ProviderRuntimeError &&
        error.code === "PROVIDER_PERMISSION_DENIED",
    );
    assert.deepEqual(fixture.network, []);
  });
});

test("rejects identity, compatibility, and entry-path mismatches", async () => {
  await withInstalledFixture(providerEntry(), async ({ installationPath }) => {
    const fixture = createBroker();
    await assert.rejects(
      instantiateInstalledProvider(
        options(installationPath, fixture.broker, {
          pluginId: "com.example.other",
        }),
      ),
      (error) =>
        error instanceof ProviderRuntimeError &&
        error.code === "PROVIDER_DEFINITION_INVALID",
    );
    await assert.rejects(
      instantiateInstalledProvider(
        options(installationPath, fixture.broker, {
          entry: "../outside.js",
        }),
      ),
      (error) =>
        error instanceof ProviderRuntimeError &&
        error.code === "PROVIDER_ENTRY_INVALID",
    );
  });
});

test("allows installed providers to import only the public provider SDK boundary", async () => {
  const sdkEntry = `
    import { defineProvider, providerSdkVersion } from "@erc-chart/provider-sdk";
    export default defineProvider({
      metadata: {
        id: "${pluginId}",
        name: "Public SDK Fixture",
        providerContractVersion: providerSdkVersion,
        hostCompatibility: { minimumHostApiVersion: 1, maximumHostApiVersion: 1 }
      },
      version: "${version}",
      create: async () => ({
        connect: async () => undefined,
        disconnect: async () => undefined,
        getCapabilities: async () => ({
          instruments: true,
          nativeTimeframes: [],
          liveData: false,
          derivedTimeframes: false
        }),
        getInstruments: async () => [],
        requestHistory: async () => [],
        subscribe: async () => ({ unsubscribe: async () => undefined })
      })
    });
  `;
  await withInstalledFixture(sdkEntry, async ({ installationPath }) => {
    const fixture = createBroker();
    const instance = await instantiateInstalledProvider(
      options(installationPath, fixture.broker, {
        permissions: { network: [], credentials: [], storage: [] },
      }),
    );
    assert.equal(instance.definition.metadata.name, "Public SDK Fixture");
  });
});

test("rejects Node internals imported by installed provider code", async () => {
  const nodeEntry = `
    import "node:fs";
    export default {};
  `;
  await withInstalledFixture(nodeEntry, async ({ installationPath }) => {
    const fixture = createBroker();
    await assert.rejects(
      instantiateInstalledProvider(
        options(installationPath, fixture.broker, {
          permissions: { network: [], credentials: [], storage: [] },
        }),
      ),
      (error) =>
        error instanceof ProviderRuntimeError &&
        error.code === "PROVIDER_LOAD_FAILED",
    );
  });
});

test("treats host compatibility metadata and ranges as compatibility failures", async () => {
  const incompatibleContract = {
    id: pluginId,
    name: "Fixture Provider",
    providerContractVersion: 2,
    hostCompatibility: {
      minimumHostApiVersion: 1,
      maximumHostApiVersion: 1,
    },
  };
  await withInstalledFixture(
    providerEntry({ metadata: incompatibleContract }),
    async ({ installationPath }) => {
      const fixture = createBroker();
      await assert.rejects(
        instantiateInstalledProvider(options(installationPath, fixture.broker)),
        (error) =>
          error instanceof ProviderRuntimeError &&
          error.code === "PROVIDER_INCOMPATIBLE",
      );
    },
  );

  const incompatibleMetadata = {
    id: pluginId,
    name: "Fixture Provider",
    providerContractVersion: 1,
    hostCompatibility: {
      minimumHostApiVersion: 99,
      maximumHostApiVersion: 100,
    },
  };
  await withInstalledFixture(
    providerEntry({ metadata: incompatibleMetadata }),
    async ({ installationPath }) => {
      const fixture = createBroker();
      await assert.rejects(
        instantiateInstalledProvider(options(installationPath, fixture.broker)),
        (error) =>
          error instanceof ProviderRuntimeError &&
          error.code === "PROVIDER_INCOMPATIBLE",
      );
    },
  );

  const invalidMetadata = {
    ...incompatibleMetadata,
    hostCompatibility: { minimumHostApiVersion: "invalid" },
  };
  await withInstalledFixture(
    providerEntry({ metadata: invalidMetadata }),
    async ({ installationPath }) => {
      const fixture = createBroker();
      await assert.rejects(
        instantiateInstalledProvider(options(installationPath, fixture.broker)),
        (error) =>
          error instanceof ProviderRuntimeError &&
          error.code === "PROVIDER_INCOMPATIBLE",
      );
    },
  );
});

test("rejects incomplete provider adapters with a stable adapter error", async () => {
  await withInstalledFixture(
    providerEntry({
      async create() {
        return { connect: async () => undefined };
      },
    }),
    async ({ installationPath }) => {
      const fixture = createBroker();
      await assert.rejects(
        instantiateInstalledProvider(options(installationPath, fixture.broker)),
        (error) =>
          error instanceof ProviderRuntimeError &&
          error.code === "PROVIDER_ADAPTER_INVALID",
      );
    },
  );
});

test("does not treat a path-prefix collision as an approved network permission", async () => {
  const boundaryEntry = providerEntry({
    async create(host) {
      await host.network.request({
        url: "https://api.example.com/v1private/instruments",
      });
      return {
        connect: async () => undefined,
        disconnect: async () => undefined,
        getCapabilities: async () => ({
          instruments: true,
          nativeTimeframes: [],
          liveData: false,
          derivedTimeframes: false,
        }),
        getInstruments: async () => [],
        requestHistory: async () => [],
        subscribe: async () => ({ unsubscribe: async () => undefined }),
      };
    },
  });
  await withInstalledFixture(boundaryEntry, async ({ installationPath }) => {
    const fixture = createBroker();
    await assert.rejects(
      instantiateInstalledProvider(
        options(installationPath, fixture.broker, {
          permissions: {
            network: ["https://api.example.com/v1"],
            credentials: [],
            storage: [],
          },
        }),
      ),
      (error) =>
        error instanceof ProviderRuntimeError &&
        error.code === "PROVIDER_PERMISSION_DENIED",
    );
    assert.deepEqual(fixture.network, []);
  });
});

test("maps missing installation and entry filesystem failures to stable entry errors", async () => {
  const fixture = createBroker();
  const missingRoot = path.join(os.tmpdir(), "erc-provider-definitely-missing");
  await assert.rejects(
    instantiateInstalledProvider(options(missingRoot, fixture.broker)),
    (error) =>
      error instanceof ProviderRuntimeError &&
      error.code === "PROVIDER_ENTRY_INVALID" &&
      !error.message.includes(missingRoot),
  );

  await withInstalledFixture(providerEntry(), async ({ installationPath }) => {
    await assert.rejects(
      instantiateInstalledProvider(
        options(installationPath, fixture.broker, { entry: "dist/missing.js" }),
      ),
      (error) =>
        error instanceof ProviderRuntimeError &&
        error.code === "PROVIDER_ENTRY_INVALID" &&
        !error.message.includes(installationPath),
    );
  });
});
