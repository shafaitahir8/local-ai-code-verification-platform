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

## Iteration 5 status

Iteration 5 is complete. Its implemented slices add bounded, deterministic understanding
for Node projects using Vite, Vitest, or Jest; Python packaging and pytest evidence; declared
npm/pnpm/Yarn workspaces; mixed Node/Python repositories; and plain static sites confirmed when a
complete inventory finds a root `index.html` without Vite evidence. Opening a repository builds the
same versioned `ProjectProfile` through the core, protocol, CLI, native bridge, and desktop. The
profile reports detected tooling, workspace units, scripts, test locations, confidence,
ambiguities, warnings, and the file evidence behind each conclusion. A Vite project that also
contains `index.html` remains classified as Vite rather than as a plain static site.

Profiling is read-only: it does not run a discovered script, start a static preview server, write
repository or configuration files, or initialize the SQLite run-history database. Observed scripts
are unapproved task candidates, not executable policy; the static-site preview finding is a
capability, not a command. Pytest is not inferred from filenames alone, and declared workspace or
test/run alternatives remain visible without a guessed default. A scan that reaches a configured
budget returns an explicit partial profile, while a stopped scan returns a distinct cancelled
result. Configuration schema version 2 and AI are not implemented by these slices.

## Iteration 6 status

Iteration 6 slice 6A adds a read-only deterministic verification-plan preview for complete,
unambiguous, single-root Node/Vite/Vitest profiles. It shows distinct Quick and Full plans, keeps
selected and skipped observed checks visible, and explains each decision with capability and file
evidence. Quick favors confirmed tests and lint; Full also includes eligible typecheck and build
checks. Missing or conflicting evidence fails closed, and no command is invented.

This preview does not execute checks, write `.verify/project.yml`, initialize run-history storage,
persist a plan, create an approval, or affect PASS/WARN/BLOCK.

Slice 6B adds an explicit schema-v1 to schema-v2 migration. Preview returns a deterministic target
YAML and exact diff without writing. Apply requires both reviewed SHA-256 revisions, rejects a
changed source, and atomically replaces only the policy file. Version 2 preserves named suites and
adds proposed Quick/Full membership; migration does not approve commands. Smart-plan execution and
AI remain later slices.

Slice 6C adds local approval receipts for the current schema-v2 executable policy. The status
shows the exact suites, commands, and Quick/Full membership bound to a semantic SHA-256 digest.
An explicit Approve records that digest locally; Revoke removes current authorization. YAML
formatting or comments do not invalidate approval, but an executable-policy change does. Migration
never auto-approves. This slice still has no smart-plan execution or AI.

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
    verify understand
    verify plan
    verify config migrate
    verify config approval status
    verify config approval approve --expected-digest DIGEST
    verify config approval revoke
    verify inspect
    verify run
    verify run --json
    verify gate
    verify history

From the workspace during development, use the root wrapper and pass the target repository path:

    pnpm verify init C:\path\to\repository
    pnpm verify discover C:\path\to\repository
    pnpm verify understand C:\path\to\repository
    pnpm verify plan C:\path\to\repository
    pnpm verify config migrate C:\path\to\repository
    pnpm verify config approval status C:\path\to\repository
    pnpm verify inspect C:\path\to\repository
    pnpm verify run C:\path\to\repository
    pnpm verify history C:\path\to\repository

The equivalent package command is **pnpm --filter @verify/cli dev COMMAND**. After building, invoke **node apps/cli/dist/index.js COMMAND**. Packaged installs expose the **verify** binary directly.

- **verify init** detects the repository and suggests suites only from commands it can prove exist. It creates **.verify/project.yml**; use **--force** to explicitly replace an existing file.
- **verify discover** reports project markers and safe suite suggestions without writing configuration.
- **verify understand** runs the bounded deterministic scan and reports the project profile without
  executing discovered commands or writing repository, configuration, or history state. Use
  **--json** for the protocol-equivalent typed result; interrupting the scan exits with code 3.
- **verify plan** performs the same bounded scan and shows read-only Quick and Full recommendations,
  including selected/skipped reasons and evidence. Use **--json** for the protocol-equivalent typed
  result; it runs no check and saves no plan.
- **verify config migrate** previews the exact schema-v2 policy and YAML diff without writing. Apply
  requires an explicit `--apply` plus the source and target digests printed by that preview.
- **verify config approval status** shows the validated executable-policy review and local receipt
  state. **approve** requires its reviewed digest; **revoke** explicitly withdraws approval. These
  commands do not run the plan or write repository policy.
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

Schema version 1 remains supported unchanged. Explicit migration to version 2 preserves these
named suites and adds proposed Quick/Full membership plus currently empty reserved policy fields.
Migration and command approval are separate operations. Approval receipts are stored locally in
SQLite, not in the repository file. The existing configured `verify run` behavior is unchanged;
the new Quick/Full plan is not executable yet.

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

The Tauri dashboard supports selecting a repository, reviewing detected project information and Git
changes, initializing configuration, reviewing checks, running verification with live progress,
viewing the final gate, and reading recent local history. Opening a repository starts one bounded
deterministic scan that supplies both the project profile and the read-only Quick/Full plan preview.
**Understand Project** refreshes that matching pair, **Stop project scan** cancels only the
correlated operation, and expandable evidence explains each detection and recommendation.
Configured version-1 repositories also expose a review-only migration card with the exact YAML diff;
opening a repository never applies migration automatically.
For schema-v2 policy, a separate approval card shows the exact executable commands and plan
membership associated with its current digest, plus Not approved, Approved, or Approval outdated
state. Approve and Revoke require explicit actions; neither runs a command.

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
