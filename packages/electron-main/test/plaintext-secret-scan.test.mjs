import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createProviderProfile,
  openStorageDatabase,
  saveWorkspace,
  serializeWorkspaceV1,
} from "../../storage/dist/index.js";
import {
  createLocalDiagnosticLog,
  createWindowsGenericCredentialManager,
  windowsCredentialTarget,
} from "../dist/index.js";

function inspectCredentialChild(stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({argv:process.argv,environment:process.env})))",
      ],
      { shell: false, stdio: ["pipe", "pipe", "inherit"] },
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`Credential child exited with code ${code}.`));
    });
    child.stdin.end(stdin, "utf8");
  });
}

async function readDirectory(directory) {
  const artifacts = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory())
      artifacts.push(...(await readDirectory(entryPath)));
    else artifacts.push(await readFile(entryPath));
  }
  return artifacts;
}

test("keeps a plaintext credential out of persisted and process artifacts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "erc-secret-scan-"));
  const secret = `scan-${randomBytes(24).toString("base64url")}`;
  const databasePath = path.join(directory, "erc-chart.sqlite3");
  const logDirectory = path.join(directory, "logs");
  const target = windowsCredentialTarget("binomo", "primary");
  const workspace = {
    schemaVersion: 1,
    id: "workspace-default",
    name: "Default Workspace",
    activeTabId: "tab-main",
    tabs: [
      {
        id: "tab-main",
        title: "Main",
        layout: "grid-1",
        chartSlots: [
          {
            id: "chart-1",
            providerProfileId: "primary",
            instrumentId: "Z-CRY/IDX",
            timeframeSeconds: 60,
            chartType: "candlestick",
            viewport: {
              visibleBars: 120,
              rightOffsetBars: 0,
              priceScaleMode: "auto",
            },
            indicators: [],
          },
        ],
      },
    ],
    savedAtMs: 1_785_398_400_000,
  };

  try {
    let childArtifacts = "";
    const credentials = createWindowsGenericCredentialManager({
      platform: "win32",
      run: async (request) => {
        childArtifacts = await inspectCredentialChild(JSON.stringify(request));
        return { ok: true };
      },
    });
    await credentials.write(target, secret);

    const database = await openStorageDatabase(databasePath);
    try {
      assert.throws(
        () =>
          createProviderProfile(database, {
            id: "unsafe",
            providerId: "binomo",
            displayName: "Unsafe account",
            credentialReference: windowsCredentialTarget("binomo", "unsafe"),
            token: secret,
          }),
        /Unsupported provider profile field: token/,
      );
      createProviderProfile(database, {
        id: "primary",
        providerId: "binomo",
        displayName: "Primary account",
        credentialReference: target,
      });
      saveWorkspace(database, workspace, "desktop-instance-1");
    } finally {
      database.close();
    }

    const log = createLocalDiagnosticLog({ directory: logDirectory });
    await log.write({
      level: "error",
      code: "provider.authentication.failed",
      metadata: { token: secret },
    });

    const artifacts = [
      ...(await readDirectory(directory)),
      ...(await readDirectory(logDirectory)),
      Buffer.from(serializeWorkspaceV1(workspace)),
      Buffer.from(childArtifacts),
      Buffer.from(
        JSON.stringify({
          argv: process.argv,
          environment: process.env,
        }),
      ),
    ];
    for (const artifact of artifacts)
      assert.equal(artifact.includes(secret), false, "plaintext secret leaked");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
