import path from "node:path";
import applicationManifest from "../../package.json" with { type: "json" };

export const applicationVersion = validateReleaseVersion(
  applicationManifest.version,
);
export const productName = "ERC Chart";
export const packageIdentityName = validateInstallationDirectoryName(
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
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/.test(
      version,
    )
  ) {
    throw new Error("Invalid release version.");
  }
  return version;
}

function parseReleaseVersion(version) {
  const validatedVersion = validateReleaseVersion(version);
  const [core, prerelease] = validatedVersion.split("-", 2);
  const [major, minor, patch] = core.split(".").map(BigInt);
  return {
    major,
    minor,
    patch,
    prerelease: prerelease?.split(".") ?? null,
  };
}

function comparePrereleaseIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);

  if (leftNumeric && rightNumeric) {
    const leftValue = BigInt(left);
    const rightValue = BigInt(right);
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
    return 0;
  }
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareReleaseVersions(leftVersion, rightVersion) {
  const left = parseReleaseVersion(leftVersion);
  const right = parseReleaseVersion(rightVersion);

  for (const key of ["major", "minor", "patch"]) {
    if (left[key] < right[key]) return -1;
    if (left[key] > right[key]) return 1;
  }

  if (left.prerelease === null && right.prerelease === null) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;

  const identifierCount = Math.max(
    left.prerelease.length,
    right.prerelease.length,
  );
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const comparison = comparePrereleaseIdentifiers(
      leftIdentifier,
      rightIdentifier,
    );
    if (comparison !== 0) return comparison;
  }
  return 0;
}

export function assertReleaseVersionAdvances(version, releasedVersions) {
  const validatedVersion = validateReleaseVersion(version);
  if (!Array.isArray(releasedVersions)) {
    throw new Error("Released versions must be an array.");
  }

  const hasEqualOrNewerRelease = releasedVersions.some(
    (releasedVersion) =>
      compareReleaseVersions(validatedVersion, releasedVersion) <= 0,
  );
  if (hasEqualOrNewerRelease) {
    throw new Error("Release version must be newer than the latest release.");
  }
  return validatedVersion;
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
  return path.join(localAppData, packageIdentityName, `${productName}.exe`);
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

export function composeReleaseNotes(curatedNotes, generatedNotes) {
  const curated = curatedNotes.trim();
  const generated = generatedNotes.trim();
  if (curated === "") throw new Error("Curated release notes are required.");
  return `${curated}${generated === "" ? "" : `\n\n${generated}`}\n`;
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
