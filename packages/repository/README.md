# `@verify/repository`

## Purpose

Provides the Git repository port, a system-Git adapter, and stable parsing of repository changes.

## Public API

- `RepositoryService` with `discoverRoot` and `inspect` operations.
- `GitRepositoryService` and `SystemGitCommandExecutor` implementations.
- `inspectRepository` and `discoverRepositoryRoot` convenience functions.
- Pure porcelain-v2 and NUL-delimited numstat parsers.
- Typed Git execution and parse errors.

## Allowed dependencies

`@verify/domain` and Node process/path APIs. Git is invoked as an argument-vector executable, never
through a shell command string.

## Forbidden dependencies

Configuration parsing, verification execution, policy decisions, storage, React, Tauri, and AI.

## Data owned

Git command execution, repository discovery, porcelain parsing, staged/unstaged state, line-change
statistics, and branch/head metadata.

## Important invariants

- Callers depend on `RepositoryService`, not raw Git commands.
- Unknown and binary line counts remain `null` and set `hasUnknownStatistics`.
- Staged and unstaged flags are preserved independently for the same path.
- Git failures and malformed output never become an empty successful inspection.
- The system adapter uses `execFile` with `shell: false` behavior.

## Security and privacy

Repository paths, Git output, branch names, and filenames are sensitive local data. The adapter
passes fixed Git argument vectors without a shell, does not log repository content, and makes no
network calls. It is not a filesystem permission or repository-content sandbox.

## Versioned contracts

The package maps system Git evidence into the v0.1 domain records. Porcelain parsing changes must
preserve staged/unstaged meaning and explicit unknown statistics or be coordinated as a domain
contract change.

## Testing

    pnpm --filter @verify/repository test
    pnpm --filter @verify/repository typecheck

Tests cover pure parsers, injected command behavior, Git error mapping, and a real temporary
repository workflow.
