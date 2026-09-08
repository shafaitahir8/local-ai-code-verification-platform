# TASK-008: Core Use Cases

- Status: Complete
- Iteration: 1-3
- Depends on: TASK-002 through TASK-007

## Goal

Compose ports into InitializeProject, DiscoverProject, InspectRepository, RunVerification, EvaluateLatestGate, and GetRunHistory use cases shared by every interface.

## Non-goals

- No CLI parsing, React state, Tauri commands, concrete driver construction, or duplicated infrastructure behavior.

## Packages affected

**@verify/core** plus public contracts from config, repository, verification, policy, and storage packages.

## Acceptance criteria

- Initialization uses discovery suggestions, validation, and safe config-write behavior.
- Run loads config, schedules configured checks, streams typed events, normalizes results, evaluates policy, and persists one coherent run.
- Inspect, latest gate, and history return stable domain records and explicit errors.
- Use cases accept ports through composition and do not import concrete Git, process, or SQLite drivers.

## Tests required

- Unit tests with narrow fakes for success and every boundary error.
- Orchestration tests for event order, persistence after completion, interruption, and no false PASS.
- Tests proving interfaces can consume the same returned normalized result.
