# ADR-005: Use a Versioned NDJSON Protocol over Standard I/O

- Status: Accepted
- Date: 2026-09-07
- Applies to: Desktop/core communication and daemon mode

## Context

The desktop must receive live command output and terminal verification results from the same headless engine used by the CLI. Parsing human console text is unstable, while a local HTTP server introduces port management and a larger attack surface.

## Decision

Use newline-delimited JSON over a child process's stdin/stdout. Every schema-validated envelope contains protocolVersion 1 and a request id. Requests contain method and params; streaming messages contain event and data; completion contains exactly one result or structured error. Protocol stdout is reserved for frames and diagnostics use stderr.

## Reasons

- NDJSON naturally streams progress while remaining simple to inspect and test.
- Request IDs support correlation and cancellation without a network service.
- Versioned typed schemas prevent the GUI from scraping arbitrary logs.
- The same transport can be exercised independently of Tauri.

## Consequences

- Any accidental non-protocol stdout output can corrupt framing and must be prevented by tests.
- Message schemas and event ordering become compatibility contracts.
- Unsupported versions, malformed frames, unknown methods, and duplicate terminal responses need explicit errors.
- Packaging must manage the sidecar lifecycle, interruption, crashes, and target-specific executable paths.

## Alternatives considered

- Local HTTP/WebSocket transport was rejected for the MVP because it requires a listener and additional authentication/origin decisions.
- Ad hoc console parsing was rejected because it cannot provide a stable or safe interface.
- Direct Tauri business commands were rejected because they would duplicate or move core logic into Rust.
