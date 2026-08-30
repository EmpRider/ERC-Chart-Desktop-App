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
const curatedNotes = `# Toolchain and dependency update

This corrective release updates ERC Chart's supported runtime and development toolchain to the latest stable versions available at release time: Node.js 26.8.1, npm 12.0.2, Electron 44.0.0, TypeScript 7.0.2 native compiler, the TypeScript 6.0.2 compatibility API, React 19.2.8, and the repository's direct linting, formatting, packaging, parsing, and type packages.

The application behavior and Epic 2 capability scope are unchanged. Compatibility fixes are limited to TypeScript project configuration, package-script policy, and malformed project-reference validation required by the upgraded tools.

Known limitations: chart rendering, live market-data connectivity, plugin execution, automatic updates, and production code signing remain later work. The installer is unsigned.
`;
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
