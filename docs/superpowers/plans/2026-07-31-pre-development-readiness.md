# Pre-Development Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the minimum approved architecture, contract, deferral, and Jira evidence required to begin ECDD-54 application development.

**Architecture:** Keep the existing architecture specification body immutable. Add a documentation-first Contract Baseline v1 and one approval/readiness addendum that supersedes the draft status and unchecked approval checklist without implementing runtime code. Record later technical spikes as milestone gates instead of global blockers.

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

- [x] Write the baseline with exact workspace units and dependency rules.
- [x] Define contract families and version `1` identifiers.
- [x] Define boundary ownership and forbidden imports.
- [x] Define compatibility and ADR change control.
- [x] Confirm the document does not claim runtime schemas already exist.
- [x] Commit with `docs: freeze contract baseline v1`.

### Task 2: Record Architecture Acceptance and Deferred Gates

**Files:**

- Create: `docs/architecture/v1/PRE-DEVELOPMENT-READINESS.md`

**Interfaces:**

- Consumes: section 29 checklist, open decisions, ECDD-56 merge evidence, Contract Baseline v1.
- Produces: one auditable approval addendum and readiness decision.

- [x] Record acceptance evidence for ECDD-2 through ECDD-11.
- [x] Assign owner `EmpRider` and a resolution milestone to every open decision.
- [x] Map ECDD-43 through ECDD-52 to the correct later-epic gate.
- [x] Supersede only the draft approval status and section 29 checklist; do not rewrite the architecture body or mark deferred spikes complete.
- [x] State that ECDD-54 may begin after the readiness PR merges.
- [x] Bind the record to readiness PR #4.

### Task 3: Verify Documentation and Open the Readiness PR

**Files:**

- Verify: all files changed on `task/ECDD-197-pre-development-readiness`

**Interfaces:**

- Consumes: Tasks 1 and 2.
- Produces: reviewed, current-head readiness evidence on a task PR.

- [x] Open draft PR #4 to `epic/ECDD-53-repository-build`.
- [x] Mark ready after document self-review.
- [ ] Confirm Delivery gates pass on the current head.
- [ ] Confirm `semgrep-cloud-platform/scan` and `CodeRabbit` are successful.
- [ ] Resolve every actionable review conversation.
- [ ] Squash merge with expected-head locking.

### Task 4: Update Jira Evidence

**Files:**

- Jira: ECDD-2 through ECDD-11, ECDD-42 through ECDD-52, ECDD-56, ECDD-197, ECDD-41, ECDD-53.

**Interfaces:**

- Consumes: merged readiness PR and repository evidence.
- Produces: Jira records that distinguish accepted decisions, completed governance, and milestone-deferred spikes.

- [ ] Add completion evidence to ECDD-2 through ECDD-11.
- [ ] Add merged governance evidence to ECDD-56.
- [ ] Add Contract Baseline v1 evidence to ECDD-42 and ECDD-197.
- [ ] Add explicit owner and resolution gate comments to ECDD-43 through ECDD-52.
- [ ] Add an Epic 0 summary explaining which items are accepted and which are milestone-deferred.
- [ ] Add an Epic 1 comment authorizing ECDD-54 to start.
- [ ] Use available Jira workflow transitions where a completed status exists; otherwise preserve status and record the workflow limitation explicitly.

### Task 5: Final Readiness Verification

- [ ] Re-read the merged Contract Baseline v1 and readiness record from the epic branch.
- [ ] Verify ECDD-54 is the next implementation task and no global pre-development blocker remains.
- [ ] Verify later spikes retain explicit gates and were not falsely closed.
- [ ] Report the final state only after all repository and Jira evidence is visible.
