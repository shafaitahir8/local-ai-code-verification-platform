# ADR-012: Generalize Correlated Cancellation for Long-Running Operations

- Status: Accepted
- Date: 2026-09-11
- Applies to: Protocol, project analysis, local AI, test discovery, and project launch

## Context

ADR-008 defines graceful correlated cancellation for `verification.run`. Future repository scans,
AI analysis, test discovery, and project launch can also be long-running. Each needs consistent
progress and Stop behavior without changing verification-run persistence or turning the Rust bridge
into an application layer.

## Decision

Add `operation.cancel` as an additive protocol-version-1 method. It targets the request ID of any
registered cancellable operation and follows the accepted/unknown/repeated/post-terminal semantics
already defined for `verification.cancel`.

The shared registry backs both methods. The first accepted cancellation through either method wins;
another cancellation for the same target returns `accepted: false`. Iteration 5 introduces this
general method for `project.profile`; later iterations register AI analysis, test discovery, and
launch operations without changing its semantics.

Keep `verification.cancel` supported with its current meaning. The original request remains
responsible for its typed terminal result. Long-running operations stream typed phase, progress,
log, and terminal events correlated to that request. The protocol server remains responsive to
cancellation while ordinary work is serialized or deliberately scheduled by the core.

Cancellation is cooperative through `AbortSignal` boundaries. Owned subprocesses remain contained
and use bounded process-tree termination only when cooperative shutdown does not complete.
Verification cancellation still persists a cancelled `VerificationRun`. Iteration 5 deterministic
profiling remains unpersisted; later AI analyses and launch sessions use their own typed operation
records and never produce synthetic gates.

A cancelled `project.profile` request returns a typed cancelled terminal result without a partial
profile. A budget-limited scan is different: it completes successfully with an explicitly partial
profile and limit warnings. Interfaces retain any previous completed profile when a refresh is
cancelled.

## Compatibility

No existing request, result, event, or field is removed or reinterpreted. Clients may continue to
use `verification.cancel`. New clients use `operation.cancel` only after selecting a method declared
cancellable by the engine.

## Consequences

- Cancellable operations need a registry, unique active request IDs, terminal cleanup, and contract
  tests equivalent to verification cancellation.
- The native bridge must route multiple typed event streams while remaining transport-only.
- A cancellation acknowledgement is not a substitute for the target request's terminal result.
- Persisting partial analysis is optional and use-case-specific; no incomplete result may be
  presented as a completed fact.

## Alternatives considered

- Adding a separate cancel method for every action was rejected because it would duplicate the same
  correlation and lifecycle rules.
- Killing the sidecar for Stop was rejected because it loses typed terminal state and can prevent
  persistence.
