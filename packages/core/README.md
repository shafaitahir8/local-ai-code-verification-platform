# `@verify/core`

## Purpose

Owns the deterministic application use cases shared by every interface: profile, preview Quick/Full
verification plans, inspect project policy, preview/apply an explicit configuration migration,
discover, initialize, inspect, run verification, retrieve the latest gate, and list history. It
protects the boundary between interface composition and application behavior.

## Public API

- `VerifierApplication`: orchestrates all supported use cases through injected ports.
- Pure `createVerificationPlan` and `createVerificationPlanPreview` transformations.
- `getProjectPolicy`, `previewProjectConfigMigration`, and `applyProjectConfigMigration` resolve
  the canonical repository root and delegate versioned policy operations to `ConfigurationPort`.
- `ProjectProfilerPort`, `ConfigurationPort`, `RepositoryPort`, `VerificationExecutorPort`, and
  `RunRepositoryPort`: application-facing boundary contracts.
- Request and dependency types for initialization and verification.
- `NoVerificationRunError` and `NoQualityGateError`: explicit history-state failures.

## Allowed dependencies

`@verify/domain`, `@verify/config`, `@verify/verification`, and `@verify/policy`. The package may use
standard JavaScript facilities for orchestration and identifiers.

## Forbidden dependencies

Concrete Git, YAML filesystem, subprocess, SQLite, protocol, CLI, React, or Tauri implementations.
Composition roots, not core, choose adapters.

## Data owned

Core owns application requests, ports, orchestration order, and the construction of coherent run
records. Configuration remains owned by `@verify/config`; normalized records by `@verify/domain`;
persistence by the injected run repository.

## Important invariants

- A run is evaluated exactly once, and the same normalized value is persisted and returned.
- Interfaces do not receive a false PASS after configuration, execution, or persistence failure.
- Interrupted evidence is persisted as a cancelled run; cancellation before the first check yields
  a BLOCK gate rather than an empty-result WARN.
- A cancellation accepted as final evidence settles is still persisted as cancelled and cannot
  retain a PASS gate.
- Lifecycle events preserve run/check identity and ordering.
- Core never instantiates concrete infrastructure.
- Profiling resolves the canonical Git root once, delegates through `ProjectProfilerPort`, and never
  loads configuration, executes checks, or touches run storage.
- Plan preview profiles once and derives both modes without loading configuration, converting
  candidates into executable suites, executing commands, or touching run storage.
- Migration preview does not write; apply requires reviewed source/target digests and does not
  approve or run commands. Legacy configured verification uses named suites from v1 or v2 policy,
  never the new Quick/Full membership or launch-target fields.

## Security and privacy

Core treats repository paths, configured commands, output, and persisted evidence as sensitive. It
only schedules checks loaded through the configuration port and does not add network, telemetry,
redaction, sandboxing, or encryption behavior.

## Versioned contracts

Core consumes project configuration schemas 1 and 2 through a version-aware port while its strict
v1 configuration use case remains unchanged. Protocol versioning is owned by `@verify/protocol`;
incompatible core behavior changes require coordinated contract tests and documentation.

## Testing

    pnpm --filter @verify/core test
    pnpm --filter @verify/core typecheck

Tests use narrow fakes to cover orchestration, event ordering, persistence, history, and failures.

## Example

Composition roots construct `VerifierApplication` with concrete implementations of all four ports;
interfaces then call its use-case methods rather than importing adapters directly.
