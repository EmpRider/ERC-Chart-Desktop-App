# Pre-Development Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the minimum approved architecture, contract, deferral, and Jira evidence required to begin ECDD-54 application development.

**Architecture:** Keep the existing architecture specification authoritative. Add a documentation-first Contract Baseline v1 and one readiness record, then update the architecture approval checklist without implementing runtime code. Record later technical spikes as milestone gates instead of global blockers.

**Tech Stack:** Markdown, Jira, GitHub pull requests, existing delivery-governance workflow.

## Global Constraints

- No application source code or package scaffolding is added.
- No architecture decision is changed from the approved specification.
- Deferred spikes remain mandatory at their named epic gates.
- GitHub writes use the `@GitHub` connector.
- Task PRs target `epic/ECDD-53-repository-build` and use squash merge.
- Required current-head contexts are `Delivery gates`, `semgrep-cloud-platform/scan`, and `CodeRabbit`.

---

### Task 1: Freeze Contract Baseline v1

**Files:**
- Create: `docs/architecture/v1/CONTRACT-BASELINE-v1.md`

**Interfaces:**
- Consumes: approved architecture specification process and package boundaries.
- Produces: immutable package names, dependency rules, contract version identifiers, ownership, and change-control rules for ECDD-54.

- [ ] Write the baseline with exact workspace units and dependency rules.
- [ ] Define contract families and version `1` identifiers.
- [ ] Define boundary ownership and forbidden imports.
- [ ] Define compatibility and ADR change control.
- [ ] Confirm the document does not claim runtime schemas already exist.
- [ ] Commit with `docs: freeze contract baseline v1`.

### Task 2: Record Architecture Acceptance and Deferred Gates

**Files:**
- Create: `docs/architecture/v1/PRE-DEVELOPMENT-READINESS.md`
- Modify: `docs/architecture/v1/ERC-chart-Architecture-Specification-v1.md`

**Interfaces:**
- Consumes: section 29 checklist, open decisions, ECDD-56 merge evidence, Contract Baseline v1.
- Produces: one auditable readiness decision and checked architecture approval list.

- [ ] Record acceptance evidence for ECDD-2 through ECDD-11.
- [ ] Assign owner `EmpRider` and a resolution milestone to every open decision.
- [ ] Map ECDD-43 through ECDD-52 to the correct later-epic gate.
- [ ] Mark only section 29 approval items complete; do not mark deferred spikes complete.
- [ ] State that ECDD-54 may begin after the readiness PR merges.
- [ ] Commit with `docs: approve architecture for implementation`.

### Task 3: Verify Documentation and Open the Readiness PR

**Files:**
- Verify: all files changed on `task/ECDD-42-pre-development-readiness`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: reviewed, current-head readiness evidence on a task PR.

- [ ] Open a draft PR to `epic/ECDD-53-repository-build`.
- [ ] Mark ready after document self-review.
- [ ] Confirm Delivery gates pass on the current head.
- [ ] Confirm `semgrep-cloud-platform/scan` and `CodeRabbit` are successful.
- [ ] Resolve every actionable review conversation.
- [ ] Squash merge with expected-head locking.

### Task 4: Update Jira Evidence

**Files:**
- Jira: ECDD-2 through ECDD-11, ECDD-42 through ECDD-52, ECDD-56, ECDD-41, ECDD-53.

**Interfaces:**
- Consumes: merged readiness PR and repository evidence.
- Produces: Jira records that distinguish accepted decisions, completed governance, and milestone-deferred spikes.

- [ ] Add completion evidence to ECDD-2 through ECDD-11.
- [ ] Add merged governance evidence to ECDD-56.
- [ ] Add Contract Baseline v1 evidence to ECDD-42.
- [ ] Add explicit owner and resolution gate comments to ECDD-43 through ECDD-52.
- [ ] Add an Epic 0 summary explaining which items are accepted and which are milestone-deferred.
- [ ] Add an Epic 1 comment authorizing ECDD-54 to start.
- [ ] Use available Jira workflow transitions where a completed status exists; otherwise preserve status and record the workflow limitation explicitly.

### Task 5: Final Readiness Verification

- [ ] Re-read the merged Contract Baseline v1 and readiness record from the epic branch.
- [ ] Verify ECDD-54 is the next implementation task and no global pre-development blocker remains.
- [ ] Verify later spikes retain explicit gates and were not falsely closed.
- [ ] Report the final state only after all repository and Jira evidence is visible.
