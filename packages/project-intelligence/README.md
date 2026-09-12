# `@verify/project-intelligence`

## Purpose

Builds a bounded, deterministic, read-only profile of a selected repository. It owns repository
inventory, sensor coordination, metadata-read budgets, and the initial Node/Vite/Vitest sensor for
TASK-014. Detection is evidence only and never grants execution authority.

## Public API

- `FileSystemProjectProfiler` and `createProjectProfiler`: coordinate a bounded profile scan.
- `ProjectSensor`: read-only asynchronous sensor contract.
- `ProjectInventory`, `ProjectMetadataReader`, and `ProjectSensorContext`: restricted sensor inputs.
- `ProjectScanLimits` and `DEFAULT_PROJECT_SCAN_LIMITS`: central scan budgets.
- `NodeProjectSensor`: first deterministic metadata sensor.

## Allowed dependencies

- `@verify/domain` for portable profile records.
- Node filesystem and path APIs inside the inventory/reader implementation.

## Forbidden dependencies

Core, config, Git command adapters, command runners, child processes, databases, network clients,
React, Tauri, AI providers, and framework execution libraries.

## Data owned

Ephemeral repository inventories, bounded metadata reads, sensor observations, and deterministic
profile assembly. `@verify/domain` owns the portable profile contract. No profile is persisted.

## Important invariants

- Sensors receive no filesystem handle, runner, writer, database, environment, or network client.
- Traversal is sorted, never follows directory links, and excludes dependency/VCS/build output.
- Every capability and task candidate references evidence.
- Budget exhaustion completes with a partial profile; user cancellation returns no profile.
- Sensor failure is isolated as a warning and never creates a false capability.
- Observed commands remain non-executable candidates.

## Security and privacy

The package reads local metadata with the current user's permissions. Reads are path-contained and
bounded, summaries omit raw manifest content and environment values, and the package performs no
writes, subprocess execution, persistence, logging, or network access. It is not a sandbox against
another local process changing files during a scan.

## Versioned contracts

Produces `ProjectProfile` version 1. It does not change protocol version 1 or project configuration
schema version 1. Legacy `ProjectDiscovery` projection remains owned by `@verify/config`.

## Testing

    pnpm --filter @verify/project-intelligence test
    pnpm --filter @verify/project-intelligence typecheck

Tests cover Node/Vite/Vitest evidence, malformed and missing manifests, deterministic ordering,
read budgets, partial completion, cancellation, sensor isolation, containment, and no-write/no-run
behavior against committed fixtures.
