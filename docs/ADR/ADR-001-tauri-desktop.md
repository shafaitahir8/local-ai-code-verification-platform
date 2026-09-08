# ADR-001: Use Tauri 2 for the Desktop Client

- Status: Accepted
- Date: 2026-09-07
- Applies to: Iteration 4 and later desktop releases

## Context

The product needs a cross-platform desktop dashboard that can select local repositories and present live verification state. Most product logic is TypeScript/Node and must also power the CLI. A desktop choice must not create a second verification implementation or require a network service.

## Decision

Use Tauri 2 with a React, TypeScript, Vite, and Tailwind frontend. Keep Rust limited to the native shell, filesystem dialog, process lifecycle, and narrow sidecar bridge. The desktop talks to the headless engine through the versioned stdio protocol and never calculates verification outcomes.

## Reasons

- Tauri provides a small native shell without adopting Electron as a second Node application runtime.
- It supports native repository selection and packaging while retaining the chosen web UI stack.
- A thin bridge preserves the CLI-first headless architecture.
- Local child-process IPC avoids exposing a network port.

## Consequences

- Desktop builds require Rust and platform-specific Tauri prerequisites in addition to Node tooling.
- Sidecar packaging and target-specific binaries need explicit release validation.
- Rust commands must remain narrowly allowlisted; adding business logic there is an architecture violation.
- Browser-only frontend development can proceed without a complete native toolchain, but it does not replace packaged-app testing.

## Alternatives considered

- Electron was rejected because it adds runtime weight and encourages duplication inside a desktop-specific Node process.
- A browser-hosted local web server was rejected for the MVP because it adds a network trust boundary.
- A fully native Rust UI was rejected because TypeScript/React is the selected application stack and would split UI development unnecessarily.
