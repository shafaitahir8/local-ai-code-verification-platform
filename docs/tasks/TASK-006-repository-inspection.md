# TASK-006: Repository Inspection

- Status: Complete
- Iteration: 2
- Depends on: TASK-001, TASK-002

## Goal

Provide a RepositoryService backed by the system Git executable that discovers the root and reports branch, changed files, staged/unstaged state, status, additions, and deletions as stable domain data.

## Non-goals

- No custom Git implementation, commit mutation, dependency graph, blast-radius analysis, or risk classification.

## Packages affected

**@verify/repository**, **@verify/domain**.

## Acceptance criteria

- Inspection works from a repository subdirectory and reports the canonical root.
- Staged, unstaged, untracked, deleted, and renamed files normalize without duplicate paths.
- Diff statistics retain honest unknown/binary cases instead of guessing.
- Missing Git and non-repository paths return explicit actionable errors.
- Raw Git command strings remain internal to the adapter.

## Tests required

- Parser unit tests for porcelain/diff edge cases.
- Real temporary Git repository tests for clean, staged, unstaged, untracked, deleted, renamed, and mixed changes.
- Missing-Git and non-repository error tests.
