# Package Documentation Template

Copy this file into a package README and remove guidance that does not apply. Documentation should describe the current package, not speculative roadmap behavior.

# Package name

One sentence describing why this package exists.

## Purpose

- Responsibilities owned here.
- Boundary this package protects.
- Related task and ADR links.

## Public API

List exported types, functions, classes, and ports. Include short behavioral contracts and link to generated API documentation if one exists.

## Allowed dependencies

- Workspace packages this package may import.
- External dependency categories permitted here.

## Forbidden dependencies

- Infrastructure or interface layers that would reverse dependency direction.
- Framework-specific concepts that must remain in an adapter.

## Data owned

Describe schemas, records, files, tables, events, or caches this package owns. State which package owns the source of truth when data crosses boundaries.

## Important invariants

- Conditions callers and implementations must preserve.
- Error and cancellation behavior.
- Ordering, idempotency, and compatibility guarantees.

## Security and privacy

Document filesystem, subprocess, environment, network, secret, logging, and untrusted-input implications. State explicitly when the package provides no sandbox or encryption boundary.

## Versioned contracts

List configuration, protocol, database, or public API versions affected and the required migration/compatibility rules.

## Testing

    pnpm --filter PACKAGE_NAME test
    pnpm --filter PACKAGE_NAME typecheck

List contract tests, fixtures, platform requirements, and meaningful error cases. Do not claim tests that are not automated.

## Examples

Provide the smallest safe usage example. Composition roots should be shown separately from core contracts.
