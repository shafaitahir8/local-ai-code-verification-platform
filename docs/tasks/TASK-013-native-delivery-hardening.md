# TASK-013: Native Delivery Hardening

- Status: Active
- Iteration: 4.1
- Depends on: TASK-011, TASK-012

## Goal

Turn the implemented Windows Tauri shell into a validated, portable desktop delivery: compile the
native bridge, package the existing TypeScript verification engine as a self-contained sidecar,
persist graceful interruptions, and prove the installed application works outside the development
checkout without a system Node.js dependency.

## Non-goals

- No framework-specific verification adapters, code intelligence, risk engine, MCP, AI, cloud
  services, telemetry, updater, or unrelated UI redesign.
- No change to configuration schema version 1, protocol version 1, gate semantics, or CLI exit codes.
- No verification business logic in React or Rust.

## Architecture

- The TypeScript CLI/core remains the single verification engine and is packaged for release as a
  target-specific self-contained executable.
- Tauri launches the packaged engine through its declared `externalBin`; development may retain an
  explicit local-engine override.
- Cancellation is requested through the existing engine boundary so the core can normalize and
  persist a cancelled run. Process-tree termination remains a bounded fallback for an unresponsive
  engine.

## Packages affected

**apps/desktop**, **apps/cli**, **@verify/protocol**, **@verify/core**, **@verify/verification**,
**@verify/storage**, build scripts, Windows CI, and delivery documentation as required by the
vertical slice.

## Acceptance criteria

- `Cargo.lock` is generated and retained; Rust formatting, checking, linting, and tests pass.
- The Tauri application builds and launches on Windows x64.
- The bundled engine runs without system Node.js and without paths into the development checkout.
- A packaged application verifies a real repository and produces PASS, WARN, and BLOCK through the
  unchanged protocol/core behavior; run history persists across launches.
- User cancellation persists an interrupted run and leaves no engine or verification child process.
- Windows CI covers native compilation, sidecar construction, and a noninteractive packaged-engine
  smoke test.
- The release gate remains open until the packaged application itself passes an outside-checkout
  launch and workflow smoke test.

## Tests required

- Existing TypeScript unit and integration suites remain green.
- Rust unit tests cover invocation selection, protocol validation, cancellation state, and process
  cleanup helpers where practical.
- Self-contained engine tests run with Node removed from the child environment.
- Native development and release builds are exercised on Windows.
- A copied/installed bundle is smoke-tested outside the repository checkout.

## Edge cases

- Missing or mismatched target-specific sidecar.
- Paths containing spaces and non-ASCII characters.
- Cancellation before launch, during command output, and after terminal completion.
- Engine crash, malformed protocol output, duplicate terminal messages, timeout, and forced cleanup.
- Existing run-history migration and database paths outside the checkout.
