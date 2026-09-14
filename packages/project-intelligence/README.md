# `@verify/project-intelligence`

## Purpose

Builds a bounded, deterministic, read-only profile of a selected repository. It owns repository
inventory, sensor coordination, metadata-read budgets, and the Node/Vite/Vitest/Jest, plain
root-`index.html`, Python/pytest, and declared npm/pnpm/Yarn workspace detection implemented for
TASK-014. Detection is evidence only and never grants execution authority.

## Public API

- `FileSystemProjectProfiler` and `createProjectProfiler`: coordinate a bounded profile scan.
- `ProjectSensor`: read-only asynchronous sensor contract.
- `ProjectInventory`, `ProjectMetadataReader`, and `ProjectSensorContext`: restricted sensor inputs.
- `ProjectScanLimits` and `DEFAULT_PROJECT_SCAN_LIMITS`: central scan budgets.
- `NodeProjectSensor`: deterministic JavaScript and static-entry metadata sensor.
- `PythonProjectSensor`: deterministic Python packaging and pytest metadata sensor.
- `WorkspaceProjectSensor`: deterministic declared Node workspace and child-package sensor.

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
- JavaScript is reported only from inventory-backed `.js`, `.jsx`, `.mjs`, or `.cjs` path evidence;
  TypeScript requires `tsconfig.json` or an exact `typescript` dependency. Convention-only language
  evidence remains tentative rather than being promoted to a confirmed capability.
- Generated sensor evidence, task, and workspace identifiers use deterministic, sensor-scoped
  SHA-256-derived suffixes from normalized identity inputs. Conflicting duplicate sensor output is
  rejected or isolated instead of being silently conflated.
- Multiple credible test frameworks, test commands, run commands, workspace systems, or workspace
  roots remain explicit ambiguities; the profile has no selected target.
- Pytest is confirmed only by dedicated configuration or an exact dependency declaration;
  conventional Python test paths supplement evidence but do not identify pytest alone.
- Workspace roots come from supported, repository-contained declarations and inventory-backed child
  `package.json` files; package-manager commands are never used for discovery.
- A root `index.html` produces a plain-static preview capability only when inventory traversal is
  complete and Vite evidence is absent; it never creates an executable preview task.
- The root `index.html` entry document uses the existing `manifest` evidence kind because the file
  is the explicit machine-readable entry point, rather than a path convention inferred elsewhere.
- Budget exhaustion completes with a partial profile; user cancellation returns no profile. The
  elapsed budget is cooperative at inventory, metadata-read, and sensor boundaries.
- Sensor failure is isolated as a warning and never creates a false capability.
- Observed commands remain non-executable candidates.

## Security and privacy

The package reads local metadata with the current user's permissions. Reads are path-contained and
bounded, summaries omit raw manifest content and environment values, and the package performs no
writes, subprocess execution, persistence, logging, or network access. It is not a sandbox against
another local process changing files during a scan.

## Versioned contracts

Produces `ProjectProfile` version 1. It does not change protocol version 1 or project configuration
schema version 1. Legacy `ProjectDiscovery` behavior remains an isolated `@verify/config`
compatibility path and does not consume the new profile in Iteration 5.

## Testing

    pnpm --filter @verify/project-intelligence test
    pnpm --filter @verify/project-intelligence typecheck

Tests cover Node/Vite/Vitest/Jest, plain-static, Python/pytest, npm/pnpm/Yarn workspace, and mixed
project evidence; Vite precedence when `index.html` is present; malformed metadata; explicit
multi-target ambiguity; deterministic ordering; fixed exclusions; directory-link containment; all
scan budgets; cancellation; sensor isolation; and no-write/no-run behavior against committed
fixtures.
