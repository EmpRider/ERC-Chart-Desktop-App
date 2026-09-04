import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getProviderProfile,
  openStorageDatabase,
  putPlugin,
} from "../../../packages/storage/dist/index.js";
import { createProviderManagementService } from "../dist/provider-management-service.js";

function providerManifest() {
  return {
    manifestVersion: 1,
    id: "erc.provider.fixture",
    kind: "provider",
    name: "Fixture Provider",
    version: "1.0.0",
    apiVersion: "^1.0.0",
    entry: "dist/index.js",
    authoringLanguage: "typescript",
    permissions: {
      network: ["https://api.example.com/*"],
      credentials: ["auth_token"],
      storage: [],
    },
  };
}

test("creates, edits, stops, restarts, and removes provider profiles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-provider-manager-"));
  const database = await openStorageDatabase(path.join(root, "storage.sqlite"));
  const statuses = new Map();
  const calls = [];
  const credentialWrites = [];
  try {
    putPlugin(database, {
      pluginId: "erc.provider.fixture",
      version: "1.0.0",
      kind: "provider",
      trust: "unsigned",
      status: "active",
      manifest: providerManifest(),
      integrityHash: `sha256:${"0".repeat(64)}`,
      permissions: [],
    });
    const controller = {
      async startProviderProfile(profileId, launch) {
        calls.push(["start", profileId, launch]);
        statuses.set(profileId, "ready");
      },
      async stopProviderProfile(profileId) {
        calls.push(["stop", profileId]);
        statuses.set(profileId, "stopped");
      },
      async reconfigureProviderProfile(profileId, settings) {
        calls.push(["reconfigure", profileId, settings]);
        return { impact: "none", settings, changedKeys: Object.keys(settings) };
      },
      async getProviderCapabilities() {
        return {
          instruments: true,
          nativeTimeframes: ["1m"],
          liveData: true,
          derivedTimeframes: true,
          derivedTimeframeIds: ["2m", "3m"],
        };
      },
      async getProviderInstruments() {
        return [{ id: "BTCUSD", symbol: "BTCUSD", name: "Bitcoin" }];
      },
      async requestProviderHistory(profileId, request) {
        calls.push(["history", profileId, request]);
        return [];
      },
    };
    const service = createProviderManagementService({
      database,
      controller,
      credentialManager: {
        async write(target, value) {
          credentialWrites.push([target, value]);
        },
        async delete(target) {
          calls.push(["credential-delete", target]);
        },
      },
      installationRoot: path.join(root, "installed"),
      getStatus: (profileId) => statuses.get(profileId) ?? "idle",
      createProfileId: () => "profile-a",
      now: () => 1_800_000_000_000,
    });

    assert.deepEqual(service.snapshot().profiles, []);
    const session = await service.create({
      providerId: "erc.provider.fixture",
      displayName: "Primary account",
      settings: { region: "eu" },
      credentials: { auth_token: "fixture-token" },
    });
    assert.equal(session.profileId, "profile-a");
    assert.equal(session.instrument.id, "BTCUSD");
    assert.deepEqual(session.availableTimeframeIds, ["1m", "2m", "3m"]);
    assert.equal(service.snapshot().profiles[0].status, "ready");
    assert.equal(
      getProviderProfile(database, "profile-a")?.displayName,
      "Primary account",
    );
    assert.equal(credentialWrites.length, 1);

    const updated = await service.update({
      profileId: "profile-a",
      displayName: "Renamed account",
      settings: { region: "us" },
    });
    assert.equal(updated.displayName, "Renamed account");
    assert.deepEqual(updated.settings, { region: "us" });

    await service.stop("profile-a");
    assert.equal(service.snapshot().profiles[0].status, "stopped");
    await service.start("profile-a");
    assert.equal(service.snapshot().profiles[0].status, "ready");
    const derivedSession = await service.load({
      profileId: "profile-a",
      instrumentId: "BTCUSD",
      timeframeId: "3m",
    });
    assert.equal(derivedSession.timeframeId, "3m");
    const historyCalls = calls.filter(([kind]) => kind === "history");
    assert.equal(historyCalls.at(-1)[1], "profile-a");
    assert.equal(historyCalls.at(-1)[2].timeframeId, "3m");
    await service.delete("profile-a");
    assert.deepEqual(service.snapshot().profiles, []);
    assert.equal(getProviderProfile(database, "profile-a"), undefined);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
