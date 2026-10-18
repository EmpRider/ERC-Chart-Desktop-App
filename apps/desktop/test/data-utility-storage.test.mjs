import assert from "node:assert/strict";
import test from "node:test";
import { createDataUtilityStorage } from "../dist/data-utility-storage.js";

test("maps profile and plugin persistence onto data utility commands", async () => {
  const calls = [];
  const client = {
    async request(operation, payload) {
      calls.push([operation, payload]);
      if (operation === "profile-get") return null;
      if (operation === "profile-list" || operation === "plugin-list")
        return [];
      return true;
    },
  };
  const storage = createDataUtilityStorage(client);

  assert.deepEqual(await storage.listProviderProfiles(), []);
  assert.equal(await storage.getProviderProfile("profile-a"), undefined);
  assert.deepEqual(await storage.listPlugins(), []);
  assert.equal(await storage.deleteProviderProfile("profile-a"), true);
  assert.equal(
    await storage.deletePlugin("erc.provider.fixture", "1.0.0"),
    true,
  );

  assert.deepEqual(calls, [
    ["profile-list", null],
    ["profile-get", { profileId: "profile-a" }],
    ["plugin-list", null],
    ["profile-delete", { profileId: "profile-a" }],
    ["plugin-delete", { pluginId: "erc.provider.fixture", version: "1.0.0" }],
  ]);
});
