import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

const credentialsModule = await import("../dist/windows-credentials.js").catch(
  () => undefined,
);

test("builds only stable provider credential targets", () => {
  assert.ok(credentialsModule, "Windows credential module must exist");
  assert.equal(
    credentialsModule.windowsCredentialTarget("binomo", "primary"),
    "ERC-chart/provider/binomo/primary",
  );
  for (const segments of [
    ["", "primary"],
    [undefined, "primary"],
    ["binomo", "../primary"],
    ["binomo/account", "primary"],
    [" binomo", "primary"],
  ]) {
    assert.throws(() => credentialsModule.windowsCredentialTarget(...segments));
  }
});

test("validates targets and secrets before invoking the bridge", async () => {
  assert.ok(credentialsModule, "Windows credential module must exist");
  const requests = [];
  const manager = credentialsModule.createWindowsGenericCredentialManager({
    platform: "win32",
    run: async (request) => {
      requests.push(request);
      if (request.operation === "read") return { found: false };
      if (request.operation === "delete") return { deleted: false };
      return { ok: true };
    },
  });

  await assert.rejects(
    manager.write("raw-target", "secret"),
    /credential target/i,
  );
  await assert.rejects(
    manager.write("ERC-chart/provider/binomo/primary", ""),
    /secret/i,
  );
  assert.equal(requests.length, 0);

  const target = "ERC-chart/provider/binomo/primary";
  const testSecret = randomBytes(12).toString("base64url");
  await manager.write(target, testSecret);
  assert.equal(await manager.read(target), undefined);
  assert.equal(await manager.delete(target), false);
  assert.deepEqual(requests, [
    { operation: "write", target, secret: testSecret },
    { operation: "read", target },
    { operation: "delete", target },
  ]);
});

test("rejects malformed bridge responses", async () => {
  assert.ok(credentialsModule, "Windows credential module must exist");
  const target = "ERC-chart/provider/binomo/primary";
  const manager = credentialsModule.createWindowsGenericCredentialManager({
    platform: "win32",
    run: async () => ({}),
  });

  const testSecret = randomBytes(12).toString("base64url");
  await assert.rejects(manager.write(target, testSecret), /invalid data/i);
  await assert.rejects(manager.read(target), /invalid data/i);
  await assert.rejects(manager.delete(target), /invalid data/i);
});

test("fails closed outside Windows", async () => {
  assert.ok(credentialsModule, "Windows credential module must exist");
  let invoked = false;
  const manager = credentialsModule.createWindowsGenericCredentialManager({
    platform: "linux",
    run: async () => {
      invoked = true;
      return {};
    },
  });

  await assert.rejects(
    manager.read("ERC-chart/provider/binomo/primary"),
    new Error("Windows Credential Manager is unavailable on this platform."),
  );
  assert.equal(invoked, false);
});

test(
  "creates, reads, replaces, and deletes a Windows Generic Credential",
  { skip: process.platform !== "win32" },
  async () => {
    assert.ok(credentialsModule, "Windows credential module must exist");
    const manager = credentialsModule.createWindowsGenericCredentialManager();
    const target = credentialsModule.windowsCredentialTarget(
      "integration-test",
      randomUUID(),
    );
    const firstSecret = `${randomBytes(24).toString("base64url")}-秘密`;
    const replacementSecret = randomBytes(24).toString("base64url");

    try {
      assert.equal(await manager.read(target), undefined);
      await manager.write(target, firstSecret);
      assert.equal(await manager.read(target), firstSecret);
      await manager.write(target, replacementSecret);
      assert.equal(await manager.read(target), replacementSecret);
      assert.equal(await manager.delete(target), true);
      assert.equal(await manager.read(target), undefined);
      assert.equal(await manager.delete(target), false);
    } finally {
      await manager.delete(target).catch(() => undefined);
    }
  },
);
