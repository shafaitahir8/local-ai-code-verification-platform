# Desktop application

## Purpose

Provides the accessible Tauri 2/React engineering dashboard and a thin native bridge to the same
headless protocol engine used by the CLI. React never inspects Git, loads YAML, executes commands,
evaluates a gate, or persists results.

## Public behavior

- Select or enter a local Git repository and load a bounded, deterministic project profile without
  blocking the existing configuration, Git, gate, or history requests.
- Review evidence-backed project facts and observed command candidates, refresh them with
  `Understand Project`, and stop an active scan without executing a candidate or writing profile
  state.
- Review deterministic Quick and Full verification-plan previews with a selected/skipped reason and
  source evidence for every observed check. Previewing never executes a check or persists a plan.
- Review branch, changed files, configured checks, current gate, live progress, and run history.
- Initialize `.verify/project.yml`, run verification, interrupt an active request, and open the
  repository with keyboard-accessible controls.
- `ProtocolEngineClient`, `EngineClient`, `EngineTransport`, and `TauriEngineTransport` form the
  typed UI/engine boundary.

## Development

Tauri's development hook builds the target-specific engine before starting the web frontend and
native shell:

```bash
pnpm --filter @verify/desktop tauri dev
```

The Rust bridge starts the declared `verify-engine` sidecar in protocol mode, writes one protocol-v1
request, streams ordered event frames through a Tauri IPC channel, and returns the terminal frame.
Native requests are serialized to avoid concurrent migration/bootstrap races. Debug builds may use
an explicit `VERIFY_ENGINE_COMMAND` plus `VERIFY_ENGINE_ARGS_JSON` (a JSON string array); release
builds always resolve the bundled sidecar and ignore those development variables.

The additive `project.profile` method carries the same typed `ProjectProfile` produced by the
headless core. The `verification.plan` method performs one bounded scan and returns that profile
with normalized Quick and Full previews; both operations stream `profile.progress` events.
`operation.cancel` provides correlated cancellation for either read-only operation while the
existing `verification.cancel` contract remains supported. The bridge validates the terminal result
according to the target method: profiling or planning cancellation does not require or create a
persisted verification run.

`pnpm --filter @verify/desktop dev` runs a browser-only visual preview with deterministic mock data;
query parameters `?scenario=WARN`, `?scenario=BLOCK`, and `?uninitialized=1` exercise major states.
That preview does not claim native/core integration.

## Allowed dependencies

React, Vite, Tailwind, `@verify/ui`, protocol types/codecs, Tauri's browser API, and a minimal Rust
shell using Tauri, the Tauri shell plugin, Tokio coordination/timing primitives, Serde, the native
folder dialog, and Windows process APIs for Job Object containment.

## Forbidden dependencies

Core business rules in React or Tauri commands, direct Git/YAML/SQLite access from components,
unrestricted remote commands, network servers, telemetry, cloud services, and AI/chat behavior.

## Data owned

Ephemeral dashboard/view state, theme preference, profile/plan and verification progress
presentation, repository-input state, request correlation, and native child-process IDs.
Configuration and run history remain owned by the headless engine. Project profiles and plan
previews are not persisted.

## Important invariants

- Every engine message is validated by protocol version 1 before it updates UI state.
- Status always includes text/icon semantics rather than color alone.
- Controls remain keyboard reachable with visible focus, focus restoration, live regions, reduced
  motion, high contrast, and light/dark compatibility.
- Native sidecar stdout is bounded, UTF-8 NDJSON and is correlated before it crosses the IPC channel.
- Project profiling is read-only: observed scripts remain non-executable candidates, and the
  profile-only path writes no repository, configuration, or SQLite state.
- Plan previews are deterministic projections of the returned profile. They never execute an
  observed command, write configuration, create an approval, or affect PASS/WARN/BLOCK.
- Graceful cancellation uses `operation.cancel` for project profiling and planning and retains the
  last completed matching profile/plan pair. Verification continues to use `verification.cancel`
  and first requests a persisted cancelled run; an unresponsive engine is terminated after a
  bounded grace period.
- On Windows, the sidecar and descendants are assigned to a kill-on-close Job Object so fallback
  cleanup cannot intentionally leave a verification process tree behind.

## Security and privacy

The shell exposes only repository selection and versioned engine-request/interrupt commands. The
capability grants no generic Tauri core APIs. Local paths and command output stay inside the process,
but the development engine inherits the user's permissions and environment and is not sandboxed.

## Versioned contracts

The client accepts protocol version 1 only. Tauri config/application version is 0.1.0. UI behavior
must remain a projection of engine data rather than an independently versioned gate implementation.

## Packaging boundary

`pnpm build:engine:windows` creates
`src-tauri/binaries/verify-engine-x86_64-pc-windows-msvc.exe`, which Tauri consumes through
`externalBin`. The generated binary is a build artifact and remains ignored by Git. It embeds the
Node runtime, the bundled TypeScript engine, and the matching SQLite native addon; the installed app
does not resolve Node.js or source files from the development checkout.

Building the Windows package requires Node 24 x64, Rust/Cargo with the MSVC target, the x64 MSVC
compiler/linker, and a Windows SDK. A source build alone does not satisfy the release gate: the
installer and its actual installed workflow must also pass the outside-checkout smoke test.

## Testing

    pnpm --filter @verify/desktop test
    pnpm --filter @verify/desktop typecheck
    pnpm --filter @verify/desktop build
    pnpm --filter @verify/desktop desktop:build
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-installed-windows.ps1 ...

The first three commands cover the React/protocol client and browser bundle. The final command is the
platform-specific native check. Tests explicitly cover empty, loading, running, PASS, WARN, BLOCK,
error, and historical-run states, plus keyboard behavior, focus return, accessibility scanning, and
split/coalesced protocol frames, graceful cancellation state, and read-only Quick/Full plan
presentation. A child-process integration test compares profile and plan results from the GUI
protocol client with CLI JSON output from the same headless engine. Native Rust,
sidecar, installer, outside-checkout workflow, Node-independence, persistence, and process-cleanup
results must be recorded separately because browser tests cannot prove them.

The implemented Iteration 5 surface covers Node projects using Vite, Vitest, or Jest; Python
packaging and pytest evidence; declared npm/pnpm/Yarn workspaces; mixed Node/Python repositories;
and detection of a plain static site when a complete inventory finds a root `index.html` without
Vite evidence. A Vite project with `index.html` remains Vite, while a plain static site exposes only
a preview capability: the desktop does not start a preview server or execute a command. Workspace
units and multi-target ambiguities are displayed without a selected default. The same profile
contract and rendering path carry these findings, and profiling writes no repository,
configuration, or database state. The first Iteration 6 slice adds deterministic plan preview only
for a complete, unambiguous, single-root Node/Vite/Vitest profile. Plan execution and persistence,
schema-v2 behavior, approval receipts, AI, and smart command execution remain intentionally absent.
