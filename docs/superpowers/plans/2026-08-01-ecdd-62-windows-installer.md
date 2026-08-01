# ECDD-62 implementation plan

1. Add failing tests for the standalone staging directory, packaging contract,
   installer smoke helpers, checksum, and release version validation.
2. Pin electron-builder and implement deterministic staging plus NSIS x64
   configuration with the ECDD-58 fuse policy.
3. Replace the deferred package and installer-smoke commands with real Windows
   implementations and document the commands and unsigned limitation.
4. Add the serialized least-privilege `main` release workflow, exact SHA and
   version collision checks, checksum creation, draft upload, and final
   pre-release publication.
5. Run formatting, lint, typecheck, unit/integration tests, build, audit, version
   checks, and the canonical Windows package/smoke jobs through GitHub Actions.
