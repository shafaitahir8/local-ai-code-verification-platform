# Architecture

## Scope

The v0.1.0 target is a local, deterministic code-verification application. It opens a Git repository, proposes and reads project configuration, inspects changes, runs configured checks, normalizes evidence, evaluates a PASS/WARN/BLOCK gate, persists run history, and exposes the same behavior through a CLI and a minimal Tauri desktop client.

AI, intelligent risk analysis, dependency graphs, native test-framework adapters, MCP, CI-provider integrations, and enterprise services are deliberately outside this milestone.

## Architectural style

The codebase uses ports-and-adapters architecture. Business rules point inward; infrastructure implements contracts at the edge.

    Desktop UI ---- protocol client ----+
                                      |
    CLI -------------------------------+---- core use cases ---- domain
                                      |          |
                                      |          +---- ports
                                      |                  |
                                      +---- composition --+---- Git adapter
                                                         +---- YAML config
                                                         +---- command adapter
                                                         +---- SQLite storage

There is one implementation of repository inspection, configuration, verification orchestration, normalization, gate evaluation, and run persistence. Interfaces may format or transport results, but they do not recalculate them.

## Package ownership

| Package                             | Owns                                                                                             | Must not own                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **@verify/domain**                  | Infrastructure-independent entities, result types, findings, artifacts, gate types               | Git commands, YAML, SQLite, subprocesses, React, Tauri         |
| **@verify/core**                    | Initialize, discover, inspect, run, gate, and history use cases; application ports               | Concrete drivers or interface rendering                        |
| **@verify/config**                  | **.verify/project.yml**, schema v1, validation, safe writes, and project-marker/script discovery | Command execution or gate decisions                            |
| **@verify/repository**              | Git root discovery, branch/status/diff parsing, and changed-file normalization                   | Project-marker discovery, verification scheduling, or UI state |
| **@verify/verification**            | Run lifecycle, check scheduling, timeout/cancellation contracts, normalized events               | Shell-specific execution details or policy                     |
| **@verify/adapter-generic-command** | Local execution of explicitly configured commands                                                | Config invention, gate decisions, remote shells                |
| **@verify/policy**                  | Deterministic PASS/WARN/BLOCK evaluation from normalized results                                 | Process or tool implementation details                         |
| **@verify/storage**                 | RunRepository implementation, SQLite/Drizzle schema and ordered migrations                       | Source-controlled project policy                               |
| **@verify/protocol**                | Version 1 request, event, result, and error envelopes                                            | Business logic or arbitrary console parsing                    |
| **@verify/ui**                      | Reusable accessible presentation primitives                                                      | Repository or verification behavior                            |
| **apps/cli**                        | CLI parsing, composition, human and stable JSON output, protocol server                          | Duplicate use cases                                            |
| **apps/desktop**                    | Tauri process bridge and React dashboard                                                         | Gate calculation, Git parsing, command execution, persistence  |

Package names may be split further only when a concrete implementation needs a separately testable adapter. Empty roadmap packages are not created.

## Dependency rules

- Domain has no workspace dependencies and remains infrastructure-independent.
- Core imports domain types and narrow ports. It does not instantiate infrastructure.
- Config, repository, verification, policy, storage, and adapters may import domain contracts as needed.
- Concrete adapters may depend on their port-owning package; port-owning packages never depend on concrete adapters.
- CLI and desktop are composition roots. Only composition roots select concrete implementations.
- React communicates with the engine through typed protocol messages. Rust remains a thin Tauri bridge.

Any dependency that reverses these directions requires architecture review and an ADR.

## Primary flows

### Initialize

1. A caller selects a repository.
2. The repository adapter verifies the Git root.
3. Configuration discovery inspects project markers and proposes only commands proven to exist in project metadata.
4. Config validates schema version 1 and writes **.verify/project.yml** only after explicit init/approval.
5. Existing configuration is never overwritten unless an explicit force operation is requested.

### Inspect

1. Core asks RepositoryService for normalized repository state.
2. The Git adapter discovers root and branch and parses staged, unstaged, untracked, and diff-stat evidence.
3. Core returns stable domain data; the interface only renders or serializes it.

### Run verification

1. Core loads and validates project configuration.
2. Verification schedules configured suites through VerificationAdapter.
3. The adapter streams structured output events and returns a normalized check result.
4. Policy evaluates all normalized check results.
5. RunRepository persists the run, check results, timestamps, durations, and final gate.
6. CLI and desktop receive the same normalized outcome.

Checks that cannot start, time out, or are cancelled remain explicit error/cancelled results. They are never converted to success.

### Read latest gate and history

Core queries RunRepository. Policy may reevaluate normalized results when required; interfaces do not infer a gate from logs or colors.

## Configuration

The source-controlled project contract is **.verify/project.yml** with version 1. The initial schema contains a project name and named suites with type, command, and failure policy. YAML remains the source of truth for what may execute. SQLite stores observations and history, not the sole copy of repository policy.

Schema changes require an explicit version, migration behavior, compatibility tests, and documentation. Writers must not reorder or rewrite user content unnecessarily.

## Verification and policy

The generic-command adapter is the only execution adapter in the MVP. It accepts a working directory, explicit environment additions, timeout, and cancellation, streams stdout/stderr, and returns timing and exit evidence. Live output is not clipped, while the copy retained across a run is explicitly truncated to a bounded serialized budget so persistence and protocol terminal frames remain usable.

Policy consumes normalized results:

- a failed block-policy check yields BLOCK;
- one or more failed warn-policy checks with no blocker yields WARN;
- all relevant checks passing yields PASS;
- infrastructure/configuration errors remain errors and must not produce a false PASS.

WARN has shell exit code 0 for v0.1.0. BLOCK has exit code 1; operational errors use 2; interruption uses 3.

## Storage

Run history is local SQLite managed by **@verify/storage**, using Drizzle metadata and explicit ordered SQL migrations. The implementation enables foreign-key enforcement and uses WAL where supported. A RunRepository port shields core use cases from the synchronous driver and physical schema.

Stored command output may contain proprietary data or secrets and must be treated as sensitive. Retention controls and encryption at rest are future considerations, not implied MVP protections.

## Desktop protocol

The desktop bridge serializes ordinary requests, starts the packaged verification-engine sidecar for
each one, and exchanges newline-delimited JSON on stdin/stdout. Release builds resolve only the
Tauri `externalBin`; debug builds may use an explicit local-engine override. Ordered event frames
cross a request-scoped Tauri IPC channel rather than a global event bus. The standalone protocol
server can process multiple requests over one stream. Every envelope is validated and contains:

- protocolVersion, currently 1;
- request id for correlation;
- method and params for requests;
- event and data for streaming events;
- exactly one terminal result or structured error.

Standard output in protocol mode is reserved for protocol frames. Diagnostic logs go to standard error. Unknown versions, methods, malformed input, and duplicate terminal responses are explicit errors. Transport code is separate from use cases.

Initial methods cover project discovery, config read/init, repository inspection, verification run,
graceful verification cancellation, latest gate, and run history. Verification emits check-started,
output, check-completed, and run-completed events. A cancellation control frame has its own request
ID and targets the active run ID; accepted cancellation must end in the original run's persisted
`cancelled` terminal result. The native bridge uses bounded shutdown and Windows Job Object
containment if cooperative cancellation or normal engine exit fails.

## Extension model

Future capabilities extend existing contracts instead of rewriting the stable core:

- a new tool implements VerificationAdapter in its own adapter package;
- a future interface calls core use cases or the versioned protocol;
- richer evidence uses generic Finding and Artifact records;
- AI providers, risk, code intelligence, reporting, sandbox, hardware, models, and MCP remain separate future packages.

No future feature may make deterministic verification depend on AI availability.

## Test architecture

- Unit tests cover parsing, validation, transformations, discovery, Git parsing, policy, and exit-code mapping.
- Adapter contract tests cover success, failure, missing executable, timeout, cancellation, output streams, working directory, and exit-code normalization.
- Real fixture repositories cover pass, failing test, failing build, and Git-change workflows.
- CLI integration tests exercise init, inspect, run, and gate.
- Protocol tests validate framing, schema versions, event order, correlation, and structured errors.
- Desktop tests prove accessibility basics and that rendered status comes from typed protocol results.
- A protocol/core equivalence test proves the streamed terminal result is the same normalized run that the shared application persists. Native GUI/sidecar smoke validation remains a platform-specific check.

See **docs/ADR/** for accepted decisions and **docs/tasks/** for delivery slices.
