# Deterministic MVP Implementation Plan

## Initial discovery baseline

At planning time, the workspace contained only the product specification at
`Initial Scope/Local-First AI Code Verification Platform — Product & Technical Architecture Specification.md`.
There was no application code, package manifest, Git repository, or generated desktop shell.

The environment provides Node.js 24, Git, and Corepack. A bare `pnpm` command is not on `PATH`, so
`corepack pnpm` is the verified fallback. Rust and Cargo are not on `PATH`, and the Windows SDK
library directory is absent; Rust-dependent Tauri compilation must be validated on a machine with
those prerequisites.

## Source of truth

The full version 0.2 product specification above was reviewed before implementation. This plan is
limited to its Iterations 0–4, the deterministic `v0.1.0` milestone.

## Architectural assumptions

- A pure `domain` package owns stable business data structures.
- Application behavior is expressed as core use cases and narrow ports.
- Git, YAML, subprocesses, and SQLite remain replaceable adapters/infrastructure packages.
- The CLI is the first composition root and exposes the core as human-readable commands, stable JSON,
  and a versioned newline-delimited JSON protocol server.
- The Tauri desktop is a protocol client. React components do not inspect Git, execute checks, evaluate
  gates, or write run history.
- Repository commands are trusted only after they are explicitly stored in `.verify/project.yml`.
- Configuration schema version and protocol version both start at `1`.
- `WARN` exits successfully; `BLOCK` exits `1`; configuration/execution errors exit `2`; interruption
  exits `3`.
- SQLite data is local application state. Source-controlled policy remains in project YAML.

## Exact task sequence

1. `TASK-001-workspace-foundation.md`: workspace, build tooling, architecture docs, ADRs, and CI.
2. `TASK-002-domain-model.md`: infrastructure-independent domain records and invariants.
3. `TASK-003-project-config.md`: YAML v1 schema, validation, discovery suggestions, and safe initialization.
4. `TASK-004-generic-command-adapter.md`: streaming execution, timeout, cancellation, and normalization.
5. `TASK-005-quality-gate.md`: deterministic PASS/WARN/BLOCK policy.
6. `TASK-006-repository-inspection.md`: Git discovery, porcelain parsing, branch and diff statistics.
7. `TASK-007-storage.md`: Drizzle schema, SQLite run repository, and migration bootstrap.
8. `TASK-008-core-use-cases.md`: inspect, initialize, run, gate, discovery, and history orchestration.
9. `TASK-009-cli-and-protocol.md`: CLI commands, stable JSON, exit codes, and NDJSON server.
10. `TASK-010-fixtures-and-integration.md`: real repositories and end-to-end CLI workflows.
11. `TASK-011-desktop-shell.md`: Tauri 2/React/Vite/Tailwind shell and protocol transport.
12. `TASK-012-desktop-dashboard.md`: open/init/inspect/run/results/history dashboard and accessibility.
13. Full lint, typecheck, unit, integration, frontend, build, and acceptance validation.
14. Documentation and `v0.1.0` readiness review.

## Package dependency graph

```text
apps/cli -----------------------> packages/core
   +-> config/repository/adapters/storage/protocol

packages/core -> domain + config + verification + policy
packages/core owns the application-facing repository, execution, configuration, and storage ports
packages/adapters/generic-command -> domain + verification contracts
packages/config -> domain
packages/repository -> domain
packages/verification -> domain
packages/policy -> domain
packages/storage -> domain
packages/protocol -> domain

apps/desktop React -> protocol client/types -> CLI/core protocol server
apps/desktop Tauri -> local stdio process bridge only
```

All dependency arrows point toward stable contracts. No domain type imports React, Tauri, SQLite,
Git, YAML, or Node subprocess APIs.

## MVP acceptance criteria

- `verify init` discovers project scripts and safely creates `.verify/project.yml`.
- `verify inspect` reports root, branch, staged/unstaged state, status, additions, and deletions.
- `verify run` streams configured checks, persists normalized evidence, and returns a gate.
- `verify run --json` emits one stable JSON document without progress noise on stdout.
- `verify gate` and `verify history` read persisted runs and follow documented exit semantics.
- Missing executables, invalid config, timeout, and cancellation never become false passes.
- CLI and desktop invoke the same application engine through protocol version 1.
- Desktop supports repository selection, initialization, inspection, running, results, and history.
- Keyboard, focus, semantic status, contrast, scalable text, and reduced-motion basics are present.
- Fixture-backed tests prove PASS, WARN, BLOCK, Git changes, persistence, and CLI workflow.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` succeed.

## Technical risks

- Native SQLite modules and Tauri builds depend on platform toolchains. Prefer a maintained Drizzle-
  compatible SQLite driver and keep storage behind `RunRepository`.
- Cross-platform shell execution differs. The adapter must use the platform shell deliberately and
  test Windows as well as portable Node commands.
- Git porcelain v2 and `--numstat` report renamed/binary files differently. Parsing must retain an
  explicit `unknown`/zero-stat representation instead of guessing.
- Stdio interruption and process cleanup are timing-sensitive. Protocol request IDs and terminal
  responses must remain deterministic.
- Packaged sidecars need target-specific binaries. Development transport and packaging are separate
  validation concerns.

## Delivery and validation status

Iterations 0–3 and their CLI/protocol acceptance flow are complete. Iteration 4's React dashboard,
typed protocol client, Tauri source bridge, accessible state coverage, and web bundle are implemented.

Validated on 2026-09-08:

```text
corepack pnpm validate                                      PASS
real CLI PASS -> BLOCK -> PASS repair test                 PASS
real built protocol process: inspect/run/gate/history      PASS
CLI terminal run == run.completed event == persisted run   PASS
desktop state, keyboard, axe, and GUI/core equivalence      PASS
corepack pnpm --filter @verify/desktop desktop:build        BLOCKED (missing Cargo)
```

The native command stops at `cargo metadata` because Rust/Cargo and the required Windows SDK build
components are absent on this machine. The application icons and native configuration are present,
but no native compile or runtime smoke result is claimed. A portable installer additionally requires
packaging the headless engine and its runtime as a target-specific sidecar instead of using the
development checkout path.

## Deliberately deferred

- All LLM/model/provider behavior and AI user interfaces.
- Risk scores, blast radius, Tree-sitter, dependencies, and related-test planning.
- Native Vitest/Jest/pytest/TypeScript/ESLint/Playwright/Semgrep adapters.
- MCP, CI-provider integrations, cloud services, telemetry, authentication, and enterprise features.
- Generated tests, sandbox/worktree mutation, automated fixes, and unrestricted agent command access.
- Hardware advisor, model downloads, and advanced reporting formats.
