# ADR-002: Implement the Headless Core in TypeScript

- Status: Accepted
- Date: 2026-09-07
- Applies to: Domain, core, CLI, protocol, and verification packages

## Context

The same deterministic engine must serve a CLI, desktop client, and future interfaces. The project needs strong types, a shared schema vocabulary, cross-platform subprocess and Git integration, and one primary language across core and UI. Tauri still requires a small Rust boundary.

## Decision

Implement domain types, application use cases, adapters, protocol schemas, CLI, and React UI in strict TypeScript. Run the core on Node.js during development and package the same behavior as a release executable/desktop sidecar later. Restrict Rust to Tauri-native responsibilities unless a separate ADR documents a concrete need.

## Reasons

- Shared types reduce drift among domain, CLI JSON, protocol, and GUI state.
- Node provides mature cross-platform process, filesystem, and Git integration.
- One primary language lowers maintenance cost for a small pre-1.0 team.
- TypeScript supports independent packages and explicit port contracts.

## Consequences

- Runtime inputs still require schema validation; compile-time types are not a security boundary.
- Node/runtime and ESM compatibility must be tested across supported platforms.
- A release sidecar strategy must account for native SQLite dependencies and target-specific packaging.
- Performance-sensitive native work can be introduced only after evidence and an ADR justify it.

## Alternatives considered

- A Rust core was rejected for the MVP because it would duplicate more types across the frontend and slow the first deterministic slice.
- Python was rejected because it conflicts with the specified primary stack and complicates desktop distribution.
