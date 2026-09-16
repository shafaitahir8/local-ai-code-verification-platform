# @verify/protocol

Defines protocol version 1 for structured communication between the headless engine and local
clients such as the Tauri desktop.

## Purpose

Owns typed, runtime-validated NDJSON framing so interfaces can call the headless engine without
depending on its concrete composition.

## Transport

Each request and server message is one UTF-8 JSON object followed by `\n` (NDJSON) over
stdin/stdout. Human logs must go to stderr and must never be mixed into this stream. Request IDs
correlate events and terminal results when several operations are in flight.

## Public API

- `ProtocolRequest` and method-specific `ProtocolParamsMap` / `ProtocolResultMap` types.
- `ProtocolEventMessage`, `ProtocolResultMessage`, and `ProtocolErrorMessage` envelopes.
- Zod schemas for every request, event, domain result, and error payload.
- `encodeRequest`, `encodeEvent`, `encodeResult`, and `encodeError` for validated output.
- `decodeRequestLine`, `decodeServerMessageLine`, and `decodeResultLine` for validated input.
- `NdjsonDecoder` plus request/server decoder factories for arbitrarily chunked stdio reads.

## Allowed dependencies

`@verify/domain` and Zod for runtime contract validation. String/JSON facilities may be used for
transport framing.

## Forbidden dependencies

Core use-case execution, Git, subprocess spawning, SQLite, React, Tauri, policy evaluation, network
listeners, and human console formatting.

## Data owned

Protocol version 1 request parameters, result mappings, event/error envelopes, method names,
runtime schemas, request correlation, and bounded NDJSON decoding. Domain payload meaning remains
owned by its source package.

## Version 1 methods

- `project.discover`
- `project.profile`
- `verification.plan`
- `config.get`
- `config.init`
- `config.policy.get`
- `config.migrate.preview`
- `config.migrate.apply`
- `config.approval.status`
- `config.approval.approve`
- `config.approval.revoke`
- `repository.inspect`
- `verification.run`
- `verification.cancel`
- `operation.cancel`
- `gate.latest`
- `runs.list`

Events are `profile.progress`, `check.started`, `check.output`, `check.completed`, and
`run.completed`. Every request and server message carries `protocolVersion: 1`. Incompatible or
malformed input fails explicitly; it is never treated as console output or silently coerced.

`project.profile` performs bounded, deterministic, read-only repository profiling. It streams
`profile.progress` and returns either `{ "status": "completed", "profile": ... }` or
`{ "status": "cancelled" }`. A budget-limited scan is a completed partial profile, not a cancelled
result.

`verification.plan` runs the same bounded profile operation and projects its completed profile into
deterministic Quick and Full plan previews. It reuses `profile.progress` while profiling and returns
either `{ "status": "completed", "preview": ... }` or `{ "status": "cancelled" }`. The preview
copies observed task candidates and their evidence into selected or skipped decisions with reasons;
the method executes no command and persists no profile, plan, configuration, or run history.

`config.get` and `config.init` retain their strict schema-v1 results. The additive
`config.policy.get` inspects either supported policy version. `config.migrate.preview` returns a
read-only v1-to-v2 proposal with complete target YAML, exact diff, explanation, and source/target
SHA-256 digests. `config.migrate.apply` requires both reviewed digests; a stale source or target
proposal fails with `MIGRATION_STALE`. Migration does not approve or execute commands.

`config.approval.status` returns the current semantic executable-policy digest and local approval
state. `config.approval.approve` requires a reviewed `expectedPolicyDigest` and rejects a changed
policy with `APPROVAL_STALE`. `config.approval.revoke` explicitly revokes local approval. All three
return the same normalized status model; none executes a check or changes a quality gate.
Missing, invalid, or version-1 policies reject approval with `APPROVAL_UNAVAILABLE`; an active
receipt can still be revoked when the policy is unavailable.

`verification.cancel` is an additive version 1 control request. It has its own request ID and names
the active `verification.run` request in `params.targetRequestId`. Its terminal result is
`{ "accepted": true }` only when that run accepted its first cancellation request; unknown,
already-cancelled, and completed targets return `false`.

`operation.cancel` uses the same target-request correlation and acknowledgement rules for any
registered cancellable operation. `verification.cancel` remains supported with its existing
verification-specific meaning. The first accepted cancellation wins across both methods.

The stdio session continues reading while ordinary requests execute. Ordinary requests are
serialized, cancellation bypasses that queue, and a queued run is registered before execution so
it can be cancelled before its first check. Request IDs must be unique while active. EOF stops
accepting frames and drains accepted requests before process exit.

## Important invariants

- Standard output contains one validated JSON envelope per line and no human logs.
- Request IDs correlate every event and exactly one terminal result/error.
- An active duplicate request ID is rejected explicitly and cannot replace the original operation.
- Arbitrarily split/coalesced chunks decode in order; malformed, oversized, or incompatible input
  fails explicitly.
- Retained verification output is bounded before terminal run envelopes are encoded.

## Security and privacy

Protocol frames may contain repository paths and command output. The package validates structure and
bounds pending lines, but does not authenticate peers, redact payloads, encrypt transport, or open a
network listener. It is intended only for local stdio IPC.

## Versioned contracts

Every envelope carries `protocolVersion: 1`. Fields must not be removed or reinterpreted silently;
incompatible changes require a new protocol version and compatibility tests.

## Testing

    pnpm --filter @verify/protocol test
    pnpm --filter @verify/protocol typecheck

Tests cover every method/result schema, event and error round trips, framing across arbitrary chunks,
line limits, version rejection, correlation, and invalid JSON.
