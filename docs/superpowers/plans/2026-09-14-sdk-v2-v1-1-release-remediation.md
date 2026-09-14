# SDK v2 v1.1.0 Release Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the merged SDK v2 delivery a unique `1.1.0` release identity and fail earlier when a release-relevant epic reuses an already-published application version.

**Architecture:** Keep the release contract rooted in the root manifest. Add an offline preflight that compares the current application version with the latest reachable release tag in repository history, then run that preflight before the expensive Windows release build. Update the manifest/lockfile, changelog, release notes, and release-facing documentation together so the generated installer, Git tag, and human release context all describe the SDK v2 delivery.

**Tech Stack:** Node.js 26.8.1, npm 12.0.2, Node test runner, GitHub Actions, Electron Builder/NSIS.

**Spec:** `docs/superpowers/specs/2026-07-30-github-delivery-workflow-design.md` (Section 11 version policy) and Jira ECDD-235.

## Global Constraints

- Application versions use SemVer without `v`; Git tags use `vX.Y.Z`.
- No released version may be reused or retargeted.
- The current post-`1.0.0` SDK v2 feature delivery is `1.1.0` / `v1.1.0`.
- Preserve the existing task -> epic -> main branch direction.
- Do not make speculative data-utility changes; the exact merged SHA passed installer smoke on rerun.
- Production behavior changes follow RED -> GREEN -> regression verification.

---

### Task 1: Fail early on reused release versions

**Files:**

- Modify: `tools/packaging/packaging-contract.mjs`
- Modify: `tools/packaging/packaging-contract.test.mjs`
- Modify: `.github/workflows/release.yml`

**Interfaces:**

- Consumes: `applicationVersion`, release tags reachable from git history.
- Produces: `assertReleaseVersionAdvances(version, releasedVersions)` that rejects equal/older released versions and accepts a strictly newer SemVer version.

- [x] **Step 1: Write the failing test**

Add focused cases showing `1.0.0` is rejected when `1.0.0` is already released, `0.9.9` is rejected as older, and `1.1.0` is accepted when the latest released version is `1.0.0`.

- [x] **Step 2: Run the focused packaging-contract test and verify RED**

Run: `node --test tools/packaging/packaging-contract.test.mjs`

Expected: FAIL because `assertReleaseVersionAdvances` does not exist.

- [x] **Step 3: Implement the minimal SemVer comparison helper**

Parse the release-safe SemVer subset already accepted by `validateReleaseVersion`; compare major/minor/patch and prerelease precedence without introducing a dependency.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tools/packaging/packaging-contract.test.mjs`

Expected: PASS.

- [x] **Step 5: Wire the preflight into the release workflow**

Before dependency installation, collect version tags from git history and invoke the helper against `applicationVersion`. The preflight must fail before package/test work if the current version is not newer than the latest released tag.

### Task 2: Promote the SDK v2 delivery to v1.1.0

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tools/packaging/packaging-contract.test.mjs`
- Modify: `CHANGELOG.md`
- Modify: `tools/packaging/publish-release.mjs`
- Modify: `docs/development/MONOREPO.md`

**Interfaces:**

- Produces: application version `1.1.0`, tag `v1.1.0`, installer `ERC-Chart-Setup-1.1.0.exe`.

- [x] **Step 1: Update release identity fixtures to `1.1.0`**

Change exact identity assertions and checksum fixture names in `packaging-contract.test.mjs`.

- [x] **Step 2: Verify the fixture fails against the old manifest**

Run: `node --test tools/packaging/packaging-contract.test.mjs`

Expected: FAIL because the manifest still reports `1.0.0`.

- [x] **Step 3: Update root manifest and lockfile to `1.1.0`**

Change only the root application version entries; workspace package versions remain `0.0.0`.

- [x] **Step 4: Update release-facing text**

Add a `1.1.0` SDK v2 changelog entry, replace stale Plugin Manager curated notes in `publish-release.mjs` with SDK v2 release notes, and update `MONOREPO.md` source/release identity references.

- [x] **Step 5: Verify focused release tests and version gate**

Run: `node --test tools/packaging/packaging-contract.test.mjs`
Run: `npm run version:check`

Expected: PASS.

### Task 3: Reassess SDK v2 completion evidence

**Files:**

- Modify only if evidence is stale: `docs/development/INDICATOR-SDK-V2-CURRENT-STATE.md`
- Modify only if evidence is stale: `docs/superpowers/plans/2026-09-09-indicator-sdk-v2-redesign-implementation.md`

- [x] **Step 1: Read both SDK v2 status/plan documents after Tasks 1-2**

Confirm whether implementation claims remain true and distinguish implementation completion from release publication state.

- [x] **Step 2: Record only necessary release-state corrections**

If needed, state that PR #161 merged, Windows build/installer verification passed on rerun, and publication continues under ECDD-235 with `v1.1.0`; do not rewrite completed implementation claims.

### Task 4: Full verification and delivery

- [x] **Step 1: Run formatting, lint, typecheck, focused/unit/integration/version checks**

Run the repository-required gates relevant to the changed release path.

- [ ] **Step 2: Run release/package gates when the branch reaches the epic/main acceptance boundary**

Verify Windows packaging, installer smoke, checksum, and release identity on the reviewed head.

- [ ] **Step 3: Commit/push and open the task -> epic PR**

Commit format: `ECDD-235: publish SDK v2 as v1.1.0`.

- [ ] **Step 4: After task merge, run the required epic -> main review sequence**

Do not publish or retarget `v1.0.0`. The successful release must create `v1.1.0` from the exact accepted `main` commit.

## Execution evidence

The first CI attempt for the RED commit stopped at PR metadata validation before application tests. The PR body was corrected without changing the RED test; this documentation-only commit exists solely to trigger a fresh pull-request event that sees the corrected contract. A second fresh event reached Markdown lint and exposed only MD032 blank-line errors in this plan; this commit fixes those formatting errors without changing the RED test.
