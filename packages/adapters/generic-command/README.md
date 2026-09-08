# `@verify/adapter-generic-command`

## Purpose

Executes only checks supplied by validated repository configuration and implements the shared
`VerificationAdapter` boundary with local process lifecycle handling.

## Public API

- `GenericCommandAdapter`: runs a configured command with repository working-directory isolation,
  explicit environment additions, live stdout/stderr events, timeout, cancellation, and normalized
  completion evidence.

## Allowed dependencies

`@verify/domain`, `@verify/verification`, and Node subprocess/process APIs. The platform shell is
used deliberately so repository-owned script syntax works unchanged.

## Forbidden dependencies

Configuration invention, Git inspection, gate decisions, persistence, protocol/GUI behavior,
remote command surfaces, AI callers, and automatic tool installation.

## Data owned

Ephemeral child-process state, output capture, timestamps, exit codes, and process-tree termination.
Normalized contracts remain owned by domain/verification; no persistent data is owned here.

## Important invariants

- Only the exact command supplied by the caller executes; the adapter never invents one.
- Missing tools, nonzero exits, timeout, and cancellation never become a pass.
- Live output is emitted as received; retained output is bounded and explicitly marked if truncated.
- Timeout and cancellation terminate the spawned process tree with a bounded force-kill fallback.

## Security and privacy

Configured commands are trusted local code and run with the current user's permissions and inherited
environment plus explicit overrides. There is no sandbox, redaction, privilege boundary, network
filter, or secret protection. Callers must review configuration from untrusted repositories.

## Versioned contracts

The adapter implements the v0.1 `VerificationAdapter` contract. Shell semantics are intentionally
platform-specific; normalized result meanings must remain portable.

## Testing

    pnpm --filter @verify/adapter-generic-command test
    pnpm --filter @verify/adapter-generic-command typecheck

Contract tests cover success, failure, missing executable, cwd, environment, live and bounded
output, timeout, cancellation, and exit normalization with portable Node child commands.
