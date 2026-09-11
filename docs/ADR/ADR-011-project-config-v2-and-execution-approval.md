# ADR-011: Evolve Project Policy to Schema v2 with Explicit Execution Approval

- Status: Accepted
- Date: 2026-09-11
- Applies to: `.verify/project.yml`, planning, and smart actions

## Context

Schema version 1 stores a project name and named verification suites. Automatic quick/full
planning, launch targets, discovery exclusions, and user overrides need a richer portable policy.
The application must preserve version 1 behavior, avoid silent rewrites, and distinguish a command
found in a repository from a command this local user has reviewed.

## Decision

Introduce schema version 2 through an explicit migration. Version 2 preserves project name and
named suites and adds only the policy needed for:

- quick and full verification plans;
- approved launch targets;
- discovery exclusions;
- explicit user overrides.

Derived project profiles and AI output are not stored as repository policy. The application
continues to read and execute version 1 configuration. Migration provides a preview, validates the
complete target document, and writes only after explicit GUI or CLI acceptance.

Configuration changes use an expected digest and atomic replacement so a stale proposal cannot
overwrite a manual edit. The local database stores an approval receipt keyed by canonical
repository identity and a digest of all execution-relevant policy. A command, working directory,
launch constraint, or other executable change invalidates the receipt.

Existing `verify run` behavior remains supported. New smart actions require a current approval
receipt before execution.

The receipt digest covers every field that can change which operation runs or how it runs, including
commands, working directories, suite membership, launch constraints, timeouts, and failure policy.
Presentation-only changes do not invalidate it. After an accepted YAML write, the application rereads
and hashes the durable document before recording the receipt. If receipt persistence fails, the YAML
remains valid but every smart action remains unapproved and must fail closed.

## Compatibility and migration

- Schema version 1 retains its existing meaning and requires no automatic migration.
- A version-1 project may continue using the legacy `verify run` path without a receipt. Entering a
  smart-action flow requires explicit migration and approval.
- The GUI and `verify config migrate` can preview version 2 without writing it.
- Applying a migration is explicit, atomic, and covered by version-1 fixtures and migration tests.
- Older binaries encountering version 2 fail clearly as unsupported rather than partially reading
  or rewriting it.
- SQLite approval storage is local state and does not replace YAML as the portable source of policy.
- Protocol version 1 remains the envelope version. Existing strict configuration method/result
  schemas remain unchanged; new version-2 inspection, migration, and apply operations use additive
  method names rather than returning a version-2 document from the existing `config.get` result.

## Consequences

- Cloning a repository with executable policy does not silently trust it on a new machine.
- Approved plans can run without a confirmation dialog on every invocation until executable policy
  changes.
- Database schema changes require ordered migrations and existing-data tests.
- The exact version 2 schema must be finalized in the Iteration 6 task before implementation.

## Alternatives considered

- Adding optional fields silently to schema version 1 was rejected because the new plan and launch
  semantics require an explicit compatibility boundary.
- Treating the YAML file itself as local approval was rejected because version-controlled files may
  arrive from an untrusted repository or change outside the application.
- Requiring confirmation before every run was rejected as unnecessary friction after unchanged
  executable policy has been reviewed once.
