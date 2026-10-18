import assert from "node:assert/strict";
import test from "node:test";
import {
  config,
  defineProvider,
  providerContractVersion,
  providerSdkVersion,
} from "../dist/index.js";

test("pins the provider authoring API to the provider contract", () => {
  assert.equal(providerSdkVersion, providerContractVersion);
  assert.equal(providerSdkVersion, 1);
});

test("defines immutable provider metadata and configuration declarations", () => {
  const definition = defineProvider({
    metadata: {
      id: "fixture.provider",
      name: "Fixture Provider",
      providerContractVersion: providerSdkVersion,
      hostCompatibility: {
        minimumHostApiVersion: 1,
        maximumHostApiVersion: 1,
      },
    },
    version: "1.0.0",
    config: {
      endpoint: config.string({ required: true, requiresReconnect: true }),
      token: config.secret("token", {
        required: true,
        requiresReconnect: true,
      }),
    },
    create: async () => ({
      connect: async () => undefined,
      disconnect: async () => undefined,
      getCapabilities: async () => ({
        instruments: true,
        nativeTimeframes: [],
        liveData: true,
        derivedTimeframes: false,
      }),
      getInstruments: async () => [],
      requestHistory: async () => [],
      subscribe: async () => ({ unsubscribe: async () => undefined }),
    }),
  });

  assert.equal(definition.config.endpoint.type, "string");
  assert.equal(definition.config.token.type, "secret");
  assert.equal(definition.config.token.credentialKey, "token");
  assert.ok(Object.isFrozen(definition));
  assert.ok(Object.isFrozen(definition.metadata));
  assert.ok(Object.isFrozen(definition.config));
});
