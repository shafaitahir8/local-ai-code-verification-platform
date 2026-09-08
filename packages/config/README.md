# `@verify/config`

## Purpose

Owns version 1 of `.verify/project.yml`, safe filesystem initialization, project discovery, and
deterministic verification-suite suggestions.

## Public API

- Parse, validate, serialize, load, and locate project configuration.
- Convert schema-v1 suites into normalized domain checks.
- Detect Node, TypeScript, Vite, test-tool, and Python markers.
- Suggest only package scripts or pytest commands supported by discovered evidence.
- Preview and safely initialize project configuration without accidental overwrite.

## Allowed dependencies

`@verify/domain`, Node filesystem/path APIs, and `yaml` for standards-compliant YAML parsing.

## Forbidden dependencies

Git/process execution, React, Tauri, SQLite, verification adapters, quality-gate evaluation, and AI.

## Data owned

The schema and defaults for `.verify/project.yml`, discovery records, and initialization errors.

## Important invariants

- `version` must be exactly `1`; unsupported versions fail explicitly.
- Existing configuration is never overwritten unless `force: true` is supplied.
- Manual suites default missing `type` to their ID and missing policy to `block` (`lint` defaults to
  `warn`), while serialized output always makes both values explicit.
- Discovery never creates a command for a missing package script.
- Discovery previews are read-only; writing occurs only through an explicit initialization call.
- Initialization refuses to write through a symbolic `.verify` directory or configuration file.

## Security and privacy

Repository metadata and YAML are untrusted local input. Parsing is strict, unsupported keys and
versions fail closed, and initialization avoids accidental overwrites and symbolic write targets.
This package never executes discovered commands and provides no filesystem sandbox or encryption.

## Versioned contracts

`.verify/project.yml` is schema version 1. Shape or meaning changes require validation, migration,
documentation, fixtures, and compatibility tests; the writer never silently upgrades a repository.

## Testing

    pnpm --filter @verify/config test
    pnpm --filter @verify/config typecheck

Tests cover valid and invalid YAML, defaults, round trips, discovery evidence, overwrite behavior,
missing files, and symbolic-path rejection.
