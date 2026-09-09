# Local Code Verifier User Guide

## Purpose

Local Code Verifier gives a Git repository one deterministic release decision. It runs only the
checks declared by that repository, collects their evidence, and reports **PASS**, **WARN**, or
**BLOCK**. Verification and history remain on the local computer; v0.1.0 does not use AI, cloud
services, telemetry, or a network server.

## Features

- Opens a local Git repository and summarizes its branch and changed files.
- Suggests checks from project metadata and stores approved commands in `.verify/project.yml`.
- Runs configured test, lint, typecheck, build, and other generic commands with live output.
- Applies deterministic block-or-warn policy to normalized results.
- Persists recent run history in a local SQLite database.
- Stops an active run gracefully, saves it as cancelled with a BLOCK gate, and cleans up its process
  tree.
- Uses the same verification core from the Windows desktop application and the CLI.
- Ships the Windows desktop engine with its own runtime, so end users do not need Node.js, npm, or
  pnpm.

## Before you begin

The selected folder must be a Git repository, and Git must be installed and available to the
application. A normal repository contains a `.git` directory or is a worktree registered with Git.
The installed Windows application does not require the source checkout or an installed Node.js
runtime.

Configured checks run locally with your user permissions. Review `.verify/project.yml` before
running checks from a repository you do not trust.

## Use the desktop application

1. Launch **Local Code Verifier**.
2. Choose **Browse…**, select the repository, and choose **Open project**. You can also enter its path
   directly.
3. Review the Git summary and the configured or suggested checks.
4. If the repository has no configuration, review every suggested command and choose **Initialize
   project**. This creates `.verify/project.yml` without overwriting an existing file.
5. Edit `.verify/project.yml` in your editor if a command, timeout, or failure policy needs to change,
   then choose **Inspect again**.
6. Choose **Run verification**. The dashboard shows live output and each completed check.
7. Read the final gate and its reasons. Select an item under **Recent runs** to reopen persisted
   evidence, or choose **Return to latest** to leave history view.

Choose **Stop run** to cancel active verification. The application waits for the engine to stop the
current command, persist the interrupted run, and release its child processes. A confirmed cancelled
run is deliberately BLOCK, never PASS or WARN.

## Interpret the gate

| Gate      | Meaning                                                                              |
| --------- | ------------------------------------------------------------------------------------ |
| **PASS**  | All configured checks passed.                                                        |
| **WARN**  | A warn-policy check failed, but no blocking check failed.                            |
| **BLOCK** | A block-policy check failed, a check was cancelled, or required evidence is missing. |

Configuration and execution errors are shown separately and are never converted into a successful
gate.

## Configure a repository

Configuration lives at `.verify/project.yml` in the repository. A minimal example is:

```yaml
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
```

Only commands explicitly listed in this file are executed. `failure_policy: block` makes a failed
check BLOCK the run; `failure_policy: warn` makes it WARN when no blocking check fails.

## Use the CLI from a development checkout

Install the workspace prerequisites, then run commands from the project root:

```powershell
pnpm install
pnpm verify inspect "C:\path\to\repository"
pnpm verify run "C:\path\to\repository"
pnpm verify gate "C:\path\to\repository"
pnpm verify history "C:\path\to\repository"
```

Use `pnpm verify init "C:\path\to\repository"` to create configuration after reviewing discovered
commands. Add `--json` to supported commands for stable machine-readable output.

## Local data

Repository policy stays in `.verify/project.yml`. Run history defaults to
`%USERPROFILE%\.verify\history.sqlite3`; developers and automation can override it with
`VERIFY_DATABASE_PATH`. Stored command output may contain sensitive repository information and is
not encrypted by v0.1.0.

## Troubleshooting

### No Git repository was found

Select the repository itself or a folder inside it. A normal project folder that has not been
initialized with Git cannot be verified. Confirm the intended folder with:

```powershell
git -C "C:\path\to\repository" status
```

Initialize Git only when that folder is intentionally meant to become a repository.

### No checks are available

Review the suggested checks. If discovery cannot prove which commands are safe, create or edit
`.verify/project.yml` explicitly and choose **Inspect again**.

### A command fails to start

The runtime required by that repository's configured command must still be installed. For example,
the desktop engine itself does not require Node.js, but a repository configured to run `npm test`
does require npm for that check.

### A previous run is not shown

Open the same repository root and check **Recent runs**. History is scoped by normalized repository
path and by the database location used when the run was saved.
