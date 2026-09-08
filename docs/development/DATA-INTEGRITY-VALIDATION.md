# Data Integrity and Runtime: Phase 6 Validation

Date: 2026-09-08. Source: `0.3.6` plus the existing uncommitted implementation.
Base commit: `2e4a0f4fdeb6c110838a4748141bfd795d784f76`.

**Disposition: the two remaining automated Phase 6 engineering gaps are closed;
Phase 6 remains open for the explicit manual acceptance checks below.** A fresh
September 8 run rechecked the interrupted partial edits and passed the production
renderer metadata regression plus utility-owned upstream expiry/reclamation
coverage, 3/3 focused tests. The earlier 96-test resumption and immediately
preceding full-unit result remain historical evidence, not new runs. See
[September 8 resumption](#september-8-resumption) for exact commands and remaining
manual operator gates. Installer/provider approval and final hardware performance
acceptance remain separate release gates.

The [implementation plan](../superpowers/plans/2026-09-07-data-integrity-runtime-implementation.md)
defines the requirements. Phases 1–5 and **56/56** focused Phase 5 tests were
reported complete at handoff; that count is historical, not a result from this
validation. Existing dirty changes were preserved. No reset, stash, commit,
branch switch, project dependency installation or lockfile change was performed.
The follow-up downloaded npm `12.0.2` into npm's disposable execution cache;
global npm, package pins and the persistent environment were unchanged.

## Environment and reproduction

- Windows `10.0.26200`, x64; PowerShell.
- Intel Core i7-1165G7, eight logical CPUs, 16,936,132,608 bytes physical RAM.
  This is not the provisional four-core/8 GB/integrated-graphics benchmark
  configuration. Graphics/storage characteristics were not measured.
- `node --version`: `v26.8.1`, exit 0.
- Global `npm --version`: `11.14.1`, exit 0; required package manager is `12.0.2`.
  Initial runs used global npm; the follow-up used cache-local `12.0.2` and
  closed pinned-toolchain local validation without changing global tooling.
- Installed project build/runtime pins: TypeScript `7.0.2`, Electron `44.0.0`.
  Development builds, not packaged/installed binaries.
- Deterministic synthetic data and temporary databases/profiles only. No real
  provider connection, test account, external service or Signal source was used.
  The existing Windows Credential Manager test creates/removes synthetic test
  credentials; no real credential values are included here.

Run from `D:\Dhana\My project\Binomo\ERC-Chart-Desktop-App`. Each timing below
is PowerShell wall time, including npm/build overhead, rounded to two decimals.
Commands ran sequentially and stopped on nonzero exit for investigation.
Capture timing with `Diagnostics.Stopwatch`; preserve `$LASTEXITCODE` before
printing the result. Tests import `dist`, so build before focused tests.

## Earlier command evidence (historical)

Initial application-code validation, after the retention correction and scoped
formatting (superseded where noted by the pinned-npm follow-up below):

- `npm run build`: exit 0, 6.04 s.
- `npm run typecheck`: exit 0, 1.40 s.
- `npm run lint`: exit 0, 14.70 s; package boundaries valid.
- `node --test packages/data-service/test/*.test.mjs packages/storage/test/*.test.mjs packages/contracts/test/*.test.mjs`:
  exit 0, **109/109 passed**, 4.59 s; no skips/cancellations.
- `node --test packages/electron-main/test/*.test.mjs packages/preload/test/*.test.mjs apps/desktop/test/*.test.mjs packages/renderer/test/*.test.mjs`:
  exit 0, **182/182 passed**, 18.31 s; no skips/cancellations.
- `npm run test:unit`: exit 0, **479 passed, 2 skipped, 0 failed** of 481,
  31.74 s. The skips are Windows file-symlink fixtures in provider package
  staging and repository scanning; this account cannot create those links.
  Those cases remain unverified, rather than counted as passing.
- `npm run test:integration`: exit 0, **80/80 passed**, 3.45 s;
  no skips/cancellations.
- `npm run smoke:electron`: exit 0, 9.00 s on the final rerun. Includes real
  data-utility history/live, crash and restart assertions, followed by secure
  shell boot; the restarted PID must differ from both main and the old utility.
- `npm run smoke:workspace-restart`: exit 0, 11.36 s; seeded workspace
  persisted across two sequential application runs using one temporary profile.
- `npm run smoke:multi-instance`: exit 0, 9.86 s; two independent application
  processes with **isolated profiles/databases**, not shared SQLite.
- `npm run smoke:indicator-worker`: exit 0, 10.64 s; existing real sandboxed
  worker scenario, not twenty concurrent workers or a performance test.
- `npm run test:performance`: exit 0, 0.52 s, explicitly **NOT MEASURED**.
  This command prints disposition only; success is not performance acceptance.

- `npm run format:check`: exit 0, 11.21 s after source/documentation formatting.
- `node node_modules/prettier/bin/prettier.cjs --check docs/superpowers/plans/2026-09-07-data-integrity-runtime-implementation.md`:
  exit 0, 1.18 s; this plan directory is outside the root formatting scope.
- `git diff --check`: exit 0; no whitespace errors in the tracked diff.
- `node --test packages/provider-runtime/test/plugin-staging.test.mjs tools/delivery-governance/test/repository.test.mjs`:
  exit 0, 25 passed/2 skipped, confirming both file-symlink permission skips.

These groups overlap; their counts must not be added into a distinct-test total.
The earlier desktop-focused run failed 2 of 181 tests because its exact preload
allowlist omitted the already-implemented recovery methods. After correcting
those assertions and adding recovery validation, 182/182 passed.
The first lint run failed with ten style errors; the first formatting check
failed on 24 existing phase-change files. Those findings were corrected rather
than excluded from their gates.

## Corrections made during validation

- Count the building candle within the **100,000 active candles** ceiling.
  Retention now runs for building-only updates as well as finalized updates,
  trims the oldest finalized bar and publishes `retention-trimmed` with the
  current revision. Smaller explicitly configured finalized-history budgets
  retain their existing meaning; the product-wide active limit still applies.
- A runnable regression in `packages/data-service/test/candle-state.test.mjs`
  covers history, candle and tick ingress, retained first timestamp, building
  timestamp and published revision. Before the fix: 5 passed, 1 failed,
  `100001 !== 100000`. After the fix, the candle-state/provider-bridge/cache
  focused command passed **31/31** and the full commands above passed.
- Replace forbidden non-null assertions with narrowed local values in the
  history cache flow; change a preload object type to an interface; document
  intentional no-op fixture callbacks. No candle algorithm or transport
  architecture was replaced.
- Remove the obsolete workspace-recovery IPC/preload surface after switching to
  one canonical `last-workspace` document. Keep focused coverage that startup
  restores that document automatically and the renderer exposes no recovery UI.
- Apply Prettier only to files flagged in the existing phase changes and files
  touched for this validation. No formatter exclusions or lint suppression was
  added. Existing source/test changes remain intact.
- Replace the misleading performance scaffold output with an explicit
  unmeasured disposition; add the reproducible domain stress command below.

## Measured domain stress

Command: `node tools/data-integrity-stress.mjs`, following `npm run build`.
This assert-based command prints JSON measurements and exits nonzero on failed
correctness assertions. It uses no new dependency.

Fixture: 100,000 finalized native 1m bars; four logical consumers of one shared
source; 100 ticks/second for ten seconds, then 1,000 ticks/second for ten seconds;
10 ms scheduled batches, delayed batches retained rather than dropped; 100
acquire/release cycles and 20 invalidate/restore cycles. These are four consumers
of **one series**, not four independent chart datasets. No renderer, indicator
workers, SQLite cache or cross-process transport is included.

Before the retention correction, the same command exited **1**, 21.95 s:
100,000 finalized plus one building candle violated the product limit. All four
consumers received 11,000 ticks; 122 upstream acquisitions/releases balanced.

After the correction, it exited **0**, 21.65 s:

- **99,999 finalized + 1 building = 100,000 active candles**. Each consumer
  received exactly 11,000 ticks. The final building close and volume matched the
  fixture; the retained tick tail stayed within 4,096.
- One history request; 122 upstream acquisitions, 122 releases, zero active
  upstreams after cleanup; 100 acquire/release and 20 invalidate/restore cycles
  completed without reported provider errors.
- Initial synthetic history construction/load: 483.84 ms versus 405.86 ms in
  the pre-correction run. This is neither SQLite warm-open latency nor chart
  opening time, and is not evidence of an optimization.
- Normal phase: 1,000 ticks in 9,990.63 ms, 100.09 ticks/s; maximum synchronous
  dispatch 120.50 ms, maximum scheduling lag 110.58 ms. The initial retention
  rebuild is included. Pre-correction maxima were 21.10/47.59 ms respectively.
- Burst: 10,000 ticks in 9,990.27 ms, 1,000.97 ticks/s; maximum dispatch 0.59 ms,
  maximum scheduling lag 2.44 ms. Pre-correction maxima were 5.48/7.38 ms.
- Event-loop delay p95: 11.99 ms, versus 11.70 ms before correction. These
  single-run values are observational, not statistical performance acceptance.
- Process RSS: 65,200,128 bytes before, 424,554,496 after. Heap used:
  6,517,816 bytes before, 232,063,896 after. Snapshots/history remain referenced;
  no forced-GC plateau, per-cycle heap trend or multi-process total was measured.

The before/after comparison concerns this validation's retention correction,
**not** the phases 1–5 process cutover. No pre-cutover application performance
baseline exists. Active upstream counts do not prove every internal timer,
listener, queue or retained object has been released.

## Process, persistence and boundary evidence

- `tools/electron-data-utility-smoke.mjs` now keeps live demand and a sandboxed
  production renderer active while killing the real utility with pending
  history, a lock-blocked workspace write and upstream subscription. All three
  commands reject; the DOM displays **Live data stale**, and adding a chart
  still works. A fresh utility PID differs from main and the old PID; delayed
  old callbacks release their upstream handles, the last acknowledged workspace
  survives, and fresh history succeeds. The renderer window is closed before
  restart: this proves visible crash handling and fresh-client recovery, not
  automatic reconnection of the same window. The write is blocked before
  acknowledgement, not killed at a controlled fsync instruction.
- Cache regressions use three-bar explicit finalized ranges, a single missing
  middle bar, freshness-tail requests, derived native constituents, malformed
  cache fallback and exclusion of building bars. The follow-up upgrades native
  and derived warm checks to separate Node processes, asserts distinct PIDs,
  zero upstream history calls and complete candle-array equality, including OHLCV.
- Storage tests exercise actual temporary SQLite files, migration versions
  1/2/3, disposable cache rebuilding, workspace preservation, wrong-owner
  rejection, recovery-by-cloning, two-process first-open migrations and
  concurrent two-process candle writers. The follow-up additionally launches
  two real desktop instances against one SQLite database with separate Chromium
  session directories, verifies independent UI autosaves/reloads, wrong-owner
  rejection, unchanged legacy bytes and a third instance's recovery clone.
  Actual default shared Chromium-profile startup remains a manual acceptance
  case; it is distinct from this shared application-storage test.
- Boundary lint passes. Main composition forwards through the data client and
  has no SQLite open/canonical-service constructor. Renderer sandbox, context
  isolation, restrictive CSP, trusted-sender checks, package import directions,
  provider permission checks and credential redaction have passing existing
  regressions. The full hostile-message/overflow matrix is not certified by
  these results.
- Save failure/retry, close retry/cancel, serialized/coalesced saves, recovery
  boundary validation, four-chart/five-indicator limits and drawing exclusion
  have passing tests. Recovery uses native buttons/details and alert/status
  text. Actual keyboard focus restoration, screen-reader behavior and recovery
  selection in the installed UI were not manually exercised.

## Migration, recovery and rollback

The runtime's migration authority is the `schema_migrations` table. Current
storage applies versions **1, 2 and 3** within an immediate transaction, reading
the version while holding the migration lock. Migration 3 recreates only
`candles` and `series_cache_state` with versioned cache identity. Workspace,
profile, plugin, settings and credential-reference tables are outside its drop
statements. The expanded legacy-v2 fixture compares exact `SELECT *` snapshots
of every protected table: `workspaces`, `provider_profiles`, `instruments`,
`plugins`, `plugin_permissions`, `app_settings` and `diagnostic_events`.
Whitespace-bearing JSON and synthetic credential references are unchanged;
migration records 1/2 are unchanged, migration 3 is present, both disposable
cache tables are empty, and the foreign-key check is clean. This is exact
stored-value/JSON-byte preservation, not physical SQLite-file byte equality.

Cache identity includes timeframe IDs/seconds, source/target alignment and a
non-secret provider fingerprint. Disposable old cache is refetched; this does
not provide a complete offline mode. Workspace schema and private IPC remain
v1. The follow-up reconciles the exported `databaseSchemaVersion` to **3**,
explicitly meaning the highest supported on-disk SQLite migration. A regression
compares it with the applied migration sequence (observed failing `3 !== 1`
before correction, passing afterward). Search found no runtime consumers of
this previously stale export beyond the public re-export. Other protocol/SDK
versions remain unchanged; storage still rejects unknown newer migrations.

1. Before upgrading or operator recovery, close every application instance and
   confirm the data utilities have stopped. Back up `erc-chart.sqlite` in the
   application's Electron user-data directory. Use a SQLite-consistent backup,
   or copy the closed database and any remaining `-wal`/`-shm` files together.
   Copying only the main file while writers are active is unsafe. Preserve the
   original backup; do not experiment on the only copy.
2. Startup claims and loads the canonical `last-workspace` document
   automatically. If an older installation left newer valid `session:*` rows,
   startup may use them only as migration input, writing the selected state back
   to `last-workspace`. Future autosaves overwrite that canonical document; no
   user-facing recovery-session list is maintained.
3. No recovery-session selector remains. Startup restores the canonical
   workspace automatically; keep database backups for operator rollback rather
   than creating user-selectable session copies.
4. If **Workspace not saved** appears, keep the application open and use
   **Retry workspace save**. On close-time failure choose retry or cancel;
   do not treat a rejected flush as a saved document. If recovery/startup fails,
   preserve the database and sidecars for investigation instead of deleting
   them or automatically rebuilding user data.
5. Older binaries reject the newer on-disk migration version. Do not run an old
   binary concurrently with new writers, delete migration records, or point it
   at the upgraded database. Rollback requires a compatible backup and an
   approved export/operator conversion for newer session documents while every
   instance is stopped. Restoring an older backup loses subsequent edits unless
   those documents have first been preserved. No automatic downgrade or tested
   session-to-legacy export path is claimed.

## Files changed by this Phase 6 workflow

This list describes this workflow's edits, not the entire pre-existing Git diff.
The original 33-file scope was checked against the actual failing lint/format
output: its 17 formatting-only files were all reported by the required root
format gate. The other 16 carried the cap fix, regression/fixture corrections,
smoke/stress evidence or required status documentation. No unrelated reversal
or additional format sweep was made. The first follow-up added three paths,
reaching 36. The failure-path continuation added
`packages/data-service/test/utility-runtime.test.mjs`, reaching 37. The interrupted
engineering continuation already present when this fresh run started adds
`packages/renderer/src/provider-chart.tsx` and
`packages/renderer/test/runtime-series.test.mjs`, for **39 workflow paths**.
Storage tests, provider-bridge tests, utility runtime and renderer shell/chart now
carry behavioral or regression changes, rather than formatting alone. Generated build output is
outside this source edit count; the full dirty tree includes other inherited
implementation files and is not this manifest.

Behavior, tests, fixture lint, tooling or documentation edits:

- `README.md`
- `docs/development/MONOREPO.md`
- `docs/development/DATA-INTEGRITY-VALIDATION.md` (new)
- `docs/superpowers/plans/2026-09-07-data-integrity-runtime-implementation.md`
- `packages/data-service/src/candle-state.ts`
- `packages/data-service/src/provider-bridge.ts`
- `packages/data-service/src/utility-runtime.ts`
- `packages/data-service/test/candle-state.test.mjs`
- `packages/data-service/test/provider-bridge.test.mjs`
- `packages/data-service/test/utility-runtime.test.mjs`
- `packages/renderer/src/development-shell.tsx`
- `packages/renderer/src/provider-chart.tsx`
- `packages/renderer/test/runtime-series.test.mjs`
- `packages/data-service/test/cache-backed-history.test.mjs`
- `packages/electron-main/test/data-utility-client.test.mjs`
- `packages/electron-main/test/utility-supervisor-data.test.mjs`
- `packages/preload/src/bridge.ts`
- `packages/preload/test/bridge.test.mjs`
- `packages/preload/test/workspace-persistence.test.mjs`
- `tools/electron-data-utility-smoke.mjs`
- `tools/data-integrity-stress.mjs` (new)
- `tools/application-gates/src/scaffold-performance.mjs`

- `packages/contracts/src/versions.ts` (follow-up)
- `packages/storage/test/storage.test.mjs` (schema metadata assertion in follow-up)
- `tools/electron-multi-instance.mjs` (follow-up)
- `tools/electron-shared-storage.mjs` (new in follow-up)

Prettier-only edits to existing phase changes:

- `apps/desktop/src/data-utility-storage.ts`
- `apps/desktop/src/indicator-import-service.ts`
- `apps/desktop/src/main.ts`
- `apps/desktop/src/provider-import-service.ts`
- `apps/desktop/src/provider-management-service.ts`
- `apps/desktop/test/data-utility-storage.test.mjs`
- `packages/contracts/src/data-utility.ts`
- `packages/data-service/src/timeframes.ts`
- `packages/data-service/test/history-cache.test.mjs`
- `packages/electron-main/src/data-utility-client.ts`
- `packages/electron-main/src/utility-supervisor.ts`
- `packages/electron-main/test/application.test.mjs`
- `packages/storage/src/index.ts`

## Earlier follow-up evidence (historical)

The interrupted follow-up left cache tests passing but schema/shared-desktop
checks unverified. Work resumed from those exact files; no edits were recreated.
That follow-up's only additional production change was the schema-version
metadata correction. Full suites ran once after that change using pinned npm.
Later continuation/resumption results are recorded separately below.

### Pinned npm without global changes

`Get-Command npm` resolved the user's Roaming npm installation, version `11.14.1`.
`npm view npm@12.0.2 version --offline` returned E404 from old cached metadata.
`npm view npm@12.0.2 version --prefer-online --fetch-retries=0 --fetch-timeout=10000`
returned **12.0.2**, exit 0. This was read-only package-registry investigation,
not a provider connection. `npm exec --yes --package=npm@12.0.2 -- npm --version`
still reported the global version; the cached CLI was then invoked explicitly.

The exact validation setup was:

```powershell
$npmRoot = 'C:\Users\Empire Rider\AppData\Local\npm-cache\_npx\92aea20eff85f4be\node_modules'
$npmCli = "$npmRoot\npm\bin\npm-cli.js"
$originalPath = $env:Path
try {
  $env:Path = "$npmRoot\.bin;$originalPath"
  node $npmCli --version
  npm --version
  # Both reported 12.0.2; execute each recorded script with:
  # node $npmCli run <script>
} finally {
  $env:Path = $originalPath
}
```

The cache directory is machine-specific. Locate it with
`npm exec --yes --package=npm@12.0.2 --call "where.exe npm"` when reproducing.
No package pin, lockfile, global npm installation or persistent PATH was changed.

Fresh results (all exit 0):

- `npm run build:runtime`: built the corrected metadata before process tests.
- `node --test packages/data-service/test/cache-backed-history.test.mjs`:
  **6/6**, 1.24 s; fresh-process native/derived reuse, zero upstream calls.
- `node tools/electron-shared-storage.mjs`: **passed**, 4.10 s; two simultaneous
  desktop processes, one DB, independent 2/3-chart autosaves and renderer
  reloads, wrong-owner rejection, legacy-byte preservation, third-process
  recovery clone. Chromium session directories remain separate.
- `node --test packages/storage/test/storage.test.mjs packages/contracts/test/*.test.mjs packages/data-service/test/cache-backed-history.test.mjs packages/data-service/test/candle-state.test.mjs packages/preload/test/bridge.test.mjs packages/preload/test/workspace-persistence.test.mjs`:
  **79/79**, 3.69 s; schema regression green after observed `3 !== 1` failure.
- `node $npmCli run typecheck`: 1.24 s.
- `node $npmCli run lint`: 8.60 s; boundaries valid.
- `node $npmCli run test:unit`: **479 passed, 2 skipped, 0 failed** of 481,
  28.34 s; includes a clean forced build.
- `node $npmCli run test:integration`: **80/80**, 3.19 s.
- `node $npmCli run smoke:electron`: 9.60 s.
- `node $npmCli run smoke:workspace-restart`: 10.75 s.
- `node $npmCli run smoke:multi-instance`: 13.40 s; now includes both the
  original isolated-profile smoke and the new shared-storage scenario.
- `node $npmCli run smoke:indicator-worker`: 8.08 s.

npm 12 writes run notices to stderr; PowerShell printed `NativeCommandError`
wrappers for those notices. Native exit statuses and test summaries above were
zero/passing; those wrappers were not failing application checks.

### Final resumption verification

After the transient interruption, the working tree and recorded results confirmed
that fresh-process cache, shared-storage, schema, pinned suites and GC stress
checks were already complete. Those edits and full suites were not repeated.
Only documentation contradictions and pending formatting were corrected:
shared-storage coverage, pinned npm status, measured domain evidence and schema
metadata now agree with the follow-up results.

Final checks with cache-local npm `12.0.2`, all exit 0:

- `lint`: **8.98 s**, workspace boundaries valid.
- `format:check`: **5.85 s**, all root-scoped files formatted.
- Separate plan Prettier check and `git diff --check`: passed.
- Global npm remained `11.14.1`; `package.json` and `package-lock.json` had no
  tracked diff. No application code changed in this resumption.

### Lifecycle stress follow-up

`node --expose-gc tools/data-integrity-stress.mjs`: exit 0, **22.75 s**.
The same 100,000-bar/11,000-tick assertions and 122 balanced releases passed.
Optional GC sampling was added to the existing harness, not the application:

- Acquire/release retained heap at cycles 0/25/50/75/100:
  **36,751,720 / 36,730,768 / 36,745,832 / 36,702,384 / 36,706,120 bytes**.
- Invalidate/restore retained heap at cycles 0/5/10/15/20:
  **36,708,280 / 36,732,208 / 36,765,200 / 36,765,104 / 36,766,208 bytes**.
  This run stayed within a 63,824-byte sample range; it is bounded observational
  evidence, not a general proof of absence of leaks.
- After shutdown, active resource types were two `PipeWrap` entries (stdio),
  no `Timeout`. JS listener counts and transport backlog recovery were not
  measured by this domain-only fixture.
- Normal/burst throughput: **100.10 / 1,001.03 ticks/s**; max dispatch
  **101.81 / 4.76 ms**; event-loop-delay p95 **11.19 ms**. These remain domain
  measurements, not visible-chart latency or performance acceptance.

### Exact acceptance classification

**Direct Phase 6 requirements:** section 7 local gates and truthful evidence;
measured engineering stress/process-failure tests; current-status and
migration/recovery documentation; review of boundaries, invariants, security,
accessibility and changed behavior. The full-suite, pinned-toolchain, stress
execution and documentation portions have evidence. The review/failure-path
portion remains open for inherited acceptance cases below; passing commands
alone do not certify the matrix.

**Remaining inherited/manual acceptance:**

- Phase 1 explicitly requires manual actual shared-profile startup. Shared
  application SQLite is covered, but the automated case separates Chromium
  session data. Keyboard/focus/screen-reader recovery requires the operator
  steps below.
- Tick-tail eviction is covered after synchronous canonical processing. There
  is no staged raw-ingress queue in this implementation, so the test is not
  evidence of a staged-backlog overflow/repair algorithm. No queue was invented
  solely to test the plan's proposed starting budget; this is not a new Phase 6
  blocker.

**Automated gaps closed in the fresh run:**

- Production downstream metadata is preserved through the real shell path. The
  central callback stores the full `event.series`, stale generation/revision
  updates are rejected, and the production-shell regression demonstrates
  historical correction, generation rollover and coalesced revision gaps
  reaching chart reset and indicator rebuild behavior without a duplicate live
  subscription.
- Utility-owned upstream requests now have deterministic independent expiry. A
  regression fills all 256 pending upstream slots, expires utility timers while
  the utility remains alive, observes all abandoned commands reject, immediately
  admits fresh upstream work, and confirms late old results cannot consume that
  fresh request. The connected client/utility case separately proves a late
  subscription is released after expiry.

**Closed since the earlier follow-up:** active-renderer stale state and UI
operation during a real utility crash; pending history/write/subscribe rejection;
late unsubscribe acknowledgement and old-generation delivery fencing; bounded
client/runtime pending work; unsubscribe during hydration and tick-tail overflow;
real SQLite busy/full preservation and cache fallback; close-time failed-flush
retry; exact protected-table migration preservation. These are not outstanding
manual tasks.

**Environment-limited coverage, not an invented zero-skips command gate:**

- `whoami /priv` lists no `SeCreateSymbolicLinkPrivilege`; `wsl --status` reports
  WSL is not installed. The existing two Windows file-symlink tests remain
  skipped, also confirmed by the pinned full suite. No privilege, Developer
  Mode or OS feature was changed. Rerun those existing tests on supported CI
  or an already-permitted machine. Section 7 requires its test commands; it
  does not explicitly require zero skips, so this caveat alone is not a new
  Phase 6 blocker. It limits security certification.
- No direct desktop/screen-reader interaction tool is available in this session.
  The explicit manual shared-profile/focus checks require an operator; test
  entry automation does not stand in for an unperformed manual check.

**Separate release/owner follow-ups, not additional Phase 6 command blockers:**

- Section 7 explicitly separates `audit:ci`, `package:win`, `smoke:installer`
  and `checksum:installer`; these were not run. Installer smoke requires a
  disposable Windows environment. Signing, approved minimum hardware, provider
  terms/protocol/authentication and final cache disk policy require separate
  approval/environment. No credentials were requested or accessed.
- Section 7 labels the 30 warm/30 cold opens, ten-minute four-chart/twenty-worker
  pre/post-cutover procedure **proposed**, and hardware budgets **provisional**.
  Those are not exact mandatory commands for closing this local pass. Keep
  full measured application performance acceptance open before release; do not
  invent a pre-cutover baseline or infer optimization from code. Transport
  backpressure/correctness remains part of required implementation validation.
- Automatic updates, full offline mode, replay/backtesting/execution remain
  excluded. A full export/workspace manager and a newly designed recovery UX
  were not added to this follow-up.

Release must stop for unresolved data loss, corruption, secret exposure,
stale-generation delivery or migration loss. Phase 6 remains open specifically
for the required implementation/manual evidence above, not because release-only
work was added to its checklist.

## September 8 resumption

### Recovered state and intentional edits

The only existing terminal was idle. Actual `git status --short` reported 39
modified and 12 untracked source/document/tool paths, rather than the duplicate
slash-formatted snapshot. Windows absolute paths with either separator resolve
through the same workspace; reads of the chart source and Git's canonical path
agreed. No alternate copy was created, removed or normalized. Git reported no
tracked diff for `provider-chart.tsx`, `package.json`, `package-lock.json`,
`tsconfig.json` or `tsconfig.base.json`. Existing generated `dist` and runtime
bundles remain preserved; final smoke scripts regenerate them normally.

The prior failure-path continuation intentionally touched eight source/test/tool
files already present in the recovered tree:

- `packages/electron-main/test/data-utility-client.test.mjs`: three new crash,
  capacity/expiry and late-unsubscribe tests; injected schedulers assert no
  remaining client timers/listeners and exactly-once late upstream release.
- `packages/storage/test/storage.test.mjs`: expanded all-protected-table
  migration fixture; one new native busy/full preservation test. A second
  SQLite connection holds `BEGIN IMMEDIATE`; test-only `busy_timeout=0`
  yields error code 5. A temporary page quota yields code 13; acknowledged rows
  remain unchanged, no transaction remains open, integrity is `ok`, retry works.
- `packages/data-service/test/provider-bridge.test.mjs`: two new tests for
  cancellation/replacement during hydration and ten processed ticks with a
  two-tick retained tail. The latter asserts OHLCV `(10,19,10,19,10)`, all ten
  tick deliveries, and matching canonical snapshot/event generation/revision.
- `packages/data-service/test/utility-runtime.test.mjs`: one new malformed,
  oversized, old-generation and full-capacity test. Exactly 256 upstream
  requests are pending; request 257 returns sanitized `DATA_OPERATION_FAILED`;
  shutdown settles all pending commands and removes its listener.
- `packages/data-service/test/cache-backed-history.test.mjs`: one new real
  SQLite-full fallback test compares all 1,000 returned finalized candles,
  verifies integrity and no open transaction. Only a temporary DB is limited.
- `packages/preload/test/workspace-persistence.test.mjs`: one new failed-save
  test; concurrent/subsequent close flush rejects sanitized
  `Workspace could not be saved.` until the same snapshot is acknowledged.
- `packages/renderer/src/development-shell.tsx`: the demonstrated production
  fix. The central subscription previously ignored live errors. Per-request
  stale state now marks errors/rejected subscriptions, clears on matching
  candles, prunes removed demand, and displays an accessible `role="status"`
  label without disabling workspace controls.
- `tools/electron-data-utility-smoke.mjs`: extended the existing real-process
  smoke with the active production renderer and pending write/subscribe cases;
  retained sandbox/Node-disabled assertions, prior acknowledged workspace,
  distinct restart PID and balanced upstream cleanup.

This is **nine added tests**, plus an expanded existing migration test and the
extended smoke. The renderer smoke was observed failing with
`active renderer stale label` before the central-handler correction, then
passed. An experimental chart-local stale fix was removed in that continuation;
there is no remaining `provider-chart.tsx` diff. No build-tool defect is claimed.

This September 8 resumption changes only this evidence record and the plan.
It reuses the existing partial regressions, updates the 37-path cumulative
workflow manifest, and records their independent fresh closure. It adds no
production behavior, dependency, credential, permission or global-tool change.

### Exact verification evidence

Fresh targeted closure run in this resumption, independent of the interrupted
agent state:

- `npm run build`: exit 0; forced TypeScript workspace build completed.
- `node --test --test-name-pattern="production shell delivers canonical corrections|utility expiry reclaims|connected client and utility reclaim expired subscriptions" packages/renderer/test/runtime-series.test.mjs packages/data-service/test/utility-runtime.test.mjs`:
  **3/3 passed**, 0 failed/cancelled/skipped, 2.43 s. This directly exercises
  the production shell metadata path, utility-owned queue expiry/capacity reuse,
  and connected client/utility late subscription reclamation without restart.
- Reinspection found the needed source/test edits already present in the dirty
  tree, so this fresh closure run required no additional production-code change.

Carried forward from the immediately preceding continuation, **not rerun in
this resumption**: pinned `test:unit` forced build and **488 passed, 2
permission-skipped, 0 failed/cancelled of 490**, exit 0, **26.06 s** wall time
(21.008 s test duration). Earlier 479/481 counts above describe older runs.

Fresh September 8 commands, using the cached npm setup above, all exit 0:

- `node $npmCli run typecheck`: **0.78 s**.
- `node $npmCli run lint`: **4.88 s**; workspace boundaries valid.
- `node $npmCli run test:integration`: **80/80**, no skips/cancellations,
  **2.20 s** wall time (1.649 s test duration).
- `node $npmCli run smoke:electron`: **7.00 s**; real active-renderer crash
  and pending history/write/subscribe assertions, then secure shell boot.
- `node $npmCli run smoke:workspace-restart`: **9.23 s**.
- `node $npmCli run smoke:multi-instance`: **11.27 s**; isolated instances and
  simultaneous shared SQLite with separate Chromium sessions.
- `node $npmCli run smoke:indicator-worker`: **6.59 s**.
- The affected command below: **96/96**, no skips/cancellations,
  **2.38 s** wall time (2.295 s test duration). It includes the nine added
  regressions and existing isolated chart/indicator compatibility tests.

```powershell
node --test packages/electron-main/test/data-utility-client.test.mjs packages/storage/test/storage.test.mjs packages/data-service/test/provider-bridge.test.mjs packages/data-service/test/utility-runtime.test.mjs packages/data-service/test/cache-backed-history.test.mjs packages/preload/test/workspace-persistence.test.mjs packages/renderer/test/runtime-persistence.test.mjs packages/renderer/test/provider-chart.test.mjs packages/renderer/test/plugin-indicators.test.mjs
```

Counts overlap. The four root smoke commands each invoke the existing forced
build/runtime build; no additional full-unit rerun was needed for documentation
changes. Final checks after document edits, all exit 0:

- `node $npmCli run format:check`: **3.81 s**, all root-scoped files formatted.
- Separate plan Prettier check: **0.43 s**, passed.
- `git diff --check`: passed. After recording these timings, both documents
  were checked again with Prettier and the tracked whitespace check repeated.

### Exact remaining operator actions

1. **Use a disposable Windows user account with no real provider profiles or
   credentials for manual shared-profile testing.** Before touching an existing
   profile, close all application instances/data utilities and preserve a
   SQLite-consistent backup, or copy the closed `erc-chart.sqlite` and any
   remaining `-wal`/`-shm` files together. Keep the original backup unchanged.
2. Build once with `node $npmCli run build:runtime` using the cache-local setup.
   From two PowerShell windows in this repository, run the same ordinary entry
   command, `& .\node_modules\.bin\electron.cmd apps/desktop/dist/main.js`.
   Use the same Windows account and no smoke flags or profile overrides. The
   inspected main entry recognizes `--erc-chart-user-data-path` only in smoke
   mode; it is not a supported temporary-profile override for ordinary startup.
   Record whether both windows start using the shared default Chromium profile.
   If either fails, preserve the error and profile; do not delete lock/DB files.
3. In window A keep two chart slots; in B keep three. Wait for save status and
   confirm concurrent ownership conflicts are surfaced rather than silently
   creating extra workspace/session rows. Close both normally. With all
   instances stopped, reopen once and confirm the application automatically
   restores the last successfully saved canonical workspace. Confirm no
   recovery-session dropdown appears.
4. Use Tab/Shift+Tab through the remaining workspace controls. Confirm visible
   focus, readable status/error announcements with the operator's screen reader,
   and continued keyboard access after automatic workspace restore. Save-failure
   retry/cancel is already automated; do not fill a real disk or corrupt a user
   DB to manufacture its manual error state.
5. On supported CI or a machine already permitted to create file symlinks, run
   `node --test packages/provider-runtime/test/plugin-staging.test.mjs tools/delivery-governance/test/repository.test.mjs`.
   Confirm both symlink cases actually execute. No permission/Developer Mode
   change is requested for this account.

Automated engineering action in the requested Phase 6 scope is now closed. The
production renderer path preserves full canonical generation/revision metadata
through the cached chart path and demonstrates chart reset/indicator revision
agreement for historical corrections and coalesced live updates. Utility-owned
expiry reclaims abandoned upstream request capacity while the utility stays alive,
and late subscription completion is released exactly once. No automated blocker
remains in this scope. Phase 6 stays open only for the operator checks above.
