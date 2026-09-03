import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { electronFusePolicy } from "../../packages/electron-main/dist/index.js";
import builderConfiguration from "./electron-builder.config.mjs";
import {
  applicationVersion,
  assertReleaseAssetUploaded,
  assertReleaseTargetsCommit,
  assertPackagedVersion,
  checksumLine,
  composeReleaseNotes,
  installedExecutablePath,
  installerArtifactName,
  isReleaseAssetNameConflict,
  packageIdentityName,
  packagedElectronArguments,
  releaseTag,
  validateInstallationDirectoryName,
  validateReleaseVersion,
} from "./packaging-contract.mjs";

test("defines klinecharts architecture release identity", () => {
  assert.equal(applicationVersion, "0.3.0");
  assert.equal(packageIdentityName, "erc-chart-desktop-app");
  assert.equal(releaseTag(applicationVersion), "v0.3.0");
  assert.equal(
    installerArtifactName(applicationVersion),
    "ERC-Chart-Setup-0.3.0.exe",
  );
});

test("rejects versions outside the exact release-safe SemVer subset", () => {
  for (const value of [
    "",
    "v0.1.0",
    "0.1",
    "0.1.0/evil",
    "01.1.0",
    "0.1.0-01",
    "0.1.0-alpha.01",
  ]) {
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
    path.join(
      localAppData,
      "Programs",
      "erc-chart-desktop-app",
      "ERC Chart.exe",
    ),
  );
  assert.throws(() => installedExecutablePath(""), /LOCALAPPDATA/);
});

test("rejects Windows-reserved installation directory names", () => {
  assert.equal(
    validateInstallationDirectoryName("erc-chart-desktop-app"),
    "erc-chart-desktop-app",
  );
  for (const name of ["con", "PrN", "AUX", "nul", "CoM9", "lPt1"]) {
    assert.throws(
      () => validateInstallationDirectoryName(name),
      /installation directory/i,
    );
  }
});

test("creates packaged smoke arguments without a development entry path", () => {
  assert.deepEqual(packagedElectronArguments("C:/Temp/profile"), [
    "--user-data-dir=C:/Temp/profile",
    "--erc-chart-smoke",
  ]);
  assert.throws(() => packagedElectronArguments(""), /profile/);
});

test("requires the packaged ASAR manifest to carry the release version", () => {
  assert.doesNotThrow(() => assertPackagedVersion("0.3.0"));
  assert.throws(
    () => assertPackagedVersion("0.1.0-dev.1"),
    /Packaged application/,
  );
});

test("writes a conventional SHA-256 checksum line", () => {
  assert.equal(
    checksumLine("a".repeat(64), "ERC-Chart-Setup-0.3.0.exe"),
    `${"a".repeat(64)}  ERC-Chart-Setup-0.3.0.exe\n`,
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

test("preserves curated release context and appends generated changes", () => {
  assert.equal(
    composeReleaseNotes(
      "# Development Version 2\n\nUnsigned prerelease.\n",
      "## What's Changed\n\n* Add the secure shell by @EmpRider in #21\n",
    ),
    "# Development Version 2\n\nUnsigned prerelease.\n\n## What's Changed\n\n* Add the secure shell by @EmpRider in #21\n",
  );
  assert.equal(
    composeReleaseNotes("Release context\n", ""),
    "Release context\n",
  );
  for (const curated of ["", " \n\t "]) {
    assert.throws(
      () => composeReleaseNotes(curated, "Generated changes"),
      /curated release notes/i,
    );
  }
});

test("recognizes only GitHub's existing-asset name conflict", () => {
  assert.equal(
    isReleaseAssetNameConflict({
      errors: [{ resource: "ReleaseAsset", code: "already_exists" }],
    }),
    true,
  );
  assert.equal(
    isReleaseAssetNameConflict({ errors: [{ code: "invalid" }] }),
    false,
  );
  assert.equal(isReleaseAssetNameConflict(undefined), false);
});

test("rejects an upload response without a created release asset", () => {
  assert.doesNotThrow(() => assertReleaseAssetUploaded({ id: 42 }));
  assert.throws(
    () => assertReleaseAssetUploaded({ errors: [{ code: "invalid" }] }),
    /upload was rejected/i,
  );
});
