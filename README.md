# ERC-Chart Desktop App

ERC-Chart is a Windows desktop charting application planned around a
TypeScript/Electron architecture. The MVP will connect to Binomo market data,
render up to four charts per window, support technical indicators and drawing
tools, and load JavaScript/TypeScript plugins in controlled runtimes.

The application is being designed and implemented from scratch. The supplied
Signal project is reference material for required behavior only and is not part
of this repository.

Indicators can use the [Pine-inspired authoring API](docs/development/INDICATOR-AUTHORING.md)
with `defineIndicator`, `input`, `ta`, and `plot`, without manually declaring
output arrays or compatibility metadata.

## Current status

Source version `1.0.0` includes live provider/history integration, klinecharts,
indicator workers, plugin management, and recoverable per-instance workspace
sessions. Canonical market data and SQLite operations now run in the data utility
process; main retains provider supervision, privileged operations, and credentials.
History uses an identity-versioned cache; drawings remain session-only.

Local validation on 2026-09-07 passed build, typecheck, lint, focused regressions,
boundaries, real-process history/live/crash checks, fresh-process cache reuse,
shared-storage autosaves/recovery, and synthetic stress. **Phase 6 remains open**
for required failure-path and manual shared-profile/recovery validation.
Full application performance and release/provider approval remain separate
release gates. These are source-check results, not a newly verified installer.
Automatic updates are excluded; production signing remains gated.

See [validation evidence and recovery instructions](docs/development/DATA-INTEGRITY-VALIDATION.md)
for exact results, skipped tests, fixture limits, and remaining gates.

- [Architecture specification](docs/architecture/v1/ERC-chart-Architecture-Specification-v1.md)
- [Architecture decisions](docs/architecture/v1/ARCHITECTURE-DECISIONS.md)
- [Implementation backlog](docs/architecture/v1/IMPLEMENTATION-BACKLOG.md)
- [Reference feature catalogue](docs/architecture/v1/REFERENCE-FEATURE-CATALOG.md)
- [Monorepo development guide](docs/development/MONOREPO.md)

Development proceeds through the approved Jira backlog and task-to-epic branch
workflow. Install the pinned Node.js version from `.nvmrc`, then run `npm ci`
from the repository root before using the root quality commands.
