# Local Code Verifier User Guide

## Purpose

Local Code Verifier gives a Git repository one deterministic release decision. It runs only the
checks declared by that repository, collects their evidence, and reports **PASS**, **WARN**, or
**BLOCK**. Verification and history remain on the local computer; v0.1.0 does not use AI, cloud
services, telemetry, or a network server.

The completed Iteration 5 slices can also build a read-only project profile for Node projects using
Vite, Vitest, or Jest; Python packaging markers and explicit pytest signals; declared
npm/pnpm/Yarn workspaces; mixed Node/Python repositories; and plain static sites with a root
`index.html`. The profile reports what it found and why without running project commands or changing
the repository.

Iteration 6 slice 6A also previews deterministic Quick and Full verification recommendations for a
complete, unambiguous, single-root Node/Vite/Vitest profile. These recommendations are read-only:
previewing never runs a check, approves a command, or saves configuration or history.

Slice 6B adds an explicit schema-v1 to schema-v2 policy migration. The application first shows the
complete proposed YAML and exact diff. It writes only after an explicit Apply action using the
reviewed revisions; migration remains separate from command approval.

## Features

- Opens a local Git repository and summarizes its branch and changed files.
- Builds a bounded deterministic profile of supported Node, Python, workspace, and plain-static
  metadata and shows confidence, ambiguities, warnings, and supporting file evidence.
- Previews selected and skipped checks in distinct Quick and Full plans for the supported
  Node/Vite/Vitest slice, with a reason and source evidence for each included check.
- Suggests checks from project metadata and stores explicitly configured commands in
  `.verify/project.yml`.
- Runs configured test, lint, typecheck, build, and other generic commands with live output.
- Applies deterministic block-or-warn policy to normalized results.
- Persists recent run history in a local SQLite database.
- Stops an active run gracefully, saves it as cancelled with a BLOCK gate, and cleans up its process
  tree.
- Uses the same verification core from the Windows desktop application and the CLI.
- Ships the Windows desktop engine with its own runtime, so end users do not need Node.js, npm, or
  pnpm.

## Current project-understanding scope

Iteration 5 is complete. The current sensors cover Node projects using Vite, Vitest, or
Jest; Python packaging and explicit pytest signals; declared npm/pnpm/Yarn workspace roots and
child scripts; mixed Node/Python repositories; and plain static sites confirmed when a complete
inventory finds a root `index.html` without Vite evidence. Conventional Python test paths strengthen
pytest evidence but cannot identify pytest by themselves. If a Vite project also contains
`index.html`, it remains classified as Vite instead of being labeled a plain static site.

Discovered scripts are displayed as unapproved candidates. Multiple credible workspaces, test
frameworks, test commands, or run commands are shown as ambiguities; none is selected automatically.
A plain static-site detection exposes a preview capability only; it does not start a preview server
or invent a command. Profiling never executes a command, changes `.verify/project.yml`, writes source
files, or creates run-history records. A profile can be complete, partial because a scan budget was
reached, or cancelled by the user. These states are shown separately. Profiling does not invoke AI
or migrate configuration. Planning is available only as a read-only preview for the first supported
Node/Vite/Vitest slice; it does not make discovered commands executable.

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
3. The application automatically starts its bounded deterministic project scan. Review the simple
   detected-project summary first, then expand the technical evidence to see why each item was
   detected.
4. Choose **Understand Project** to refresh the profile. While it runs, review its phase and progress
   or choose **Stop project scan**. A stopped scan remains distinct from a budget-limited partial
   profile; if a prior profile and plan preview exist, both remain displayed after a cancelled
   refresh.
5. Review **Verification Plan**. Quick selects eligible test and lint checks; Full also selects
   eligible typecheck and build checks. Expand technical evidence to see why each observed check was
   selected or skipped. This preview has no Run, Apply, Approve, or Save action.
6. If a configured repository is still at version 1, choose **Review Migration** to inspect a
   version-2 policy proposal. Read its summary and exact YAML diff before choosing **Apply
   Migration**. Opening a repository or reviewing the preview never rewrites the file. If someone
   edits the source after preview, apply reports a conflict and leaves their edit intact; refresh
   the preview first. Applying migration does not approve or run any command.
7. Review the Git summary and the configured or suggested checks.
8. If the repository has no configuration, review every suggested command and choose **Initialize
   project**. This creates `.verify/project.yml` without overwriting an existing file.
9. Edit `.verify/project.yml` in your editor if a command, timeout, or failure policy needs to change,
   then choose **Inspect again**.
10. Choose **Run verification**. The dashboard shows live output and each completed check.
11. Read the final gate and its reasons. Select an item under **Recent runs** to reopen persisted
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

Version 2 keeps those named suites and adds proposed Quick/Full suite membership. The migration
preview shows the exact change before an explicit apply. Migration is a policy-format change, not
local approval for future smart actions; the existing **Run verification** path still uses the
named suites rather than automatically executing the proposed plans.

## Use the CLI from a development checkout

Install the workspace prerequisites, then run commands from the project root:

```powershell
pnpm install
pnpm verify understand "C:\path\to\repository"
pnpm verify plan "C:\path\to\repository"
pnpm verify config migrate "C:\path\to\repository"
pnpm verify inspect "C:\path\to\repository"
pnpm verify run "C:\path\to\repository"
pnpm verify gate "C:\path\to\repository"
pnpm verify history "C:\path\to\repository"
```

Use `pnpm verify init "C:\path\to\repository"` to create configuration after reviewing discovered
commands. `pnpm verify understand` performs the same read-only profiling exposed by the desktop;
`pnpm verify plan` shows the same Quick and Full preview. Add `--json` to either command for its
typed protocol-equivalent result, or to other supported commands for stable machine-readable output.
`pnpm verify config migrate` previews only. To accept that exact preview, use its printed source
and target digests:

```powershell
pnpm verify config migrate "C:\path\to\repository" --apply --expected-digest SOURCE_SHA256 --expected-target-digest TARGET_SHA256
```

A changed source or target revision is rejected rather than overwritten.

## Local data

Repository policy stays in `.verify/project.yml`. Run history defaults to
`%USERPROFILE%\.verify\history.sqlite3`; developers and automation can override it with
`VERIFY_DATABASE_PATH`. Stored command output may contain sensitive repository information and is
not encrypted by v0.1.0.

Project profiles and plan previews are not persisted. Running only **Understand Project** or
`verify plan` does not initialize or write the history database, repository files, or
`.verify/project.yml`.
Reviewing a configuration migration also writes nothing. Explicit apply replaces only the YAML
policy; it does not initialize the history database or approve commands.

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
