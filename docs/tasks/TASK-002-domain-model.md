# TASK-002: Domain Model

- Status: Complete
- Iteration: 0-1
- Depends on: TASK-001

## Goal

Define stable infrastructure-independent types for projects, repository changes, suites/checks, verification runs/results, findings, artifacts, and PASS/WARN/BLOCK gate results.

## Non-goals

- No Git, YAML, subprocess, SQLite, React, Tauri, or protocol implementation.
- No risk, dependency-graph, framework-specific, or AI fields.

## Packages affected

**@verify/domain**.

## Acceptance criteria

- Types represent passed, warning, failed, error, cancelled, and skipped check outcomes.
- Check results carry identity, type, timestamps, duration, optional exit/output evidence, findings, and artifacts.
- Repository status supports staged/unstaged state and additions/deletions without raw Git strings leaking outward.
- Domain has no infrastructure dependencies or circular imports.

## Tests required

- Unit tests for constructors/transformations and invariants.
- Type-level or compile fixtures proving public shapes and infrastructure independence.
