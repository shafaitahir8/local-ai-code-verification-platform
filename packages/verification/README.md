# `@verify/verification`

## Purpose

Coordinates deterministic check lifecycles behind an adapter contract. It protects core use cases
from tool-specific execution and keeps scheduling, event order, cancellation, and retained-output
normalization independent of any framework.

## Public API

- `VerificationAdapter`: boundary implemented by command or future framework adapters.
- `VerificationRunner`: sequential, cancellable check coordinator.
- `VerificationLifecycleEvent`: normalized start, output, and completion event stream.
- Verification request, evidence, execution-context, and output-event contracts.
- `MAX_RETAINED_OUTPUT_JSON_CHARACTERS`: aggregate retained-output budget for one run.

## Allowed dependencies

`@verify/domain` and standard JavaScript timing, collection, JSON, and abort facilities.

## Forbidden dependencies

Shell/process APIs, Git, YAML, SQLite, policy evaluation, protocol framing, React, Tauri, and
tool-specific result models.

## Data owned

Run-lifecycle requests and evidence, adapter contracts, normalized lifecycle events, sequential
scheduling state, and retained-output limits. Final run and gate records belong to core/domain.

## Important invariants

- Checks execute in configured order and emit ordered lifecycle events.
- It never evaluates policy or persists history and never assumes a test framework.
- An aborted run cannot be reported as complete success.
- Cancellation observed as the final check settles is retained in the terminal run evidence.
- Check-completed events contain the same bounded result added to final evidence.
- Retained stdout/stderr is explicitly marked when truncated; live output remains streamed.

## Security and privacy

Command output may contain source or secrets. The runner keeps it local, bounds the serialized copy
retained across a run, and performs no network or logging calls itself. It is not a command sandbox,
redactor, or encryption boundary.

## Versioned contracts

Lifecycle and evidence types are part of the v0.1 application contract and feed protocol version 1.
Ordering or field-meaning changes require core, protocol, adapter, and compatibility-test review.

## Testing

    pnpm --filter @verify/verification test
    pnpm --filter @verify/verification typecheck

Tests cover ordered execution/events, pre-start cancellation, and bounded retained output.
