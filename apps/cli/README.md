# `verify` CLI

## Purpose

Provides the first-class command-line interface, the concrete application composition root, stable
machine output, and the local protocol-v1 stdio server used by the desktop.

## Public commands

```bash
pnpm verify init [repository] [--force] [--json]
pnpm verify discover [repository] [--json]
pnpm verify understand [repository] [--json]
pnpm verify plan [repository] [--json]
pnpm verify config migrate [repository] [--json]
pnpm verify config migrate [repository] --apply --expected-digest <source-digest> --expected-target-digest <target-digest> [--json]
pnpm verify config approval status [repository] [--json]
pnpm verify config approval approve [repository] --expected-digest <policy-digest> [--json]
pnpm verify config approval revoke [repository] [--json]
pnpm verify inspect [repository] [--json]
pnpm verify run [repository] [--json]
pnpm verify quick [repository] [--json]
pnpm verify full [repository] [--json]
pnpm verify gate [repository] [--json]
pnpm verify history [repository] [--limit 20] [--json]
pnpm verify protocol
```

Repository commands default to the current directory. `protocol` accepts NDJSON on stdin and does
not accept a repository argument. Exit codes are `0` for PASS/WARN, `1` for BLOCK, `2` for an
execution/configuration error, and `3` for interruption. Help and version output exit successfully.

`understand` builds a bounded deterministic `ProjectProfile` from repository metadata. Human output
shows capabilities, workspace units, observed task candidates, confidence, ambiguity, and evidence
references. JSON output is the protocol-equivalent `{ status, profile? }` result. Profiling never
executes observed commands, writes repository configuration, or creates verification history;
Ctrl+C returns exit code 3.

`plan` profiles the repository through the same read-only core use case and returns deterministic
Quick and Full verification-plan previews for the supported single-root Node/Vite/Vitest slice.
Human output shows selected and skipped observed checks, reasons, and source evidence. JSON output
is the protocol-equivalent `{ status, preview? }` result. The command copies observed task
candidates but never executes them, writes policy, or creates verification history; Ctrl+C returns
exit code 3.

`config migrate` defaults to a read-only schema-v1 to schema-v2 preview. Human output includes the
current and target versions, explanation, exact YAML diff, complete proposed YAML, and the two
digests needed for explicit apply. The `--apply` form requires both digests from a reviewed preview
and rejects changed source or target policy instead of silently accepting a fresh proposal.
Migration preserves named suites but does not approve commands or execute them; `verify run`
continues using the named suites after migration. JSON apply reports a stale reviewed source or
target with the structured `MIGRATION_STALE` error code.

`config approval status` reads the current semantic executable-policy digest and local receipt
state. `approve` requires that reviewed digest, fails with `APPROVAL_STALE` if policy changed, and
stores a local receipt only after explicit invocation. `revoke` explicitly marks the current local
approval revoked. YAML formatting and comments do not change the semantic digest, but executable
policy edits make an old approval outdated. These commands do not execute a plan or check.
Missing, invalid, or version-1 policies reject approval with `APPROVAL_UNAVAILABLE`; a local
receipt can still be revoked while the policy is unavailable.

`quick` and `full` execute only their named suites from a freshly read schema-v2 policy after core
revalidates the matching local approval receipt. Missing, stale, revoked, version-1, or invalid
policy fails before any project command starts. These commands reuse the existing verification
runner, cancellation, persisted history, PASS/WARN/BLOCK gate, and CLI exit-code meanings; `run`
retains its legacy configured-suite behavior. `--json` emits one `VerificationRun` without progress
noise.

## Allowed dependencies

Core and every concrete local adapter needed by the composition root, protocol/config/domain types,
Commander, and Node process/stdio facilities. The source CLI keeps its ESM entry; Windows delivery
uses a separate fully bundled CommonJS Node SEA entry.

## Forbidden dependencies

React rendering, Tauri UI behavior, duplicate repository/config/policy logic, network listeners,
cloud services, AI, and commands not present in validated repository configuration.

## Data owned

Argument parsing, human formatting, stable JSON selection, CLI exit mapping, protocol request
dispatch, stdio ownership, and concrete dependency composition. Domain data and persisted history
remain owned by their packages.

## Important invariants

- JSON mode emits exactly one machine-readable document on stdout without progress noise.
- Protocol mode reserves stdout for validated NDJSON frames and sends diagnostics to stderr.
- Protocol mode keeps reading while ordinary requests execute, serializes those requests, and lets
  `verification.cancel` interrupt an active or queued legacy or approved verification run and `operation.cancel`
  interrupt a registered profiling or plan-preview operation.
- The CLI and protocol call the same `VerifierApplication` instance and do not recalculate gates.
- `init` never replaces an existing file without `--force`.
- Operational errors and interruptions never become successful gates.
- SEA argument handling accounts for Node exposing the executable in both `process.argv[0]` and
  `process.argv[1]`; the outside-checkout protocol smoke guards this runtime-specific contract.

## Security and privacy

The composition executes explicitly configured local commands with the current user's permissions
and stores sensitive local evidence. There is no sandbox, redaction, encryption, authentication,
telemetry, or network endpoint. Review untrusted repository configuration before running it.

The Windows SEA embeds the matching `better-sqlite3` addon. Startup verifies and atomically extracts
that addon to a content-addressed per-user cache; it does not resolve packages from the checkout.

## Versioned contracts

The CLI keeps schema-v1 read/run behavior and adds explicit schema-v2 policy inspection/migration
and local approval through additive methods. Protocol version 1 and application version 0.1.0
remain unchanged. Exit meanings and existing JSON fields must not change silently.

## Testing

    pnpm --filter @verify/cli test
    pnpm --filter @verify/cli typecheck
    pnpm build:engine:windows
    pnpm smoke:engine:windows

Integration tests use real temporary Git repositories and command processes for init/inspect/run,
PASS/WARN/BLOCK, invalid configuration, missing executables, active-command interruption, profiling
and planning without repository/database writes or command execution, persistence, and repair
history. They also spawn the bundled CLI in both human and JSON modes and exercise its NDJSON
protocol as a real child process, including correlated verification, profiling, and plan-preview
cancellation and core/CLI/protocol plan equivalence.
The Windows smoke copies the engine outside the checkout, removes Node.js from its child `PATH`, and
exercises real-repository PASS/WARN/BLOCK, history persistence, and protocol-mode argument handling.
Set `VERIFY_ENGINE_PATH` to an installed/extracted sidecar path to run the same smoke against that
exact executable without copying the source-built engine.
