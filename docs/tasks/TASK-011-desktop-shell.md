# TASK-011: Desktop Shell and Core Transport

- Status: Implemented; native validation pending platform prerequisites
- Iteration: 4
- Depends on: TASK-009, TASK-010

## Goal

Create the Tauri 2, React, TypeScript, Vite, and Tailwind desktop shell with accessible UI foundations and a narrow sidecar client for protocol version 1.

## Non-goals

- No verification dashboard behavior yet, business logic in React/Rust, network server, AI chat, updater, or broad filesystem/shell permission.

## Packages affected

**@verify/desktop**, **@verify/ui**, **@verify/protocol** types/client.

## Acceptance criteria

- Browser frontend and Tauri shell start with documented commands.
- Native repository selection returns an explicit local path through a narrow Tauri command.
- Sidecar lifecycle handles start, request correlation, streaming events, errors, interruption, and exit.
- Tauri capabilities allow only required dialog/process operations.
- Base controls support keyboard use, visible focus, semantic labels, contrast, light/dark, and reduced motion.

## Tests required

- Protocol-client unit tests with split/coalesced frames and process failures.
- React shell accessibility/component smoke tests.
- Tauri configuration/capability validation and packaged-app smoke test where platform prerequisites exist.
