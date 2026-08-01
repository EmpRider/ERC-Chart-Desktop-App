import path from "node:path";
import applicationManifest from "../../package.json" with { type: "json" };

export const applicationVersion = validateReleaseVersion(
  applicationManifest.version,
);
export const productName = "ERC Chart";
const installationDirectoryName = validateInstallationDirectoryName(
  applicationManifest.name,
);

export function validateInstallationDirectoryName(name) {
  const windowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  if (
    typeof name !== "string" ||
    !/^[a-z0-9][a-z0-9-]*$/.test(name) ||
    windowsReservedName.test(name)
  ) {
    throw new Error("Invalid installation directory name.");
  }
  return name;
}

export function validateReleaseVersion(version) {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/.test(
      version,
    )
  ) {
    throw new Error("Invalid release version.");
  }
  return version;
}

export function releaseTag(version) {
  return `v${validateReleaseVersion(version)}`;
}

export function installerArtifactName(version) {
  return `ERC-Chart-Setup-${validateReleaseVersion(version)}.exe`;
}

export function installedExecutablePath(localAppData) {
  if (typeof localAppData !== "string" || localAppData.trim() === "") {
    throw new Error("LOCALAPPDATA is required.");
  }
  return path.join(
    localAppData,
    "Programs",
    installationDirectoryName,
    `${productName}.exe`,
  );
}

export function packagedElectronArguments(userDataPath) {
  if (typeof userDataPath !== "string" || userDataPath.trim() === "") {
    throw new Error("A smoke profile path is required.");
  }
  return [`--user-data-dir=${userDataPath}`, "--erc-chart-smoke"];
}

export function assertPackagedVersion(version) {
  if (version !== applicationVersion) {
    throw new Error("Packaged application version does not match the release.");
  }
}

export function assertReleaseTargetsCommit(release, commitSha) {
  if (release.target_commitish !== commitSha) {
    throw new Error("Existing release targets a different commit.");
  }
}

export function isReleaseAssetNameConflict(response) {
  return (
    Array.isArray(response?.errors) &&
    response.errors.some((error) => error?.code === "already_exists")
  );
}

export function assertReleaseAssetUploaded(response) {
  if (!Number.isSafeInteger(response?.id) || response.id <= 0) {
    throw new Error("Release asset upload was rejected.");
  }
}

export function checksumLine(digest, fileName) {
  if (!/^[a-f0-9]{64}$/i.test(digest)) {
    throw new Error("Invalid SHA-256 digest.");
  }
  if (path.basename(fileName) !== fileName || fileName.trim() === "") {
    throw new Error("Invalid checksum filename.");
  }
  return `${digest.toLowerCase()}  ${fileName}\n`;
}
