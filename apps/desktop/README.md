# Desktop application

## Purpose

Provides the accessible Tauri 2/React engineering dashboard and a thin native bridge to the same
headless protocol engine used by the CLI. React never inspects Git, loads YAML, executes commands,
evaluates a gate, or persists results.

## Public behavior

- Select or enter a local Git repository and inspect detected project/configuration state.
- Review branch, changed files, configured checks, current gate, live progress, and run history.
- Initialize `.verify/project.yml`, run verification, interrupt an active request, and open the
  repository with keyboard-accessible controls.
- `ProtocolEngineClient`, `EngineClient`, `EngineTransport`, and `TauriEngineTransport` form the
  typed UI/engine boundary.

## Development

Build the engine first, then start Tauri:

```bash
pnpm --filter @verify/cli build
pnpm --filter @verify/desktop tauri dev
```

The Rust bridge starts `node apps/cli/dist/index.js protocol`, writes one protocol-v1 request,
streams ordered event frames through a Tauri IPC channel, and returns the terminal frame. Native
requests are serialized to avoid concurrent migration/bootstrap races. Override the development
engine only with `VERIFY_ENGINE_COMMAND` and `VERIFY_ENGINE_ARGS_JSON` (a JSON string array).

`pnpm --filter @verify/desktop dev` runs a browser-only visual preview with deterministic mock data;
query parameters `?scenario=WARN`, `?scenario=BLOCK`, and `?uninitialized=1` exercise major states.
That preview does not claim native/core integration.

## Allowed dependencies

React, Vite, Tailwind, `@verify/ui`, protocol types/codecs, Tauri's browser API, and a minimal Rust
shell using Tauri, Tokio process/IO primitives, Serde, and the native folder dialog.

## Forbidden dependencies

Core business rules in React or Tauri commands, direct Git/YAML/SQLite access from components,
unrestricted remote commands, network servers, telemetry, cloud services, and AI/chat behavior.

## Data owned

Ephemeral dashboard/view state, theme preference, progress presentation, repository-input state,
request correlation, and native child-process IDs. Configuration and run history remain owned by the
headless engine.

## Important invariants

- Every engine message is validated by protocol version 1 before it updates UI state.
- Status always includes text/icon semantics rather than color alone.
- Controls remain keyboard reachable with visible focus, focus restoration, live regions, reduced
  motion, high contrast, and light/dark compatibility.
- Native child PIDs are removed after both success and failure; cancellation targets the process tree.

## Security and privacy

The shell exposes only repository selection and versioned engine-request/interrupt commands. The
capability grants no generic Tauri core APIs. Local paths and command output stay inside the process,
but the development engine inherits the user's permissions and environment and is not sandboxed.

## Versioned contracts

The client accepts protocol version 1 only. Tauri config/application version is 0.1.0. UI behavior
must remain a projection of engine data rather than an independently versioned gate implementation.

## Packaging boundary

The generated app icons and Tauri bundle configuration are present. The development bridge still
uses the installed Node runtime and a checkout-relative CLI bundle. A distributable installer needs
a target-specific self-contained engine sidecar declared as `externalBin`; installers produced
before that work would not be portable away from the checkout.

Native validation also requires Rust/Cargo, MSVC, and Windows SDK libraries. Those prerequisites are
missing on the current Windows machine, so the native build is explicitly unrun rather than passing.

## Testing

    pnpm --filter @verify/desktop test
    pnpm --filter @verify/desktop typecheck
    pnpm --filter @verify/desktop build
    pnpm --filter @verify/desktop desktop:build

The first three commands cover the React/protocol client and browser bundle. The final command is the
platform-specific native check. Tests explicitly cover empty, loading, running, PASS, WARN, BLOCK,
error, and historical-run states, plus keyboard behavior, focus return, accessibility scanning, and
split/coalesced protocol frames. A child-process integration test compares the GUI protocol client
with CLI JSON output from the same headless engine; no native sidecar smoke result is claimed on this
machine.
