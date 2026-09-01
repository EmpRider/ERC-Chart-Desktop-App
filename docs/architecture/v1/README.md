# ERC-chart Architecture Documentation

Version: 1.0 draft
Date: 2026-07-30
Status: Architecture baseline for implementation planning

This package defines the from-scratch architecture for **ERC-chart**, a Windows 10/11 x64 desktop charting application. The supplied Signal project is used only as a source of behavioral requirements and protocol evidence; its architecture and source code are not the implementation base.

## Review order

1. [ERC-chart Architecture Specification](ERC-chart-Architecture-Specification-v1.md)
2. [Architecture Decisions](ARCHITECTURE-DECISIONS.md)
3. [SDK Implementation Decisions](SDK-IMPLEMENTATION-DECISIONS.md)
4. [Reference Feature Catalogue](REFERENCE-FEATURE-CATALOG.md)
5. [Implementation Backlog](IMPLEMENTATION-BACKLOG.md)
6. Contract definitions in `contracts/`

## Package contents

| File | Purpose |
|---|---|
| `ERC-chart-Architecture-Specification-v1.md` | MVP scope, quality attributes, component/process design, data flow, storage, security, testing, and acceptance criteria |
| `ARCHITECTURE-DECISIONS.md` | Accepted and proposed architecture decision records |
| `SDK-IMPLEMENTATION-DECISIONS.md` | Detailed SDK/runtime decisions for clean `ta.*` authoring APIs, hidden data plumbing, incremental/MTF dependencies, dynamic provider/indicator configuration, and klinecharts settings synchronization |
| `REFERENCE-FEATURE-CATALOG.md` | Traceability from the supplied Signal source to MVP and post-MVP phases |
| `IMPLEMENTATION-BACKLOG.md` | Dependency-ordered implementation epics and definition of done |
| `contracts/erc-contracts.ts` | Illustrative TypeScript contracts for market data, providers, indicators, plots, signals, and IPC |
| `contracts/plugin-manifest.schema.json` | JSON Schema for installable provider and indicator plugin packages |
| `contracts/workspace.schema.json` | JSON Schema for the local MVP workspace document; drawing persistence is deliberately absent |
| `examples/` | Schema-valid example Binomo manifest and four-chart workspace |

## Decision authority

If documents appear to conflict, use this order:

1. Explicit user-confirmed requirements
2. Accepted architecture decisions
3. SDK implementation decisions for SDK/runtime behavior
4. Main architecture specification
5. Contract examples
6. Reference-project behavior

Open decisions are listed in the main specification. They do not block architecture approval, but the release-gating items must be resolved before the MVP is distributed.
