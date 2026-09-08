# ADR-003: Use Ports-and-Adapters Architecture

- Status: Accepted
- Date: 2026-09-07
- Applies to: Entire application

## Context

Repository inspection, command execution, persistence, and interface code change for different reasons. The CLI and GUI must share one implementation, while future adapters and interfaces should not require a core rewrite.

## Decision

Use a ports-and-adapters architecture with dependencies pointing inward:

    interfaces -> core use cases -> domain
                         |
                         +-> ports <- infrastructure adapters

Domain remains infrastructure-independent. Core orchestrates use cases through narrow boundary contracts. Composition roots choose Git, YAML, command, SQLite, and protocol implementations. GUI and CLI format or transport results but do not implement business rules.

## Reasons

- Prevents verification logic from being trapped in the desktop UI.
- Makes Git, command execution, storage, and future test integrations independently testable.
- Supports CLI, desktop, future CI, and MCP consumers through the same use cases.
- Keeps framework-specific concepts out of stable domain records.

## Consequences

- Boundaries need explicit contracts and contract tests.
- Composition is more visible than in a monolithic application.
- Contributors must resist both direct infrastructure imports in core and unnecessary abstractions inside a single package.
- Significant dependency-direction changes require a new ADR.

## Alternatives considered

- A desktop-first layered application was rejected because it would make headless reuse and behavioral equivalence fragile.
- A plugin framework was deferred because the MVP needs only one concrete verification adapter and does not justify speculative extension machinery.
