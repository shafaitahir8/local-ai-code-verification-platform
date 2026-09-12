# `@verify/domain`

## Purpose

Defines the deterministic verifier's infrastructure-independent business records and small domain
transformations.

## Public API

- Project identity and normalized verification models.
- Versioned project-profile, evidence, confidence, scan, progress, and cancellation records.
- Repository change, Git reference, and line-statistic models.
- PASS/WARN/BLOCK status records and summary helpers.
- Predicates for terminal and unsuccessful check states.

## Allowed dependencies

None. TypeScript types and pure functions only.

## Forbidden dependencies

React, Tauri, Node subprocess/filesystem APIs, Git implementations, YAML parsers, SQLite, Drizzle,
and verification-tool-specific models.

## Data owned

Projects, project profiles, checks, normalized results, findings, artifacts, gate outcomes, runs,
and repository change snapshots.

## Important invariants

- Gate statuses are uppercase `PASS`, `WARN`, or `BLOCK`.
- Unknown line counts are represented by `null`; they are never guessed.
- Framework-specific evidence is expressed through generic findings and artifacts.
- Project-profile capabilities use portable categories, stable evidence references, and distinguish
  a completed partial scan from a cancelled operation with no profile.
- Timestamps are ISO-8601 strings at package boundaries.

## Security and privacy

This package performs no filesystem, subprocess, storage, logging, environment, or network access.
It provides data contracts, not a sandbox, redaction layer, or encryption boundary.

## Versioned contracts

The exported records are the common v0.1 domain contract. Configuration versioning belongs to
`@verify/config`, protocol versioning to `@verify/protocol`, and database migrations to
`@verify/storage`; coordinated changes must keep those representations compatible.

## Testing

    pnpm --filter @verify/domain test
    pnpm --filter @verify/domain typecheck

Tests cover summary helpers, status predicates, and infrastructure-free domain invariants.
