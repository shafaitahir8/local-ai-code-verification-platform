# `@verify/policy`

## Purpose

Evaluates normalized check evidence into the deterministic quality gate.

## Public API

- `evaluateQualityGate(results, options?)`
- `gateStatusToExitCode(status)`
- `QUALITY_GATE_EXIT_CODES`

## Allowed dependencies

`@verify/domain` only.

## Forbidden dependencies

Subprocess execution, Git, configuration parsing, storage, UI frameworks, protocol transports, and
tool-specific result formats.

## Data owned

Quality-gate decision rules and PASS/WARN/BLOCK shell-exit mapping.

## Important invariants

- Execution errors and cancellation always block; missing evidence is never treated as a pass.
- An explicitly interrupted run is BLOCK even if cancellation races with otherwise passing final
  evidence.
- A failed `block` check blocks, while a failed `warn` check warns.
- Warning or skipped evidence yields at least WARN.
- BLOCK takes precedence over WARN, which takes precedence over PASS.
- WARN exits `0`; BLOCK exits `1`. Configuration/execution and interruption exit codes are owned by
  the CLI/application layer.

## Security and privacy

Policy is a pure evaluation package. It reads normalized statuses only and performs no filesystem,
subprocess, logging, storage, environment, or network access. It never converts missing or erroneous
evidence into PASS.

## Versioned contracts

PASS/WARN/BLOCK meaning and the WARN/BLOCK exit mapping are v0.1 public behavior. Any semantic
change requires coordinated domain, CLI, protocol, test, and user-documentation updates.

## Testing

    pnpm --filter @verify/policy test
    pnpm --filter @verify/policy typecheck

Table-driven tests cover precedence, warn/block policy, errors, cancellation, skipped evidence, and
empty evidence.
