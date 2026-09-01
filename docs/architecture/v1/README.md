# ERC-chart Architecture Documentation

Version: 1.0 draft
Date: 2026-07-30
Status: Architecture baseline for implementation planning

This package defines the from-scratch architecture for **ERC-chart**, a Windows 10/11 x64 desktop charting application. The supplied Signal project is used only as a source of behavioral requirements and protocol evidence; its architecture and source code are not the implementation base.

The SDK implementation decision set introduced here is maintained under Jira Epic `ECDD-79` so subsequent implementation work can trace these decisions back to the Provider SDK and plugin-installer delivery stream. The detailed Provider SDK authoring contract is tracked by `ECDD-207` under that epic.

## Review order

1. [ERC-chart Architecture Specification](ERC-chart-Architecture-Specification-v1.md)
2. [Architecture Decisions](ARCHITECTURE-DECISIONS.md)
3. [SDK Implementation Decisions](SDK-IMPLEMENTATION-DECISIONS.md)
4. [Provider SDK Implementation Decisions](PROVIDER-SDK-IMPLEMENTATION-DECISIONS.md)
5. [Reference Feature Catalogue](REFERENCE-FEATURE-CATALOG.md)
6. [Implementation Backlog](IMPLEMENTATION-BACKLOG.md)
7. Contract definitions in `contracts/`

## Package contents

| File | Purpose |
|---|---|
| `ERC-chart-Architecture-Specification-v1.md` | MVP scope, quality attributes, component/process design, data flow, storage, security, testing, and acceptance criteria |
| `ARCHITECTURE-DECISIONS.md` | Accepted and proposed architecture decision records |
| `SDK-IMPLEMENTATION-DECISIONS.md` | Detailed SDK/runtime decisions for clean `ta.*` authoring APIs, hidden data plumbing, incremental/MTF dependencies, dynamic provider/indicator configuration, and klinecharts settings synchronization |
| `PROVIDER-SDK-IMPLEMENTATION-DECISIONS.md` | Detailed provider-plugin authoring contract: minimal adapter API, provider definition/configuration, instrument discovery, history/live normalization, Binomo-derived protocol requirements, and provider-vs-data-service responsibility boundaries |
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
4. Provider SDK implementation decisions for provider-plugin authoring and provider/data-service boundaries
5. Main architecture specification
6. Contract examples
7. Reference-project behavior

Open decisions are listed in the main specification. They do not block architecture approval, but the release-gating items must be resolved before the MVP is distributed.
