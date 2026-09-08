# TASK-009: CLI and Engine Protocol

- Status: Complete
- Iteration: 1-4
- Depends on: TASK-008

## Goal

Expose init, inspect, run, gate, and history through the **verify** CLI, stable JSON output, documented exit codes, and a version 1 NDJSON protocol server for the desktop.

## Non-goals

- No separate interface business logic, console-text scraping, HTTP server, MCP, or CI-provider integration.

## Packages affected

**@verify/cli**, **@verify/protocol**, **@verify/core**, and composition wiring.

## Acceptance criteria

- Human commands are clear and **run --json** emits one stable document with no progress noise on stdout.
- CLI exit codes follow the PASS/WARN/BLOCK/error/interruption contract.
- Protocol requests, streaming events, terminal results, and structured errors include protocolVersion 1 and request id.
- Supported methods cover discovery, config read/init, inspection, run, latest gate, and history.
- Protocol mode rejects malformed/unsupported messages and reserves stdout for NDJSON frames.

## Tests required

- CLI parsing, output snapshot/schema, and exit-code tests.
- Protocol schema/framing, correlation, event-order, error, unsupported-version, and exactly-one-terminal-response tests.
- End-to-end child-process protocol test.
