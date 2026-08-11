# ERC-Chart Desktop App

ERC-Chart is a Windows desktop charting application planned around a
TypeScript/Electron architecture. The MVP will connect to Binomo market data,
render up to four charts per window, support technical indicators and drawing
tools, and load JavaScript/TypeScript plugins in controlled runtimes.

The application is being designed and implemented from scratch. The supplied
Signal project is reference material for required behavior only and is not part
of this repository.

## Current status

Epic 1's secure desktop foundation is complete. The repository includes the
strict TypeScript monorepo, sandboxed Electron shell, privileged `erc-app://`
renderer protocol, React tabs and one-to-four chart layouts, isolated utility
processes, multi-instance smoke coverage, and an unsigned x64 per-user Windows
installer pipeline. Live charts, market-data providers, persistence, plugins,
automatic updates, and production signing remain later-epic work.

- [Architecture specification](docs/architecture/v1/ERC-chart-Architecture-Specification-v1.md)
- [Architecture decisions](docs/architecture/v1/ARCHITECTURE-DECISIONS.md)
- [Implementation backlog](docs/architecture/v1/IMPLEMENTATION-BACKLOG.md)
- [Reference feature catalogue](docs/architecture/v1/REFERENCE-FEATURE-CATALOG.md)
- [Monorepo development guide](docs/development/MONOREPO.md)

Development proceeds through the approved Jira backlog and task-to-epic branch
workflow. Install the pinned Node.js version from `.nvmrc`, then run `npm ci`
from the repository root before using the root quality commands.
