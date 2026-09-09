# ADR-008: Graceful Cancellation over the Existing Protocol Session

- Status: Accepted
- Date: 2026-09-08
- Applies to: Protocol server, core verification orchestration, desktop sidecar bridge

## Context

Terminating the verification-engine process immediately can prevent the core from normalizing and
persisting an interrupted run. The desktop also needs to cancel a command that is already producing
output or a run that has been accepted but is waiting behind another protocol operation. This must
not move verification or persistence logic into Rust and must remain compatible with protocol
version 1.

## Decision

Add `verification.cancel` as an additive protocol version 1 method. A cancellation request has its
own request ID and carries `{ "targetRequestId": "<verification.run request id>" }`. Its result is
`{ "accepted": true }` only for the first cancellation accepted by an active or queued target.
Unknown targets, repeated cancellation, and targets that have already reached a terminal response
return `{ "accepted": false }`.

The protocol session continues reading stdin while work executes. It serializes ordinary requests,
registers each run's `AbortController` before queuing the run, and lets cancellation requests bypass
the ordinary queue. Active request IDs must be unique; a duplicate is rejected with a structured
`INVALID_REQUEST` error. End-of-input stops accepting frames and then drains all accepted work.

Cancellation is cooperative through the existing core signal boundary. The original run, not the
cancellation request, emits `run.completed` and its terminal `verification.run` result after the
core persists status `cancelled`. If cancellation occurs before any check starts, the empty
cancelled run has a BLOCK gate so interruption can never become WARN or PASS. Process-tree
termination remains inside the command adapter, with native force termination reserved for a
bounded unresponsive-engine fallback.

The native bridge registers the spawned engine before writing either frame and writes a pending
original request plus cancellation in that order. A negative cancellation acknowledgement does not
replace the independently correlated original terminal response. A positive acknowledgement is
accepted only when that terminal response contains a persisted run with status `cancelled`.

## Compatibility

The new method adds a validated request/result pair without removing or reinterpreting any existing
version 1 field, method, event, or result. Clients that do not send it retain their existing behavior.
Clients that do send it must continue reading both the cancellation result and the independently
correlated terminal result for the target run.

## Consequences

- A single sidecar stdin must remain open until the target run reaches a terminal response.
- Cancellation can be accepted before a queued run starts, so the run still performs the minimum
  core work required to create and persist deterministic interruption evidence.
- A lost or unresponsive sidecar may still require bounded process-tree cleanup, but that fallback
  cannot be reported as a gracefully persisted cancellation.
- Windows release processes are contained in a kill-on-close Job Object so bounded fallback also
  terminates descendants of the sidecar.
- Protocol tests must cover active, queued, unknown, repeated, and post-terminal cancellation,
  duplicate active request IDs, terminal correlation, persistence, and suppression of later checks.

## Alternatives considered

- Immediate sidecar termination was rejected because it loses the terminal run and can lose history.
- OS-only signals were rejected as the primary contract because delivery differs across Windows GUI
  process environments and cannot acknowledge whether the intended run accepted cancellation.
- A second cancellation process or local network endpoint was rejected because it adds lifecycle or
  attack-surface complexity without improving the existing stdio session.
