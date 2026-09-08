# Agent Development Rules

This repository is the deterministic MVP of the Local-First AI Code Verification Platform. These rules apply to every human or AI-assisted change.

## Required context

Before changing behavior:

1. Read **ARCHITECTURE.md** and the relevant ADRs.
2. Read the documentation for every package being edited.
3. Read the active task in **docs/tasks/** and keep the change within its goal and non-goals.
4. Consult the product specification in **Initial Scope/** when requirements are ambiguous.

The product specification defines product intent. Accepted ADRs define implementation decisions. A new decision that conflicts with either requires an explicit ADR.

## Architectural boundaries

- Keep one headless application core. The CLI, desktop GUI, and future interfaces call the same use cases.
- Never put repository inspection, command execution, result normalization, persistence, or gate evaluation in React components or Tauri commands.
- Keep **@verify/domain** independent of React, Tauri, Node subprocesses, Git implementations, YAML libraries, and SQLite.
- Application use cases belong in **@verify/core**. They depend on ports and domain contracts, not concrete infrastructure.
- External systems and tools are adapters. Define the boundary contract before coupling the core to an implementation.
- The generic-command adapter executes only commands explicitly configured by the user or repository.
- Keep framework-specific data out of common domain types. Represent portable findings and artifacts instead.
- Dependencies point inward. Do not introduce circular workspace dependencies.
- Do not create speculative packages or abstractions for roadmap features.

## Stable contracts

- **.verify/project.yml** starts at schema version 1. Never change its shape or meaning silently; add validation, migration, documentation, and tests.
- The desktop/core NDJSON protocol starts at protocolVersion 1. Never silently remove fields or change their meaning.
- Gate states are PASS, WARN, and BLOCK. An execution or configuration error is not a passing check.
- CLI exit codes are 0 for PASS or WARN, 1 for BLOCK, 2 for execution/configuration error, and 3 for interruption.
- SQLite changes require ordered migrations and migration tests. Repository configuration remains in YAML, not only in the database.

## Security and privacy

- Source code and verification evidence stay local by default.
- Do not add telemetry, cloud AI, network listeners, authentication, or remote command surfaces in the MVP.
- Never expose an unrestricted command interface to AI or a remote caller.
- Show configured commands before execution and preserve explicit timeout and cancellation behavior.
- Avoid logging secrets. Treat repository content, paths, environment variables, command output, and the local database as sensitive.
- Prefer ERROR or UNKNOWN over an incorrect PASS. Do not silently fall back after a failed security- or correctness-relevant operation.

## Change workflow

1. Keep each change aligned to one task or one small vertical slice.
2. Add or update tests with behavior changes.
3. Update package and user documentation when behavior changes.
4. Add an ADR for a significant architectural decision.
5. Justify every new dependency by maintenance, license, platform weight, and real need.
6. Preserve existing public contracts unless the task explicitly includes a versioned migration.
7. Do not implement features assigned to a later iteration. In particular, no AI, MCP, risk engine, code intelligence, native framework adapters, or generated-test sandbox belongs in v0.1.0.
8. Keep existing tests green; never delete a failing test merely to make validation pass.

## Change tracking

1. After each meaningful implementation task, update **docs/DEVELOPMENT_LOG.md**.
2. Log only what changed, important architectural decisions, validation performed, and remaining
   limitations.
3. Do not log trivial formatting or mechanical edits individually.
4. Keep entries concise.
5. Git is the source of truth for exact changes.
6. Review `git diff` before considering a task complete.
7. Do not create commits unless explicitly instructed or the active task authorizes them.

Before handing off a completed task, run:

    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm build

If platform prerequisites prevent a Tauri build, record the exact limitation and run every remaining check. Never report an unrun check as passing.

## Package documentation

Each package must document its purpose, public API, allowed and forbidden dependencies, owned data, invariants, security considerations, and test command. Use **docs/development/PACKAGE-DOCUMENTATION-TEMPLATE.md** when adding a package.
