# ADR-004: Store Project Verification Configuration in Versioned YAML

- Status: Accepted
- Date: 2026-09-07
- Applies to: Project configuration

## Context

Verification commands and policies must be editable, reviewable, version-controlled, and available to CLI and desktop users. Run history is local state, but repository policy must travel with the repository.

## Decision

Use **.verify/project.yml** as the project configuration source of truth. The initial schema uses version 1 and contains a project name plus named suites with type, command, and failure_policy. Validate every read. Initialization proposes only commands supported by detected project metadata and never overwrites an existing file without explicit force behavior.

## Reasons

- YAML is readable for humans and suitable for configuration-as-code review.
- A repository file is auditable and shared without requiring a database export.
- An explicit version enables safe evolution and migration.
- Keeping the first schema small avoids encoding future AI or framework concerns prematurely.

## Consequences

- YAML parsing is an untrusted-input boundary and requires strict schema validation and actionable errors.
- Configured commands can execute with user permissions; users must review untrusted repository configuration.
- Schema meaning cannot change silently. Incompatible changes require a version and migration path.
- SQLite may cache observations but cannot become the only source of repository policy.

## Alternatives considered

- JSON was rejected as less friendly for hand-edited project configuration.
- SQLite-only configuration was rejected because it is not naturally version-controlled or reviewable with source.
- Package-manager-specific fields were rejected because the generic command contract must support mixed ecosystems.
