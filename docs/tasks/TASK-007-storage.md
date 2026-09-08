# TASK-007: Verification Run Storage

- Status: Complete
- Iteration: 1
- Depends on: TASK-001, TASK-002

## Goal

Define RunRepository and implement local SQLite/Drizzle persistence for projects, verification runs, individual check results, findings, timestamps, duration, and final gate status.

## Non-goals

- No repository policy stored exclusively in SQLite, cloud synchronization, authentication, analytics, or encrypted database claim.

## Packages affected

**@verify/storage**, **@verify/domain**, and the RunRepository port consumed by **@verify/core**.

## Acceptance criteria

- Explicit ordered migrations create the schema; foreign keys are enforced and WAL is enabled where supported.
- A completed run can be saved and read back without losing normalized status, output, timings, findings, or gate.
- Latest-gate and recent-history queries are deterministic per project.
- Database location is configurable and parent directories are handled safely.
- Reopening an existing database applies only pending migrations.

## Tests required

- In-memory or temporary-file repository round-trip tests.
- Migration tests from empty and existing-data fixtures, including idempotent reopen.
- Foreign-key, ordering, optional-field, and failure/transaction tests.
