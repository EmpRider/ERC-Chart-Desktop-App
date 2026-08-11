import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  applicationVersion,
  assertReleaseAssetUploaded,
  assertReleaseTargetsCommit,
  composeReleaseNotes,
  installerArtifactName,
  isReleaseAssetNameConflict,
  releaseTag,
} from "./packaging-contract.mjs";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const commitSha = process.env.GITHUB_SHA;
if (!token || !repository || !/^[a-f0-9]{40}$/i.test(commitSha ?? "")) {
  throw new Error("GitHub release identity is unavailable.");
}

const [owner, repo] = repository.split("/");
if (!owner || !repo) throw new Error("Invalid GitHub repository identity.");

const apiRoot = `https://api.github.com/repos/${owner}/${repo}`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "erc-chart-release",
};

async function request(url, options = {}, acceptedStatuses = [200]) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  if (!acceptedStatuses.includes(response.status)) {
    throw new Error(
      `GitHub release request failed (${response.status} ${response.statusText}).`,
    );
  }
  if (response.status === 204) return undefined;
  return response.json();
}

const tag = releaseTag(applicationVersion);
const releases = await request(`${apiRoot}/releases?per_page=100`);
const matchingRelease = releases.find((release) => release.tag_name === tag);
const tagResponse = await fetch(
  `${apiRoot}/git/ref/tags/${encodeURIComponent(tag)}`,
  { headers },
);
if (![200, 404].includes(tagResponse.status)) {
  throw new Error(`Git tag lookup failed (${tagResponse.status}).`);
}

if (matchingRelease !== undefined) {
  assertReleaseTargetsCommit(matchingRelease, commitSha);
}
if (matchingRelease !== undefined && matchingRelease.draft !== true) {
  console.log(`${tag} is already published; no release is required.`);
  process.exit(0);
}
if (tagResponse.status === 200 && matchingRelease === undefined) {
  throw new Error(`Tag ${tag} exists without its release.`);
}
const curatedNotes = `# Development Version 2\n\nEpic: ECDD-67 (development checkpoint)\n\nThis unsigned prerelease advances the reviewed Epic 2 workspace experience. Each chart tab retains one permanent workspace, can add workspaces one at a time up to four, can close only added workspaces, and preserves the identities of surviving workspaces. The public renderer contract now also exposes the workspace limit.\n\nIt retains the reviewed secure desktop shell, custom renderer protocol, desktop trust boundaries, concurrent-instance behavior, and x64 per-user NSIS installer from Development Version 1.\n\nKnown limitations: chart rendering, data-provider connectivity, workspace persistence, database and credential integration, plugins, and production code signing are delivered by later work. Automatic updates are disabled. Epic 2 remains in development; stable v0.2.0 is not part of this checkpoint.\n`;
const generatedNotes = await request(
  `${apiRoot}/releases/generate-notes`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: commitSha,
    }),
  },
  [200],
);
const notes = composeReleaseNotes(curatedNotes, generatedNotes.body ?? "");
const release =
  matchingRelease ??
  (await request(
    `${apiRoot}/releases`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: commitSha,
        name: tag,
        body: notes,
        draft: true,
        prerelease: true,
      }),
    },
    [201],
  ));

const root = path.resolve(import.meta.dirname, "../..");
const installerName = installerArtifactName(applicationVersion);
const assets = await Promise.all(
  [installerName, `${installerName}.sha256`].map(async (assetName) => ({
    assetName,
    bytes: await readFile(path.join(root, "release", assetName)),
    priorAsset: release.assets.find((asset) => asset.name === assetName),
  })),
);
const uploadAsset = (assetName, bytes, acceptedStatuses) =>
  request(
    `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    },
    acceptedStatuses,
  );

for (const { assetName, bytes, priorAsset } of assets) {
  const upload = await uploadAsset(assetName, bytes, [201, 422]);
  if (isReleaseAssetNameConflict(upload)) {
    if (priorAsset === undefined) {
      throw new Error(`Release asset ${assetName} conflicts unexpectedly.`);
    }
    await request(
      `${apiRoot}/releases/assets/${priorAsset.id}`,
      { method: "DELETE" },
      [204],
    );
    await uploadAsset(assetName, bytes, [201]);
  } else {
    assertReleaseAssetUploaded(upload);
  }
}

const published = await request(`${apiRoot}/releases/${release.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: tag,
    body: notes,
    draft: false,
    prerelease: true,
    target_commitish: commitSha,
  }),
});
if (published.draft || published.tag_name !== tag) {
  throw new Error("GitHub release did not publish as requested.");
}
console.log(`Published ${tag} from ${commitSha}.`);
