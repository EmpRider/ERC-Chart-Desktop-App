import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const diagnosticsModule = await import("../dist/index.js").catch(
  () => undefined,
);

async function withLogDirectory(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "erc-diagnostics-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("redacts secrets before writing structured local diagnostics", async () => {
  assert.ok(diagnosticsModule, "Local diagnostic log module must exist");
  await withLogDirectory(async (directory) => {
    const log = diagnosticsModule.createLocalDiagnosticLog({
      directory,
      now: () => new Date("2026-08-25T12:00:00.000Z"),
    });

    await log.write({
      level: "error",
      code: "provider.authentication.failed",
      metadata: {
        authorization: "Bearer header-secret",
        authorizationHeader: "Basic secondary-header-secret",
        apiKey: "api-key-secret",
        cookie: "session=cookie-secret",
        rawProviderFrame: "provider-frame-secret",
        endpoint:
          "https://example.test/feed?instrument=EURUSD&token=query-secret&api_key=query-api-key-secret",
        detail: "Authorization: Basic inline-secret",
        nested: { deviceId: "device-secret" },
      },
    });

    const content = await readFile(
      path.join(directory, "erc-chart.log"),
      "utf8",
    );
    for (const secret of [
      "header-secret",
      "secondary-header-secret",
      "api-key-secret",
      "cookie-secret",
      "provider-frame-secret",
      "query-secret",
      "query-api-key-secret",
      "inline-secret",
      "device-secret",
    ]) {
      assert.equal(content.includes(secret), false);
    }
    assert.deepEqual(JSON.parse(content), {
      occurredAt: "2026-08-25T12:00:00.000Z",
      level: "error",
      code: "provider.authentication.failed",
      metadata: {
        authorization: "[REDACTED]",
        authorizationHeader: "[REDACTED]",
        apiKey: "[REDACTED]",
        cookie: "[REDACTED]",
        rawProviderFrame: "[REDACTED]",
        endpoint:
          "https://example.test/feed?instrument=EURUSD&token=%5BREDACTED%5D&api_key=%5BREDACTED%5D",
        detail: "Authorization: [REDACTED]",
        nested: { deviceId: "[REDACTED]" },
      },
    });
  });
});

test("rotates bounded local logs and removes the oldest generation", async () => {
  assert.ok(diagnosticsModule, "Local diagnostic log module must exist");
  await withLogDirectory(async (directory) => {
    const log = diagnosticsModule.createLocalDiagnosticLog({
      directory,
      maxBytes: 300,
      maxFiles: 3,
    });

    for (let sequence = 1; sequence <= 4; sequence += 1) {
      await log.write({
        level: "info",
        code: "diagnostic.rotation",
        metadata: { sequence, padding: "x".repeat(100) },
      });
    }

    assert.deepEqual((await readdir(directory)).sort(), [
      "erc-chart.log",
      "erc-chart.log.1",
      "erc-chart.log.2",
    ]);
    const sequences = await Promise.all(
      ["erc-chart.log", "erc-chart.log.1", "erc-chart.log.2"].map(
        async (name) =>
          JSON.parse(await readFile(path.join(directory, name), "utf8"))
            .metadata.sequence,
      ),
    );
    assert.deepEqual(sequences, [4, 3, 2]);
  });
});

test("serializes concurrent writes into complete JSON lines", async () => {
  assert.ok(diagnosticsModule, "Local diagnostic log module must exist");
  await withLogDirectory(async (directory) => {
    const log = diagnosticsModule.createLocalDiagnosticLog({ directory });
    await Promise.all(
      Array.from({ length: 20 }, (_, sequence) =>
        log.write({
          level: "info",
          code: "diagnostic.concurrent-write",
          metadata: { sequence },
        }),
      ),
    );

    const lines = (
      await readFile(path.join(directory, "erc-chart.log"), "utf8")
    )
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(lines.length, 20);
    assert.deepEqual(
      lines.map(({ metadata }) => metadata.sequence),
      Array.from({ length: 20 }, (_, sequence) => sequence),
    );
  });
});

test("rejects invalid diagnostic events before writing", async () => {
  assert.ok(diagnosticsModule, "Local diagnostic log module must exist");
  await withLogDirectory(async (directory) => {
    const log = diagnosticsModule.createLocalDiagnosticLog({ directory });
    await assert.rejects(
      log.write({ level: "verbose", code: "bad code", metadata: {} }),
      /Invalid diagnostic level/,
    );
    assert.deepEqual(await readdir(directory), []);
  });
});
