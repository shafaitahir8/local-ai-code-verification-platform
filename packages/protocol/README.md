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
- `config.get`
- `config.init`
- `repository.inspect`
- `verification.run`
- `gate.latest`
- `runs.list`

Events are `check.started`, `check.output`, `check.completed`, and `run.completed`. Every request and
server message carries `protocolVersion: 1`. Incompatible or malformed input fails explicitly; it is
never treated as console output or silently coerced.

## Important invariants

- Standard output contains one validated JSON envelope per line and no human logs.
- Request IDs correlate every event and exactly one terminal result/error.
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
