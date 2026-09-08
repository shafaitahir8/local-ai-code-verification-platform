# Security Model

## Security posture

The MVP is local-first verification software that reads source repositories and executes user-configured commands with the current operating-system user's permissions. Its central promise is privacy and explicit local control, not process isolation.

Security-sensitive failures must be visible. When evidence is incomplete, the product reports an error, cancellation, or unknown state rather than PASS.

## Assets

Protected assets include:

- repository source, diffs, paths, and metadata;
- environment variables and credentials visible to child processes;
- configured command lines and their stdout/stderr;
- verification history and findings in SQLite;
- project configuration and local protocol messages.

## Trust boundaries

### Repository and project configuration

A repository can contain malicious files and a malicious **.verify/project.yml**. Reading metadata is not permission to execute a command. A command runs only after the user invokes verification or explicitly approves it through the desktop flow. The application displays the exact configured command and working directory.

Configuration initialization refuses symbolic `.verify` directories and symbolic configuration
files so an explicit force write cannot follow a repository-controlled link outside the repository.

### Child processes

Configured commands are fully capable local processes. In v0.1.0 they run with the user's account permissions and may read files, access inherited environment values, or use the network. Timeout and cancellation limit duration but are not a sandbox.

The engine must:

- execute only commands present in validated project configuration;
- avoid constructing commands from AI or remote input;
- set the intended repository working directory explicitly;
- inherit only the documented environment and apply explicit overrides;
- distinguish missing executables, non-zero exits, timeout, and cancellation;
- avoid presenting execution failure as a successful check.

### Desktop/core IPC

The MVP uses a local child process and versioned NDJSON over stdin/stdout. It does not require a listening network port. Requests and events are schema-validated, correlated by request ID, and rejected on unsupported protocol versions. Protocol stdout contains frames only; diagnostics use stderr. Native requests are serialized and event frames use request-scoped IPC channels.

The Tauri layer exposes a narrow allowlist of operations needed by the dashboard. It must not expose an arbitrary shell command.

### Persistence

SQLite is local application state, not an access-control boundary. Database files and captured output are protected only by operating-system filesystem permissions in the MVP. Do not place credentials in migrations, fixtures, committed databases, or logs.

Retained command output is bounded and explicitly marked when truncated. Live output can still reveal
everything printed by a configured command, so users must continue to treat the dashboard and
terminal as sensitive surfaces.

## Privacy and network behavior

- Source code is not sent to external services.
- No cloud AI is included in the deterministic MVP.
- No source-bearing telemetry is collected; the MVP adds no telemetry service.
- The application does not create accounts, authenticate to cloud services, or listen on a network port.
- Configured verification tools may independently use the network. Their behavior remains the user's responsibility and should be reviewed before execution.

Any future network, telemetry, cloud, AI, or update feature requires an ADR, a visible consent model, data-flow documentation, and security tests.

## Logging and secret handling

- Treat stdout, stderr, paths, diffs, findings, and environment values as potentially sensitive.
- Do not dump the full process environment or repository contents into diagnostics.
- Errors should identify the failing boundary without reproducing unrelated secret-bearing data.
- Machine-readable output must remain separated from diagnostic logs.
- Tests must use synthetic credentials and repositories only.

Automatic redaction cannot reliably identify every secret. Users should not configure commands that print secrets, and integrations should minimize captured sensitive output.

## Filesystem behavior

- Resolve and validate the selected repository and working directory before access.
- Never overwrite **.verify/project.yml** without explicit force behavior.
- Keep database writes and migrations scoped to the configured local data path.
- Avoid following user-controlled paths for destructive operations.
- The MVP does not mutate production source or generate tests.

## Dependencies and supply chain

Dependencies must have a concrete purpose, compatible license, active maintenance, and acceptable platform cost. Lockfiles are committed. New native dependencies require Windows, macOS, and Linux implications to be documented. Vulnerability reports are investigated rather than hidden through blanket ignores.

## Out of scope and known limitations

The MVP does not provide:

- a subprocess sandbox or OS-level containment;
- encrypted run history;
- secret detection/redaction guarantees;
- signed plugins or third-party adapters;
- protection from a malicious command the user explicitly runs;
- multi-user authorization or enterprise policy enforcement;
- safe AI-generated command or code execution.

These limitations must remain visible in user-facing command review and documentation.

## Reporting a vulnerability

Do not include real source code, credentials, or sensitive command output in a public report. Provide a minimal synthetic reproduction, affected version, platform, and impact through the repository owner's private security-reporting channel when one is configured. Until then, contact the maintainer privately before public disclosure.
