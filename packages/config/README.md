# `@verify/config`

## Purpose

Owns versions 1 and 2 of `.verify/project.yml`, safe filesystem initialization, explicit migration,
project discovery, and deterministic verification-suite suggestions.

## Public API

- Parse, validate, serialize, load, and locate project configuration.
- Convert schema-v1 suites into normalized domain checks.
- Detect Node, TypeScript, Vite, test-tool, and Python markers.
- Suggest only package scripts or pytest commands supported by discovered evidence.
- Preview and safely initialize project configuration without accidental overwrite.
- Inspect version-1 or version-2 policy through `loadProjectPolicy`; historical
  `loadProjectConfig` remains strictly version 1.
- Preview a deterministic version-1-to-version-2 YAML migration with raw-source and target SHA-256
  digests, an exact diff, and a summary; apply it only with both reviewed digests.

## Allowed dependencies

`@verify/domain`, Node filesystem/path APIs, and `yaml` for standards-compliant YAML parsing.

## Forbidden dependencies

Git/process execution, React, Tauri, SQLite, verification adapters, quality-gate evaluation, and AI.

## Data owned

The schema and defaults for `.verify/project.yml`, discovery records, and initialization errors.

## Important invariants

- The historical version-1 parser and loader accept only `version: 1`; the additive policy parser
  accepts only validated versions 1 and 2.
- Version 2 preserves project name and named suites, adds Quick/Full suite membership, and requires
  empty launch-target, discovery-exclusion, and override fields until their effects are implemented.
- Existing configuration is never overwritten unless `force: true` is supplied.
- Manual suites default missing `type` to their ID and missing policy to `block` (`lint` defaults to
  `warn`), while serialized output always makes both values explicit.
- Discovery never creates a command for a missing package script.
- Discovery previews are read-only; writing occurs only through an explicit initialization call.
- Initialization refuses to write through a symbolic `.verify` directory or configuration file.
- Migration never occurs on read or preview. Apply rejects a changed raw source or target digest,
  refuses symbolic paths, and replaces via a synced temporary file in the same directory.
- Migration acceptance is not local approval to run a proposed plan or launch target.

## Security and privacy

Repository metadata and YAML are untrusted local input. Parsing is strict, unsupported keys and
versions fail closed, and initialization avoids accidental overwrites and symbolic write targets.
This package never executes discovered commands and provides no filesystem sandbox or encryption.

## Versioned contracts

`.verify/project.yml` schema version 1 retains its original meaning. Version 2 is an explicit
compatibility boundary; no loader or writer silently upgrades a repository. Both versions retain
the same named-suite execution semantics for the legacy configured-verification path. The extra
version-2 policy fields are not interpreted as command approval or executable smart actions.

## Testing

    pnpm --filter @verify/config test
    pnpm --filter @verify/config typecheck

Tests cover valid and invalid YAML, defaults, round trips, discovery evidence, overwrite behavior,
missing files, symbolic-path rejection, exact migration diffs, no-write preview, stale edits,
version-2 strictness, and explicit atomic replacement.
