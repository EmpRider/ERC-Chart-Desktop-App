# ERC-chart Pre-Development Readiness Record

## Decision

**Status:** Ready after this record is squash merged into `epic/ECDD-53-repository-build`.

**Authorized next implementation task:** ECDD-54 — Create TypeScript monorepo and package boundaries.

This record closes the global architecture-decision gate for starting application implementation. It does not close technical spikes whose evidence is required at a later implementation milestone.

## Authoritative sources

- `ERC-chart-Architecture-Specification-v1.md`
- `CONTRACT-BASELINE-v1.md`
- `IMPLEMENTATION-BACKLOG.md`
- ECDD-56 merged PR `EmpRider/ERC-Chart-Desktop-App#2`
- ECDD-56 squash commit `6ce1d3e82f3104ee29339c470c1621e5c1b87bc6`

## Architecture approval checklist evidence

| Jira | Accepted decision | Repository evidence |
|---|---|---|
| ECDD-2 | MVP in-scope and out-of-scope lists | Architecture sections 1–4 and 24 |
| ECDD-3 | Electron and strict TypeScript desktop baseline | Architecture section 7 |
| ECDD-4 | four charts per window and independent multi-instance behavior | Architecture sections 2, 4.1 and 16.4 |
| ECDD-5 | every open decision has owner and resolution gate | Open-decision register below |
| ECDD-6 | SQLite WAL and Windows Credential Manager | Architecture sections 7, 16 and 17 |
| ECDD-7 | provider utility-process and indicator Web Worker boundaries | Architecture sections 9.4 and 9.5 |
| ECDD-8 | session-only drawing persistence | Architecture sections 2, 4.4 and 13.4 |
| ECDD-9 | signed Production Mode and explicitly enabled unsigned Developer Mode | Architecture section 15 |
| ECDD-10 | Binomo protocol spike is authorized before full adapter implementation | Architecture section 12.3 and gate ECDD-43 |
| ECDD-11 | Post-MVP feature-parity phases are accepted and excluded from MVP | Architecture sections 3.2 and 24 |

Owner for all accepted product and architecture decisions: `EmpRider`.

## Contract freeze

ECDD-42 is satisfied for the start of implementation by `CONTRACT-BASELINE-v1.md`, which freezes:

- logical workspace units and package responsibilities;
- allowed dependency direction and forbidden imports;
- process and state ownership;
- version identifiers for host API, IPC, provider, indicator, manifest, workspace, market data and database contracts; and
- ADR-based compatibility change control.

The baseline is documentation-first. ECDD-54 creates the TypeScript monorepo representation and must not silently change the frozen names or dependency direction.

## Open-decision register

| ID | Owner | Resolution gate | Blocks ECDD-54? |
|---|---|---|---|
| OD-001 Final minimum PC | EmpRider | after ECDD-46 and ECDD-47 measurements; before Epic 9 performance acceptance | No |
| OD-002 Binomo credential capture/renewal UX | EmpRider | ECDD-43; before Epic 4 provider implementation | No |
| OD-003 Binomo instrument discovery | EmpRider | ECDD-43; before Epic 4 provider implementation | No |
| OD-004 Binomo native/derived timeframes | EmpRider | ECDD-43; before provider contract acceptance | No |
| OD-005 Windows code-signing certificate/publisher | EmpRider | before Epic 9 release-candidate signing | No |
| OD-006 trusted plugin signing authority/public key | EmpRider | before Epic 3 Production Mode completion | No |
| OD-007 final cache disk limits | EmpRider | before Epic 2 storage feature freeze | No |
| OD-008 MVP UI language | EmpRider | before Epic 8 UI copy freeze | No |
| OD-009 line/area source selection | EmpRider | before Epic 5 chart UI feature freeze | No |

## Architecture spike gates

These tasks remain mandatory but are not global pre-development blockers.

| Jira | Required evidence | Resolution gate | Current disposition |
|---|---|---|---|
| ECDD-43 | Binomo TLS, auth, catalogue, history, live stream, timeframe and distribution feasibility | before full Epic 4 Binomo adapter implementation | milestone-deferred |
| ECDD-44 | Windows Credential Manager bridge approach | before Epic 2 credential persistence implementation | milestone-deferred |
| ECDD-45 | SQLite WAL from two independent ERC-chart processes | before Epic 2 shared-database acceptance | milestone-deferred |
| ECDD-46 | four layered Canvas charts with synthetic 100,000-candle data | before Epic 5 chart-engine feature freeze | milestone-deferred |
| ECDD-47 | twenty Node-disabled indicator workers | before Epic 7 indicator-runtime feature freeze | milestone-deferred |
| ECDD-48 | final minimum-PC selection from measurements | after ECDD-46/ECDD-47; before Epic 9 performance acceptance | milestone-deferred |
| ECDD-49 | viable rendering and worker performance figures | completion evidence from ECDD-46/ECDD-47 | milestone-deferred acceptance record |
| ECDD-50 | no unresolved feasibility blocker | after required spikes for the affected epic are complete | milestone-deferred acceptance record |
| ECDD-51 | high-risk assumptions accepted or replaced through ADRs | continuously; final check before Epic 9 | milestone-deferred acceptance record |
| ECDD-52 | protocol findings recorded without credentials | with ECDD-43 completion | milestone-deferred acceptance record |

A milestone-deferred task is not cancelled or completed. Its Jira record must retain the owner and gate above.

## Governance readiness

ECDD-56 is complete at repository level:

- task PR #2 was squash merged into `epic/ECDD-53-repository-build`;
- reviewed head: `324c1cff10ef301250b39ffbe3d6aacb56efe6c5`;
- squash commit: `6ce1d3e82f3104ee29339c470c1621e5c1b87bc6`;
- 81 governance tests passed;
- PR validation, repository validation, Markdown lint and administration dry-run passed;
- CodeRabbit approved; and
- all review conversations were resolved.

## Start condition

After the PR containing this record and Contract Baseline v1 is squash merged into `epic/ECDD-53-repository-build`, no global pre-development blocker remains. Development starts with ECDD-54. Later spikes are enforced at the milestone gates listed above.
