# TASK-014: Project Intelligence Foundation

## Status

In progress. ADR-009 through ADR-014 are accepted. Slice 5A is implemented and validated across
core, protocol, CLI, native bridge, and desktop; slice 5B adds validated Jest and plain-static-site
profiles through those unchanged interfaces, including Vite precedence for root `index.html`.
TASK-014 remains open for the ordered 5C ecosystem, ambiguity, and regression coverage below.

## Goal

Create a deterministic, read-only, evidence-backed project profile that is shared by the core, CLI,
protocol, and desktop. Reframe discovery as internal project intelligence and expose the first
simple `Understand Project` action without executing discovered commands or invoking AI.

## First vertical slice

Open a single-root Node/Vite/Vitest repository, run bounded deterministic discovery, produce a
structured project profile, show that same profile in desktop/CLI/protocol, execute no discovered or
project-defined command, and write nothing.

Node/Vite/Vitest remains the first slice because its explicit manifest, scripts, lockfile, and
configuration evidence exercises the portable contracts without requiring recursive monorepo
selection, Python packaging interpretation, AI, or command execution.

## Project profile contract

`ProjectProfile` is a versioned, portable domain record with these required sections:

| Section         | Required content                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity        | `profileVersion: 1`, canonical repository root, inferred display name, and generated timestamp                                               |
| Completeness    | `complete` or `partial`, plus scan counts, bytes read, skipped-directory count, elapsed time, and every reached limit                        |
| Capabilities    | Languages, frameworks, package managers, workspace systems, test frameworks, build tools, linters, typecheckers, runtimes, and preview types |
| Workspace units | Stable ID, repository-relative path, optional display name, and supporting evidence IDs                                                      |
| Task candidates | Stable ID, kind, label, observed command, repository-relative working directory, optional workspace ID, confidence, and evidence IDs         |
| Evidence        | Stable ID, sensor ID, evidence kind, repository-relative path, optional structured pointer, and a redacted human summary                     |
| Ambiguities     | Stable code, message, candidate IDs, and evidence IDs for mutually credible interpretations                                                  |
| Warnings        | Stable code, message, optional sensor ID/path, and whether profile completeness is affected                                                  |

Capability kinds are portable categories rather than framework-specific result objects. Task kinds
for this iteration are `test`, `build`, `lint`, `typecheck`, `run`, and `preview`. An observed command
in a task candidate is evidence only: it is neither approved nor executable and must not be mapped
to a `VerificationSuite` or `LaunchTarget` in Iteration 5.

All profile arrays use stable deterministic ordering. Repository paths use normalized forward-slash
relative form; the canonical root appears only once at profile level. Raw manifest contents,
environment values, and possible secrets are not copied into evidence summaries.

## Evidence and confidence model

Evidence kinds are `manifest`, `config`, `lockfile`, `script`, `path`, and `convention`.

Confidence is categorical and explainable:

- `confirmed`: an explicit machine-readable declaration or dedicated tool configuration names the
  capability or command.
- `strong`: at least two independent compatible signals identify it, such as a declared dependency
  plus conventional test paths.
- `tentative`: a naming or layout convention is the only supporting signal.

Every capability and candidate references at least one evidence item. Confidence cannot exceed what
its evidence supports. Compatible observations merge deterministically; contradictory credible
observations create an ambiguity instead of selecting a winner. Missing or malformed metadata
creates a warning and never causes an invented fallback command.

The UI labels these values as deterministic facts and candidates. The words AI, approved, trusted,
or configured must not be applied to profile observations.

## Sensor contract

`ProjectSensor` has a stable sensor ID and one asynchronous scan operation. The coordinator supplies:

- the canonical repository root;
- one shared, read-only bounded inventory of normalized relative paths and basic file metadata;
- a budget-enforcing text reader for permitted metadata files;
- an `AbortSignal`;
- a structured progress callback.

A sensor returns observations and warnings only. It cannot receive a command runner, configuration
writer, database, network client, or unrestricted filesystem handle. It must not spawn processes,
follow links outside the root, write files, mutate configuration, or persist results. Sensor output
is schema-validated at the coordinator boundary before it can enter a profile.

The coordinator owns inventory construction, budgets, cancellation checks, merge/deduplication,
confidence enforcement, and deterministic sorting. A failed sensor adds a scoped warning while
independent sensors continue; a cancelled operation stops all further work. The configuration
package alone owns the legacy `ProjectDiscovery` compatibility projection.

Implementation ownership is fixed for this task:

- `@verify/domain` owns the portable profile records and contains no Node or framework dependency.
- `@verify/core` owns `ProjectProfilerPort` and `profileProject` orchestration.
- new `@verify/project-intelligence` owns the bounded inventory, sensor contract, coordinator,
  metadata reader, and initial sensor modules; it depends inward on domain only.
- `@verify/config` may depend on project intelligence and owns the mapping from `ProjectProfile` to
  its existing `ProjectDiscovery` compatibility result so public version-1 discovery/init behavior
  stays unchanged; project intelligence does not depend on config.
- CLI and desktop composition roots construct and inject the profiler. React and Rust contain no
  detection or merge rules.

The new package must include the standard package documentation before TASK-014 is complete. Sensor
modules stay inside it until a concrete ecosystem needs an independent dependency or release
boundary; this task does not create one package per marker.

## Bounded scan and cancellation

The initial scan uses these centrally declared defaults:

- at most 50,000 inventory entries;
- at most 1 MiB for any metadata file read;
- at most 16 MiB of metadata content in aggregate;
- at most 10 seconds elapsed time.

It never descends into `.git`, `node_modules`, `target`, `dist`, `build`, `coverage`, `.turbo`,
`.next`, `.venv`, `venv`, or `__pycache__`; it also honors repository ignore information where the
existing Git boundary can supply it safely. Directory links are not followed. Reaching a budget
returns a completed but `partial` profile with the reached limit and warning. Cancellation returns a
typed `cancelled` terminal result with no partial profile; the desktop retains the last completed
profile, if any, and marks only the refresh as cancelled.

Iteration 5 adds `operation.cancel` and uses the existing correlated acknowledgement rules. The
first accepted cancel wins; unknown, repeated, and post-terminal requests return `accepted: false`.
The original `project.profile` request emits its own cancelled terminal result. Existing
`verification.cancel` behavior remains unchanged.

## Supported ecosystems and delivery slices

Iteration 5 is completed in three ordered internal slices without changing later roadmap boundaries:

1. **5A — first vertical slice:** single-root Node/JavaScript/TypeScript, npm/pnpm/Yarn lockfile and
   declaration evidence, Vite, Vitest, and declared root scripts.
2. **5B — additional deterministic profiles:** Jest and plain static sites. A root `index.html`
   without conflicting framework evidence is a confirmed static preview capability; a Vite
   `index.html` remains Vite evidence rather than a plain-site classification.
3. **5C — breadth and ambiguity:** Python packaging markers, pytest, and declared npm/pnpm/Yarn
   workspaces. Multiple credible workspace/test/run targets remain explicit ambiguities; no default
   target is invented.

Next.js and Python application launch selection may be detected as tentative candidates only when
direct evidence exists; executable launch behavior remains Iteration 8 work.

## Interface exposure

- **Core:** add `profileProject({ repository, signal, onProgress })`; it resolves the Git root and
  delegates to a `ProjectProfilerPort`. It performs no configuration, execution, policy, or storage
  operation.
- **Protocol:** add `project.profile` with `{ repository }`, typed progress events, and a terminal
  union of `{ status: "completed", profile }` or `{ status: "cancelled" }`. Add
  `operation.cancel { targetRequestId }`. Do not alter `project.discover` or any existing frame.
- **CLI:** add `verify understand [repository] [--json]`. Human output summarizes the profile; JSON
  emits the protocol-equivalent result. Ctrl+C uses the same cancellation boundary and exit code 3.
- **Desktop:** request `project.profile` automatically after repository selection without blocking
  existing configuration, Git, gate, or history loading. Add `Understand Project` to refresh it,
  show progress/Stop while active, and render evidence, confidence, ambiguities, warnings, and
  partial coverage. A profile failure does not make the existing v0.1.0 dashboard unusable.
- **Native bridge:** register `project.profile` as cancellable, send `operation.cancel` for it while
  preserving `verification.cancel` for `verification.run`, and validate the target method's terminal
  shape without assuming every cancelled operation is a persisted `VerificationRun`. Rust remains a
  transport/process-lifecycle layer.
- **Compatibility:** keep current `project.discover`, `config.get`, `config.init`,
  `repository.inspect`, `verification.run/cancel`, `gate.latest`, and `runs.list` schemas and
  behavior unchanged.

The new profile does not invent npm when `package.json` has neither a package-manager declaration nor
a lockfile. The isolated `ProjectDiscovery` compatibility projection preserves v0.1.0's existing npm
default and configuration suggestions so legacy `discover`/`init` behavior does not change; that
legacy default cannot feed the new profile or future smart-plan approval.

## In scope

- The exact profile, evidence/confidence, sensor, budget, and cancellation contracts above.
- Detection for:
  - Node, TypeScript/JavaScript, Python, Vite, and static websites;
  - npm, pnpm, and Yarn;
  - declared scripts and workspace/monorepo structure;
  - Vitest, Jest, pytest, build, lint, and typecheck signals;
  - existing tests/configuration and evidence-backed launch candidates.
- Compatibility projection for the current `project.discover` result.
- The core, additive protocol, CLI, and desktop exposure defined above.
- Bounded automatic deterministic profiling when a repository opens.
- An `Understand Project` desktop action and evidence-first profile view.
- Progress and cancellation behavior appropriate to a potentially large repository scan.
- Fixture, contract, core, CLI, protocol, desktop, and regression tests.
- Package documentation, user documentation, and development-log checkpoints.

## Non-goals

- No AI provider, prompt, model download, AI summary, or AI-derived recommendation.
- No configuration schema v2 or automatic policy write.
- No verification-plan selection, approval receipt, or smart verification execution.
- No project launch or dependency installation.
- No native framework execution/normalization adapter.
- No deterministic risk engine, code-intelligence graph, MCP, or generated tests.
- No change to PASS/WARN/BLOCK, existing CLI exit codes, or current verification-run semantics.

## Architectural constraints

- Sensors report evidence and cannot execute commands.
- Portable domain records cannot contain framework-specific result types.
- The core orchestrates profiling through ports; React and Tauri remain projections/transports.
- Existing `project.discover` and `.verify/project.yml` version 1 behavior remain compatible.
- New protocol behavior is additive and must not reinterpret existing protocol-version-1 frames.
- Cancellation follows correlated, cooperative semantics and must not weaken process cleanup.
- A detection failure produces an explicit warning, never an invented capability or silent success.

## Fixture strategy

Fixtures are minimal repositories committed without dependency installations or generated output.
Each asserts the complete normalized profile or an intentionally scoped subset when timestamps and
canonical roots vary:

- Node/Vite/Vitest with package-manager declaration, one lockfile, scripts, config, source, and test;
- Jest using explicit configuration and dependency evidence;
- plain static root `index.html`, plus Vite-with-`index.html` misclassification regression;
- Python/pytest using `pyproject.toml`, `pytest.ini`, and representative test paths;
- mixed Node/Python evidence;
- malformed manifest/config with warnings and no invented tasks;
- npm, pnpm, and Yarn workspace fixtures with one unambiguous and one ambiguous target set;
- ignored/generated directories, directory links, deterministic ordering, each scan budget, sensor
  failure isolation, and cancellation before/during traversal.

The first implementation checkpoint starts with the Node/Vite/Vitest fixture and contract tests, but
the first vertical slice is complete only when that same result reaches core, CLI, protocol, and
desktop. TASK-014 is complete only after all listed ecosystem and regression fixtures pass.

## Acceptance criteria

- Static-site, Node/Vite/Vitest, Jest, Python/pytest, mixed, malformed, and monorepo fixtures return
  stable evidence-backed profiles.
- The same profile contract is observed through core, CLI JSON, protocol, and desktop.
- Opening a repository performs the bounded fast scan automatically.
- `Understand Project` refreshes the profile and exposes evidence, confidence, ambiguity, and
  warnings.
- Cancelling a scan reaches a clean terminal state without a write or child-process leak.
- No repository file, configuration, or database policy is changed by profiling.
- Existing deterministic discovery, verification, cancellation, persistence, native packaging, and
  CLI/desktop equivalence tests remain green.
- `project.discover` returns its existing result unchanged for all current fixtures.
- Profiling runs with no repository writes, no database writes, no project commands, and no network
  access.
- Budget-limited scans are visibly partial; cancelled scans never replace a completed profile.
- Protocol cancellation covers accepted, unknown, repeated, queued/starting, and post-terminal
  targets, correlation, and exactly one terminal result.

## Required validation

    pnpm format:check
    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm build

Also run focused package/protocol/CLI/desktop tests, locked Rust checks when the native bridge
changes, Tauri development execution, production packaging, and the outside-checkout installed-app
smoke before declaring the iteration complete.

## Next safe step

After making slice 5B durable when authorized, implement only slice 5C: add fixture-driven Python
packaging and pytest evidence, declared npm/pnpm/Yarn workspace structure, mixed-project coverage,
and explicit ambiguity for multiple credible workspace/test/run targets. Reuse the existing
profile and interface contracts; do not choose a default target or add execution, schema-v2,
Iteration 6 planning, or Iteration 7 AI behavior.
