# TASK-001: Workspace Foundation

- Status: Complete
- Iteration: 0
- Depends on: None

## Goal

Create a reproducible pnpm/Turborepo TypeScript workspace with shared lint, formatting, typecheck, test, and build conventions; establish package boundaries, architecture documents, ADRs, fixtures, and CI/release foundations.

## Non-goals

- No verification behavior, executable commands, persistence, or GUI functionality.
- No empty packages for post-MVP roadmap features.

## Packages affected

Root workspace configuration, shared tooling configuration, initial package scaffolds, **docs/**, **fixtures/**, and CI metadata.

## Acceptance criteria

- Workspace contains only Iterations 0-4 packages with strict TypeScript and ESM conventions.
- Root scripts consistently run lint, typecheck, test, and build through Turborepo.
- AGENTS, architecture, security, contribution, ADR, and task documentation exists.
- Package dependency directions match **ARCHITECTURE.md**.

## Tests required

- Clean install and workspace graph smoke test.
- Empty/baseline package tests execute through the root pipeline.
- **pnpm lint**, **pnpm typecheck**, **pnpm test**, and **pnpm build** succeed.
