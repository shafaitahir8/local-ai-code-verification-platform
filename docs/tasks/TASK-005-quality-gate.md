# TASK-005: Quality Gate

- Status: Complete
- Iteration: 1
- Depends on: TASK-002

## Goal

Evaluate normalized check results deterministically into PASS, WARN, or BLOCK and map terminal outcomes to documented CLI exit codes.

## Non-goals

- No command execution, log parsing, risk score, AI opinion, or interface formatting.
- No configurable WARN failure exit behavior beyond the v0.1.0 contract.

## Packages affected

**@verify/policy**, **@verify/domain**.

## Acceptance criteria

- Any failed block-policy check yields BLOCK.
- Warn-policy failure yields WARN only when no blocker exists.
- All relevant successful checks yield PASS.
- Error/cancelled evidence cannot produce a false PASS.
- Exit mapping is 0 for PASS/WARN, 1 for BLOCK, 2 for operational error, and 3 for interruption.

## Tests required

- Truth-table unit tests for empty, all-pass, warn-only, mixed warn/block, error, cancelled, and skipped inputs.
- Unit tests for exit-code mapping and order-independent evaluation.
