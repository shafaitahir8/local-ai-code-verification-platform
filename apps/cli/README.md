# `verify` CLI

## Purpose

Provides the first-class command-line interface, the concrete application composition root, stable
machine output, and the local protocol-v1 stdio server used by the desktop.

## Public commands

```bash
pnpm verify init [repository] [--force] [--json]
pnpm verify discover [repository] [--json]
pnpm verify inspect [repository] [--json]
pnpm verify run [repository] [--json]
pnpm verify gate [repository] [--json]
pnpm verify history [repository] [--limit 20] [--json]
pnpm verify protocol
```

Repository commands default to the current directory. `protocol` accepts NDJSON on stdin and does
not accept a repository argument. Exit codes are `0` for PASS/WARN, `1` for BLOCK, `2` for an
execution/configuration error, and `3` for interruption. Help and version output exit successfully.

## Allowed dependencies

Core and every concrete local adapter needed by the composition root, protocol/config/domain types,
Commander, and Node process/stdio facilities. Third-party runtime packages declared here remain
external to the bundled entry point.

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
- The CLI and protocol call the same `VerifierApplication` instance and do not recalculate gates.
- `init` never replaces an existing file without `--force`.
- Operational errors and interruptions never become successful gates.

## Security and privacy

The composition executes explicitly configured local commands with the current user's permissions
and stores sensitive local evidence. There is no sandbox, redaction, encryption, authentication,
telemetry, or network endpoint. Review untrusted repository configuration before running it.

## Versioned contracts

The CLI targets configuration schema 1, protocol version 1, storage migration 1, and application
version 0.1.0. Exit meanings and JSON fields must not change silently.

## Testing

    pnpm --filter @verify/cli test
    pnpm --filter @verify/cli typecheck

Integration tests use real temporary Git repositories and command processes for init/inspect/run,
PASS/WARN/BLOCK, invalid configuration, missing executables, active-command interruption,
persistence, and repair history. They also spawn the bundled CLI in both human and JSON modes and
exercise its NDJSON protocol as a real child process.
