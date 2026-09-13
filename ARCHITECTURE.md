# Architecture

## Scope

The v0.1.0 target is a local, deterministic code-verification application. It opens a Git repository, proposes and reads project configuration, inspects changes, runs configured checks, normalizes evidence, evaluates a PASS/WARN/BLOCK gate, persists run history, and exposes the same behavior through a CLI and a minimal Tauri desktop client.

AI, intelligent risk analysis, dependency graphs, native test-framework adapters, MCP, CI-provider integrations, and enterprise services are deliberately outside this milestone.

## Post-v0.1.0 direction

The accepted post-v0.1.0 roadmap preserves this deterministic foundation while changing the product
hierarchy and user experience. The intended flow is:

    Open repository
           |
           v
    Deterministic project sensors ----> structured project profile
           |                                      |
           |                                      +----> local AI explanation/advice
           |                                                    |
           v                                                    v
    explainable plan <--------------------------- user review/override
           |
           v
    approved deterministic operations ----> evidence ----> PASS/WARN/BLOCK

Local AI is advisory. It may explain ambiguity and propose actions or policy, but it cannot execute
commands, persist configuration directly, or determine the Quality Gate. Project sensors are
read-only and distinct from execution adapters. The desktop will present simple actions above the
existing technical evidence panels, while all behavior continues to flow through the headless core.

Future interfaces keep deterministic facts, AI inference, and approved executable policy visibly
and structurally separate. Selecting a repository starts only bounded deterministic profiling. AI is
not introduced until that profile and the deterministic planner are independently usable, and an
unavailable local model never blocks those deterministic paths or triggers a remote fallback.

The delivery order remains deliberate:

1. Iteration 5 establishes read-only project intelligence and `Understand Project`.
2. Iteration 6 turns deterministic facts into reviewable quick/full plans; it contains no AI.
3. Iteration 7 adds advisory Ollama project understanding over the stable profile and plan.
4. Iteration 8 adds the complete simple-action area and contained task execution.
5. Iteration 9 adds AI-assisted configuration proposals and evidence explanation.

This order prevents provider behavior from defining project facts, prevents planning from becoming
an AI-only feature, and avoids rebuilding task UX around unstable discovery contracts.

The canonical product reset and delivery sequence are documented in
**docs/planning/REVISED-PRODUCT-PATH-POST-V0.1.0.md** and
**docs/tasks/IMPLEMENTATION-PLAN-POST-V0.1.0.md**. ADR-009 through ADR-014 govern the new authority,
sensor, configuration, cancellation, provider, and launch boundaries. These are roadmap decisions.
The package table and primary flows below describe the v0.1.0 system plus the implemented Iteration
5 slices 5A and 5B; later roadmap behavior remains prospective.

Iteration 5 adds portable profile types to **@verify/domain**, a `ProjectProfilerPort` to
**@verify/core**, and one documented project-intelligence implementation containing the bounded
inventory, sensor contract, coordinator, and initial metadata sensors. Sensors are isolated modules;
a separate adapter package is introduced only when an ecosystem requires its own dependency or
release boundary. Configuration keeps its version-1 discovery API as a compatibility path until a
later migration removes that ownership explicitly.

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
                                                         +---- project intelligence
                                                         +---- command adapter
                                                         +---- SQLite storage

There is one implementation of repository inspection, configuration, verification orchestration, normalization, gate evaluation, and run persistence. Interfaces may format or transport results, but they do not recalculate them.

## Package ownership

| Package                             | Owns                                                                                              | Must not own                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **@verify/domain**                  | Infrastructure-independent entities, result types, findings, artifacts, gate types                | Git commands, YAML, SQLite, subprocesses, React, Tauri         |
| **@verify/core**                    | Initialize, discover, inspect, run, gate, and history use cases; application ports                | Concrete drivers or interface rendering                        |
| **@verify/config**                  | **.verify/project.yml**, schema v1, validation, safe writes, and project-marker/script discovery  | Command execution or gate decisions                            |
| **@verify/project-intelligence**    | Bounded read-only inventory, sensor coordination, and Node/Vite/Vitest/Jest/static-site detection | Project command execution, policy mutation, persistence, or AI |
| **@verify/repository**              | Git root discovery, branch/status/diff parsing, and changed-file normalization                    | Project-marker discovery, verification scheduling, or UI state |
| **@verify/verification**            | Run lifecycle, check scheduling, timeout/cancellation contracts, normalized events                | Shell-specific execution details or policy                     |
| **@verify/adapter-generic-command** | Local execution of explicitly configured commands                                                 | Config invention, gate decisions, remote shells                |
| **@verify/policy**                  | Deterministic PASS/WARN/BLOCK evaluation from normalized results                                  | Process or tool implementation details                         |
| **@verify/storage**                 | RunRepository implementation, SQLite/Drizzle schema and ordered migrations                        | Source-controlled project policy                               |
| **@verify/protocol**                | Version 1 request, event, result, and error envelopes                                             | Business logic or arbitrary console parsing                    |
| **@verify/ui**                      | Reusable accessible presentation primitives                                                       | Repository or verification behavior                            |
| **apps/cli**                        | CLI parsing, composition, human and stable JSON output, protocol server                           | Duplicate use cases                                            |
| **apps/desktop**                    | Tauri process bridge and React dashboard                                                          | Gate calculation, Git parsing, command execution, persistence  |

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

### Understand project (Iteration 5 slices 5A and 5B)

1. A caller selects a Git repository; core resolves its canonical repository root.
2. The project-intelligence coordinator creates a bounded, deterministic file inventory and invokes
   the isolated Node sensor with a shared cancellation signal.
3. The sensor reads only eligible project metadata and returns portable capabilities, task
   candidates, evidence, confidence, ambiguities, and warnings. It cannot execute commands.
4. The coordinator returns one versioned `ProjectProfile`, or a distinct cancelled result. Reaching
   a scan budget produces a completed profile marked `partial`, not a cancellation.
5. CLI, protocol, native bridge, and desktop expose that same result. Profile-only composition does
   not construct SQLite storage, persist a record, or write repository/configuration state.

The implemented scope supports single-root Node projects using Vite, Vitest, or Jest, plus a plain
static site when a complete inventory finds a root `index.html` and no Vite evidence. A
plain static site receives only a detection capability; profiling does not create or run a preview
command or server. When Vite evidence and `index.html` coexist, the entry document strengthens the
Vite finding and does not misclassify the project as a plain static site. These additions reuse the
same profile and interface contracts. They do not create verification plans, approve or execute
discovered scripts, migrate configuration, write repository/configuration/database state, or invoke
AI. Existing configuration discovery remains a separate schema-v1 compatibility path.

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
graceful verification cancellation, latest gate, and run history. Iteration 5 additively introduces
`project.profile`, typed `profile.progress` events, and `operation.cancel`; existing protocol-v1
methods and `verification.cancel` retain their meaning. A cancellation control frame has its own
request ID and targets the correlated active request. Accepted profile cancellation terminates with
the profile-specific cancelled result and creates no verification run. Accepted verification
cancellation must still end in the original run's persisted `cancelled` terminal result. The native
bridge applies method-appropriate cancellation validation, bounded shutdown, and Windows Job Object
containment if cooperative cancellation or normal engine exit fails.

## Extension model

Future capabilities extend existing contracts instead of rewriting the stable core:

- a new tool implements VerificationAdapter in its own adapter package;
- a new read-only ecosystem sensor contributes evidence to the shared project-intelligence
  coordinator without gaining an execution capability;
- a future interface calls core use cases or the versioned protocol;
- richer evidence uses generic Finding and Artifact records;
- AI providers, risk, code intelligence, reporting, sandbox, hardware, models, and MCP remain separate future packages.

No future feature may make deterministic verification depend on AI availability.

## Test architecture

- Unit tests cover parsing, validation, transformations, bounded Node/Vite/Vitest/Jest/static-site
  profiling, Vite-versus-static precedence, discovery, Git parsing, policy, and exit-code mapping.
- Adapter contract tests cover success, failure, missing executable, timeout, cancellation, output streams, working directory, and exit-code normalization.
- Real fixture repositories cover pass, failing test, failing build, and Git-change workflows.
- CLI integration tests exercise init, inspect, run, and gate.
- Protocol tests validate framing, schema versions, event order, correlation, and structured errors.
- Desktop tests prove accessibility basics and that rendered status comes from typed protocol results.
- A protocol/core equivalence test proves the streamed terminal result is the same normalized run that the shared application persists. Native GUI/sidecar smoke validation remains a platform-specific check.

See **docs/ADR/** for accepted decisions and **docs/tasks/** for delivery slices.
