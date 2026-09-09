# @verify/storage

Persists deterministic verification history in a local SQLite database through Drizzle ORM.

## Public API

- `RunRepository`: core-facing persistence port for saving and reading run history.
- `ProjectRepository`: optional project metadata port used by composition roots.
- `SqliteRunRepository`: SQLite/Drizzle implementation of both ports.
- `createSqliteRunRepository()`: opens the configured database and applies explicit migrations.
- `SqliteNativeBinding`: optional preloaded addon boundary used by self-contained delivery.
- `runStorageMigrations()`: idempotent migration bootstrap for tooling and tests.

## Allowed dependencies

`@verify/domain`, Node filesystem/path/crypto APIs, `better-sqlite3`, and Drizzle's SQLite adapter.

## Forbidden dependencies

Configuration policy, command execution, Git, protocol framing, React, Tauri, cloud storage, AI,
and business-level gate evaluation.

The database defaults to `~/.verify/history.sqlite3`. Pass `databasePath`, or set
`VERIFY_DATABASE_PATH`, to choose another local path. `:memory:` is supported for tests.

## Data owned

The package stores projects, verification runs, check results, findings, artifacts, timing data,
and final gate decisions. Repository policy remains exclusively in `.verify/project.yml`.

## Invariants

- Every schema change is an ordered, checksum-verified forward migration.
- Migration bootstrap takes an immediate SQLite write lock and rejects unknown/newer ledger versions.
- A run and all nested evidence are replaced atomically when the same run ID is saved again.
- `saveRun` returns the normalized persisted run, including its generated or supplied project ID.
- Foreign keys are enabled. On file databases, write-ahead logging and a busy timeout are enabled.
- History is returned newest first and is scoped by normalized repository root.
- No verification or gate policy is evaluated in this package.
- A supplied native binding changes only addon loading; schema and persistence behavior are identical.

## Security and privacy

Paths, command output, findings, and artifacts are sensitive local data. The package creates local
directories with owner-oriented permissions where supported and makes no network calls, but SQLite
is not encrypted and retained text is not redacted. Callers control retention and database location.

## Versioned contracts

The schema starts at migration 1. Changes require ordered forward migrations, checksum and
existing-data tests, and must fail closed when an older binary sees an unsupported ledger version.
Repository policy remains in configuration schema version 1 rather than being migrated into SQLite.

## Testing

    pnpm --filter @verify/storage test
    pnpm --filter @verify/storage typecheck

Tests cover complete round trips, reopen behavior, repository-scoped history, project metadata,
atomic replacement, corruption/error cases, migration drift/future versions, and path resolution.
