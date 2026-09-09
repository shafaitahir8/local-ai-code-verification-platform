# Local-First AI Code Verification Platform

A private, local verification layer for human- and AI-written code. The deterministic v0.1.0 milestone orchestrates a repository's existing checks, normalizes their evidence, and produces one release decision without requiring an LLM.

## Current MVP scope

The Iterations 0-4 target provides:

- Git repository discovery and changed-file inspection;
- project discovery for common Node, TypeScript, and Python signals;
- source-controlled **.verify/project.yml** configuration;
- execution of user-configured test, lint, typecheck, build, or other commands;
- streaming stdout/stderr, timeout, cancellation, duration, and exit evidence;
- normalized PASS, WARN, or BLOCK quality gates;
- local SQLite run history;
- human-readable CLI output and stable JSON output;
- a minimal accessible Tauri desktop dashboard using the same core engine.

The MVP does not include AI, model downloads, risk scoring, dependency/blast-radius analysis, generated tests, MCP, native framework adapters, cloud accounts, authentication, telemetry, or an unrestricted shell.

## Architecture

    CLI --------+
                +---- headless core ---- ports ---- local adapters
    Desktop ----+           |
                            +---- domain and policy

The CLI and desktop never implement verification rules independently. The desktop exchanges versioned NDJSON messages with the local engine over stdin/stdout. See **ARCHITECTURE.md** and **docs/ADR/**.

## Prerequisites

- Node.js 22.12 or newer
- Corepack and pnpm
- system Git executable
- Rust stable plus Tauri 2 platform prerequisites to build or run the desktop application

## Install and validate

    corepack enable
    pnpm install
    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm build

If `corepack enable` cannot create shims in the Node.js installation directory, use the verified
fallback by prefixing each package-manager command with Corepack, for example
`corepack pnpm install` and `corepack pnpm test`.

The root build compiles the packages, CLI, and browser frontend. It does not compile the native
Tauri shell. Build that boundary separately after building the engine:

    pnpm --filter @verify/cli build
    pnpm --filter @verify/desktop desktop:build

Windows x64 native delivery was validated locally on 2026-09-09 with Rust/Cargo, MSVC, and the
Windows SDK. The production build includes a self-contained sidecar and has passed an installed,
outside-checkout workflow smoke test without Node.js on the application runtime `PATH`. Generated
sidecars and installers remain ignored build artifacts; reproduce the native and installed-package
checks before treating a new source revision as release-ready.

## CLI

The first-class commands are:

    verify init
    verify discover
    verify inspect
    verify run
    verify run --json
    verify gate
    verify history

From the workspace during development, use the root wrapper and pass the target repository path:

    pnpm verify init C:\path\to\repository
    pnpm verify discover C:\path\to\repository
    pnpm verify inspect C:\path\to\repository
    pnpm verify run C:\path\to\repository
    pnpm verify history C:\path\to\repository

The equivalent package command is **pnpm --filter @verify/cli dev COMMAND**. After building, invoke **node apps/cli/dist/index.js COMMAND**. Packaged installs expose the **verify** binary directly.

- **verify init** detects the repository and suggests suites only from commands it can prove exist. It creates **.verify/project.yml**; use **--force** to explicitly replace an existing file.
- **verify discover** reports project markers and safe suite suggestions without writing configuration.
- **verify inspect** reports root, branch, changed files, staged/unstaged state, additions, deletions, and status.
- **verify run** validates configuration, shows and executes configured commands, streams progress, stores the normalized run, and evaluates the gate.
- **verify run --json** writes stable machine-readable output without human progress text on stdout.
- **verify gate** returns the latest persisted verification decision.
- **verify history** lists recent persisted runs; use **--limit N** to request up to 100 entries.

All repository commands accept an optional repository path and support **--json**. The
**protocol** command is reserved for the desktop's NDJSON transport and does not accept a repository
argument.

CLI exit codes:

| Code | Meaning                               |
| ---- | ------------------------------------- |
| 0    | PASS, or WARN under the v0.1.0 policy |
| 1    | BLOCK                                 |
| 2    | Configuration or execution error      |
| 3    | Interrupted                           |

An unavailable executable, invalid configuration, timeout, or internal failure never becomes PASS.

## Project configuration

Configuration is committed with the repository at **.verify/project.yml**:

    version: 1
    project:
      name: example-project

    suites:
      test:
        type: test
        command: npm test
        failure_policy: block
        timeout_ms: 120000

      lint:
        type: lint
        command: npm run lint
        failure_policy: warn

Only commands explicitly present in validated configuration can run. Review repository configuration before invoking verification because commands execute locally with your user permissions.

`timeout_ms` is optional and must be a positive integer. Missing `type` values default to the suite
ID; missing `failure_policy` values default to `warn` for lint suites and `block` otherwise. Run
history defaults to **~/.verify/history.sqlite3** and can be redirected with
**VERIFY_DATABASE_PATH**.

## Quality gate

| Gate  | Meaning                                                              |
| ----- | -------------------------------------------------------------------- |
| PASS  | All relevant configured checks passed.                               |
| WARN  | No blocking check failed, but at least one warn-policy check failed. |
| BLOCK | At least one block-policy check failed; the change is not ready.     |

Operational errors remain separate from gate success. The interface always communicates status with text and semantics, not color alone.

## Desktop

The Tauri dashboard supports selecting a repository, reviewing detected project information and Git changes, initializing configuration, reviewing checks, running verification with live progress, viewing the final gate, and reading recent local history.

Run the browser UI with **pnpm --filter @verify/desktop dev**. With Rust and the platform-specific Tauri prerequisites installed, run the native application with **pnpm --filter @verify/desktop tauri dev** and build it with **pnpm --filter @verify/desktop desktop:build**.

The desktop is a client of the same headless use cases as the CLI. It requires no server port and contains no command-execution or gate-calculation logic.

The packaged Windows application includes its self-contained verification engine and SQLite addon;
end users do not need Node.js, npm, pnpm, or the development checkout. Git and any tools invoked by
the selected repository's own configured checks must still be installed. See the
**[user guide](docs/guides/USER_GUIDE.md)** for the complete desktop workflow and troubleshooting.

## Privacy and command trust

Source and run evidence remain local by default, and the MVP adds no telemetry or cloud AI. Configured commands are trusted local processes, not sandboxed processes; they can do anything the current user can do. Read **SECURITY.md** before using configuration from an untrusted repository.

## Development

Start with **CONTRIBUTING.md** and **AGENTS.md**. Delivery slices are documented under **docs/tasks/**, and durable decisions under **docs/ADR/**. The product specification remains under **Initial Scope/**.

The deterministic MVP is a pre-1.0 foundation. Future capabilities must extend its ports and adapters without making the stable core depend on AI.
