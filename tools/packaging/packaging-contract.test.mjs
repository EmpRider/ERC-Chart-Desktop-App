import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { electronFusePolicy } from "../../packages/electron-main/dist/index.js";
import builderConfiguration from "./electron-builder.config.mjs";
import {
  applicationVersion,
  assertReleaseTargetsCommit,
  assertPackagedVersion,
  checksumLine,
  installedExecutablePath,
  installerArtifactName,
  packagedElectronArguments,
  releaseTag,
  validateReleaseVersion,
} from "./packaging-contract.mjs";

test("defines Development Version 1 release identity", () => {
  assert.equal(applicationVersion, "0.1.0-dev.1");
  assert.equal(releaseTag(applicationVersion), "v0.1.0-dev.1");
  assert.equal(
    installerArtifactName(applicationVersion),
    "ERC-Chart-Setup-0.1.0-dev.1.exe",
  );
});

test("rejects versions outside the exact release-safe SemVer subset", () => {
  for (const value of ["", "v0.1.0", "0.1", "0.1.0/evil", "01.1.0"]) {
    assert.throws(() => validateReleaseVersion(value), /release version/i);
  }
});

test("configures one unsigned per-user x64 NSIS installer without updates", () => {
  assert.equal(builderConfiguration.productName, "ERC Chart");
  assert.equal(builderConfiguration.win.target[0].target, "nsis");
  assert.deepEqual(builderConfiguration.win.target[0].arch, ["x64"]);
  assert.equal(builderConfiguration.nsis.perMachine, false);
  assert.equal(builderConfiguration.nsis.allowElevation, false);
  assert.equal(builderConfiguration.nsis.differentialPackage, false);
  assert.equal(builderConfiguration.publish, null);
  assert.equal(
    builderConfiguration.artifactName,
    "ERC-Chart-Setup-${version}.${ext}",
  );
});

test("applies the immutable desktop fuse policy during packaging", () => {
  assert.deepEqual(builderConfiguration.electronFuses, electronFusePolicy);
  assert.equal(Object.isFrozen(electronFusePolicy), true);
});

test("resolves the installed executable beneath LOCALAPPDATA", () => {
  const localAppData = path.resolve("C:/Users/test/AppData/Local");
  const executablePath = installedExecutablePath(localAppData);

  assert.equal(
    executablePath,
    path.join(localAppData, "Programs", "ERC Chart", "ERC Chart.exe"),
  );
  assert.throws(() => installedExecutablePath(""), /LOCALAPPDATA/);
});

test("creates packaged smoke arguments without a development entry path", () => {
  assert.deepEqual(packagedElectronArguments("C:/Temp/profile"), [
    "--user-data-dir=C:/Temp/profile",
    "--erc-chart-smoke",
  ]);
  assert.throws(() => packagedElectronArguments(""), /profile/);
});

test("requires the packaged ASAR manifest to carry the release version", () => {
  assert.doesNotThrow(() => assertPackagedVersion("0.1.0-dev.1"));
  assert.throws(() => assertPackagedVersion("0.1.0"), /Packaged application/);
});

test("writes a conventional SHA-256 checksum line", () => {
  assert.equal(
    checksumLine("a".repeat(64), "ERC-Chart-Setup-0.1.0-dev.1.exe"),
    `${"a".repeat(64)}  ERC-Chart-Setup-0.1.0-dev.1.exe\n`,
  );
  assert.throws(() => checksumLine("not-a-digest", "setup.exe"), /SHA-256/);
  assert.throws(() => checksumLine("a".repeat(64), "../setup.exe"), /filename/);
});

test("rejects an existing release that targets another commit", () => {
  const commitSha = "a".repeat(40);

  assert.doesNotThrow(() =>
    assertReleaseTargetsCommit({ target_commitish: commitSha }, commitSha),
  );
  assert.throws(
    () =>
      assertReleaseTargetsCommit(
        { target_commitish: "b".repeat(40) },
        commitSha,
      ),
    /different commit/i,
  );
});
