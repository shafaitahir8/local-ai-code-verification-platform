# Contributing

## Prerequisites

- Node.js 22.12 or newer
- Corepack and pnpm
- Git available on PATH
- Rust stable and the Tauri 2 operating-system prerequisites for desktop builds

Use the platform-specific Tauri prerequisite guide before diagnosing a desktop compile failure. The headless packages and tests should remain usable without launching the desktop.

## Setup

    corepack enable
    pnpm install
    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm build

If Corepack cannot create a global `pnpm` shim, prefix commands with `corepack`, for example
`corepack pnpm install`. Run commands from the repository root unless a package document says
otherwise.

The four root checks do not compile the native shell. After building the CLI engine, validate that
boundary separately with `pnpm --filter @verify/desktop desktop:build`. On the current Windows
machine, `rustc`, `cargo`, and the Windows SDK libraries are unavailable, so that native build is an
explicitly unrun check rather than a pass.

Useful development entry points:

    pnpm verify inspect
    pnpm --filter @verify/cli dev run
    pnpm --filter @verify/desktop dev
    pnpm --filter @verify/desktop tauri dev
    pnpm --filter @verify/desktop desktop:build

## Before editing

1. Read **AGENTS.md** and **ARCHITECTURE.md**.
2. Read the relevant task under **docs/tasks/**.
3. Read the package's README or create it from **docs/development/PACKAGE-DOCUMENTATION-TEMPLATE.md**.
4. Check applicable ADRs in **docs/ADR/**.

The specification in **Initial Scope/** is the product source of truth. Accepted ADRs describe concrete architectural choices.

## Workspace structure

    apps/cli                 CLI and protocol composition root
    apps/desktop             Tauri shell and React protocol client
    packages/domain          pure domain types
    packages/core            application use cases and ports
    packages/config          YAML v1 configuration and project-marker discovery
    packages/repository      Git discovery and change inspection
    packages/verification    run lifecycle and adapter contracts
    packages/adapters/       external tool implementations
    packages/policy          PASS/WARN/BLOCK rules
    packages/storage         SQLite/Drizzle run history
    packages/protocol        versioned NDJSON schemas
    packages/ui              accessible UI primitives
    fixtures/                real deterministic test repositories
    docs/                    decisions, tasks, and development guidance

Only packages required by the active iteration should exist.

## Development workflow

- Work in one small task or vertical slice at a time.
- Define contracts at real system boundaries before concrete integrations.
- Add tests with the behavior, including negative and error cases.
- Keep interface layers thin and business logic in core/domain packages.
- Update user, package, and architecture documentation with behavior changes.
- Record significant, durable decisions in a new ADR; never rewrite accepted history to hide a change.
- Preserve public behavior and version configuration, database, and protocol changes explicitly.

Before handoff, run the four root validation commands. Also run the nearest package or integration test while iterating.

## Adding an adapter

1. Confirm a generic adapter cannot already satisfy the requirement.
2. Reuse or extend the narrow VerificationAdapter contract without leaking framework-specific fields into core.
3. Put the implementation in its own adapter package only when it has a distinct external dependency or normalization contract.
4. Normalize output to common results, findings, and artifacts.
5. Add common contract tests: success, failure, missing tool, timeout, cancellation, stdout, stderr, working directory, and exit code.
6. Document tool detection, supported versions, security implications, and any artifacts.

An adapter does not decide the final gate and does not silently install its external tool.

## Configuration, protocol, and storage changes

- Configuration changes require schema-version review, migration behavior, fixtures, and documentation. Never silently rewrite **.verify/project.yml**.
- Protocol fields may be added compatibly, but removals or meaning changes require a protocol-version decision and compatibility tests.
- Database changes use explicit ordered migrations, migration tests, an existing-data fixture, and rollback/backup consideration.

## Testing expectations

- Prefer unit tests for deterministic transformations and boundary parsers.
- Use real fixture repositories for Git and command-execution behavior; do not mock every integration.
- Test errors and interruptions as first-class outcomes.
- Keep tests deterministic, local, and independent of cloud services.
- GUI tests verify semantics and accessibility as well as appearance.
- CLI/GUI equivalence tests compare normalized core results, not formatted text.

## Security

Read **SECURITY.md** before changing command execution, environment handling, paths, logging, IPC, storage, or dependency behavior. Never commit credentials, real proprietary source, generated databases, or logs containing secrets.

## Scope discipline

The v0.1.0 milestone is deterministic. Do not add AI, MCP, risk scoring, Tree-sitter, native test-framework adapters, generated tests, cloud services, authentication, telemetry, or enterprise features under an MVP task.
