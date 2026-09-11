# Post-v0.1.0 Implementation Plan

## Status

Approved roadmap reset. This document records the delivery sequence; it does not begin Iteration 5
implementation.

## Product direction

The product experience after v0.1.0 is:

> Open a repository → understand automatically → recommend a plan → run simple actions → show
> deterministic evidence → allow user override.

The product hierarchy is:

- **Local AI is the reasoning layer.** It explains ambiguity, recommends actions, and proposes
  configuration changes.
- **The deterministic engine is the execution and evidence layer.** It alone executes approved
  operations, persists results, and produces PASS, WARN, or BLOCK.
- **Project and framework adapters are sensors or executors.** Their technical detail is not the
  primary user experience, and one adapter role must not implicitly grant the other.
- **`.verify/project.yml` is portable project policy.** The application normally generates and
  maintains it, while advanced users may inspect or edit it directly.
- **The desktop is a simple control and explanation layer.** Technical panels remain available as
  transparency and evidence beneath the primary actions.

The validated v0.1.0 headless core, CLI/desktop equivalence, generic command adapter, normalized
evidence, quality gate, SQLite history, cancellation semantics, Windows process containment,
protocol framing, self-contained sidecar, and native packaging remain stable foundations.

## Authority and state separation

Future interfaces must label and keep separate three kinds of information:

1. **Deterministic facts** are evidence-backed observations from project sensors, repository
   inspection, configuration, and executed tools.
2. **AI inference** is advisory interpretation with provider/model/workflow provenance and explicit
   uncertainty. It is never silently promoted to fact.
3. **Approved executable policy** is the reviewed configuration and local approval receipt from
   which deterministic operations may be constructed.

A discovered or AI-proposed command is a candidate, not executable policy. AI unavailability never
blocks deterministic profiling, planning, configured verification, history, or gates. The desktop
shows an unavailable/setup state and continues with deterministic behavior; it never falls back to
a remote provider.

Repository open performs only the bounded deterministic profile scan. Deeper analysis or local-model
work begins from an explicit action. This keeps the eventual experience intelligence-first without
starting expensive model work merely because a repository was selected.

## Planned contracts

### Project intelligence

- `ProjectProfile` is a portable domain record for detected languages, frameworks, package
  managers, workspaces, scripts, test infrastructure, build/lint/typecheck tools, launch
  candidates, evidence, confidence, ambiguities, and warnings.
- `ProjectSensor` is a cancellable, read-only detection boundary. It returns portable evidence and
  cannot execute commands.
- Project-profile coordination belongs outside `@verify/config`. Configuration may consume a
  compatibility projection, but it does not own repository intelligence.
- Concrete ecosystem detectors remain isolated adapters. Framework-specific concepts must not
  leak into common domain records.

### Planning and execution

- `VerificationPlan` describes quick or full mode, selected and skipped suites, reasons, proposal
  sources, approval state, and the configuration revision used to build it.
- `LaunchTarget` describes an explicit command, working directory, target package, loopback policy,
  and lifecycle behavior. Discovery or AI may propose it; only accepted policy may authorize it.
- Existing `verification.run` behavior remains available. Smart actions execute only an accepted
  plan and never turn AI output directly into a subprocess.

### Local AI

- `ModelProvider` exposes availability, structured generation, timeout, and cancellation without
  leaking provider-specific APIs into the core.
- `AIProjectAssessment` stores an advisory summary, hypotheses, recommendations, confidence,
  evidence references, provider/model identity, and workflow version.
- Ollama is the first supported provider and is loopback-only. The product remains functional when
  AI is unavailable.

### Long-running operations

- Add a general cancellation method using the established target-request correlation semantics.
- Preserve `verification.cancel` for compatibility.
- Analysis, discovery, and launch requests stream typed phase, progress, log, and terminal events.
- Verification operations continue to produce `VerificationRun` history. Iteration 5 profiling is
  read-only and unpersisted; later AI analyses and launch sessions use separate operation records
  and never create synthetic quality gates.

### Large repositories

- Build one bounded, reusable repository inventory and let sensors consume that read-only view
  instead of independently walking the tree.
- Honor repository ignore information, never follow directory links outside the selected root, and
  exclude dependency, VCS, generated, cache, and build-output directories by default.
- Bound entry count, metadata bytes, individual file reads, and elapsed scan time. Reaching a budget
  returns an explicitly partial profile with scan statistics and warnings, never a falsely complete
  result.
- A user cancellation returns a cancelled operation rather than publishing an incomplete profile.
  The desktop retains any previous completed profile and marks only the refresh as cancelled.

## Configuration version 2

Schema version 2 will preserve project name and named suites and add:

- quick and full plan membership or selection rules;
- approved launch targets;
- discovery exclusions;
- explicit user overrides.

Derived project observations and AI output remain local derived state, not repository policy.
Version 1 continues to load and execute unchanged. Migration requires a preview and explicit
acceptance through the GUI or `verify config migrate`. Writes are atomic and compare an expected
configuration digest so a concurrent manual edit cannot be overwritten.

The application stores a local approval receipt keyed by repository identity and the digest of the
executable policy. Changing a command, working directory, or other execution-relevant field
invalidates approval. Existing CLI `verify run` behavior is preserved; new smart actions require an
accepted plan.

Version-1 compatibility is deliberately asymmetric:

- Existing `config.get`, `config.init`, `verification.run`, CLI commands, results, and exit codes keep
  their v0.1.0 meanings for version-1 projects.
- A version-1 project can continue using the legacy configured-run path without a local approval
  receipt.
- Entering a new smart-action flow requires reviewing its proposed executable policy, explicitly
  migrating to version 2, and recording a receipt.
- Direct YAML edits or repository changes that alter execution-relevant policy invalidate a receipt.
- Applying policy and recording approval are separate durable steps: after the YAML is reread and
  hashed, receipt failure leaves the valid policy present but smart actions safely unapproved.
- Protocol version 1 remains the envelope version. Existing configuration methods keep their
  version-1 result schemas; Iteration 6 adds methods for version-2 policy inspection, migration, and
  application instead of changing an existing strict result shape in place.

## Revised roadmap

The approved sequence remains unchanged after the completeness review. Iteration 5 must establish
facts before Iteration 6 can plan; Iteration 6 must establish a useful deterministic and approvable
plan before Iteration 7 can advise; Iteration 8 can then reuse stable profile, plan, AI, approval, and
cancellation contracts rather than inventing them independently for each button; Iteration 9 builds
natural-language configuration on the already-safe proposal/apply boundary. Moving AI or smart
execution earlier would make probabilistic behavior define foundational contracts and cause avoidable
rework.

The only cross-cutting dependency delivered at the earliest applicable point is general
`operation.cancel`: Iteration 5 needs it for cancellable profiling, and later operations reuse the
same semantics.

### Iteration 5 — Project Intelligence Foundation

**Goal:** produce reliable structured knowledge about the selected repository without executing
commands, writing configuration, or invoking AI.

Deliver:

- portable project-profile and evidence contracts;
- independent, cancellable project sensors;
- detection for Node, TypeScript/JavaScript, Python, Vite, package managers, workspace/monorepo
  structure, declared scripts, test frameworks and locations, build tools, linters, typecheckers,
  static-site entry points, and likely launch candidates;
- a bounded deterministic scan when a repository opens;
- an `Understand Project` action that refreshes and displays the complete profile;
- equivalent profile results through core, CLI, protocol, and desktop.

The profile may expose evidence-backed task and launch **candidates**, but it does not select an
executable verification plan. Automatic quick/full recommendations remain Iteration 6 work. This is
the intentional reconciliation of the product-direction document's optional early recommendations
with the sensor/executor boundary.

First vertical slice:

> Open a Node/Vite/Vitest repository, automatically build a structured profile, display project
> type, tooling, tests, scripts, and supporting evidence in the desktop, and return the same profile
> through CLI/protocol without writing files or running a project command.

Acceptance:

- Stable fixtures cover static sites, Node/Vite, Python/pytest, mixed repositories, malformed
  metadata, and monorepos.
- No capability is asserted without evidence; ambiguous evidence remains explicit.
- A sensor failure becomes a warning rather than a false positive.
- Cancellation stops analysis cleanly.
- All v0.1.0 regression and packaged Windows checks remain green.

### Iteration 6 — Automatic Verification Planning

**Goal:** convert deterministic project intelligence into an explainable default plan.

Deliver:

- quick and full plans derived from the profile, current Git changes, policy, and approved custom
  commands;
- a reason for every selected or skipped check;
- `Verify Changes`, `Full Verification`, and `Review / Customize Plan`;
- schema version 2, explicit version 1 migration, configuration digests, and local approval
  receipts;
- command review before first acceptance and approval invalidation after executable changes.

No AI provider, AI package, or AI-driven selection is introduced in this iteration. Deterministic
planning must be complete and useful before Iteration 7 adds advisory reasoning.

Acceptance:

- A supported repository reaches a useful proposal without hand-written YAML.
- Quick and full plans are distinct and explainable.
- Version 1 repositories retain their current behavior.
- Migration is previewable, atomic, explicit, and covered by existing-data fixtures.
- No unknown or unapproved command can execute through a smart action.

### Iteration 7 — Local AI Project Understanding

**Goal:** add advisory local reasoning over structured evidence.

Deliver:

- a provider boundary and loopback-only Ollama adapter;
- provider availability, model selection, structured-output validation, timeouts, progress, and
  cancellation;
- selected or indexed context rather than unrestricted repository dumps;
- project summaries, ambiguity resolution, likely run/test behavior, verification recommendations,
  and proposed configuration changes;
- a visible distinction between deterministic facts and AI observations.

Acceptance:

- Supported Ollama models produce schema-valid, attributable assessments.
- Missing providers/models, invalid output, timeout, and cancellation fail safely.
- AI proposals cannot execute commands, modify source, write configuration, or change a gate.
- Context is inspectable and excludes ignored, binary, generated, and likely secret material.
- All deterministic workflows remain usable with AI disabled.

### Iteration 8 — User-Initiated Smart Tasks

**Goal:** deliver the primary simple-action experience through the existing core and native bridge.

Iteration 5 already reports test infrastructure found during its bounded profile scan. The dedicated
`Check for Test Cases` action in this iteration is a deeper, user-initiated reanalysis with progress,
cancellation, indexed evidence, and optional AI gap interpretation; it does not duplicate or delay
the basic deterministic test facts.

| User action             | Deterministic responsibility                                            | AI responsibility                                |
| ----------------------- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| Understand Project      | Scan manifests, workspaces, scripts, tests, and tools                   | Explain ambiguity and summarize the profile      |
| Check for Test Cases    | Inspect frameworks, configuration, paths, scripts, and indexed evidence | Identify non-obvious conventions and likely gaps |
| Run Project             | Execute one accepted launch target, stream logs, and enforce cleanup    | Recommend the most likely target                 |
| Run Tests               | Execute accepted suites and normalize evidence                          | Recommend Relevant versus All                    |
| Verify Changes          | Inspect Git changes and execute the approved quick plan                 | Advise which approved checks appear relevant     |
| Full Verification       | Execute the accepted full plan                                          | Explain strategy and results                     |
| Review / Customize Plan | Validate, diff, persist, and approve policy                             | Explain or propose changes                       |

Execution rules:

- Commands come only from accepted policy. Novel AI-derived commands remain pending until reviewed.
- Known launch adapters constrain previews to loopback. An unconstrained target requires an explicit
  advanced override.
- Run Project never installs dependencies automatically.
- Every long action exposes status, logs, and Stop.
- Stop cancels the correlated operation, performs bounded process-tree cleanup, and records the
  correct terminal state.
- An ambiguous monorepo asks the user to select a target rather than guessing.

Acceptance:

- Every action works through desktop → Tauri → core → bundled sidecar.
- Relevant and All select the intended suites.
- Verification actions preserve deterministic PASS/WARN/BLOCK and run history.
- Cancellation leaves no owned process or descendant orphaned.
- The packaged application remains Node-independent. A target repository may still require its own
  declared development runtime.

Static sites use an approved built-in loopback preview target for a detected `index.html`; detection
alone never starts the server. A Vite `index.html` remains framework evidence rather than being
misclassified as a plain static site. A repository with multiple credible workspace or launch
targets remains ambiguous until the user selects one.

### Iteration 9 — AI-Assisted Configuration and Explanation

**Goal:** let users change policy naturally without hidden mutation.

Deliver:

- constrained natural-language-to-configuration proposals;
- plain-language explanations and exact YAML diffs;
- schema, command-policy, configuration-revision, and approval validation;
- explicit acceptance followed by atomic persistence;
- explanations for failures, selected/skipped checks, gates, and missing coverage.

Acceptance:

- Supported preferences produce valid, reviewable patches.
- Invalid, unsafe, stale, or unsupported proposals cannot be applied.
- Declining a proposal leaves configuration and approval state unchanged.
- Explanations visibly separate deterministic evidence from AI inference.
- Source modification and test generation remain out of scope.

### Later iterations

1. Deterministic change-risk and affected-test planning.
2. Deeper code intelligence, indexing, and dependency graphs.
3. AI-assisted risk and relevant-test planning.
4. Native execution/normalization adapters where richer evidence provides proven value.
5. Sandboxed test generation in temporary worktrees.
6. Hardware and model advisor.
7. MCP and broader CI interfaces after the contracts stabilize.
8. Controlled autonomy only after earlier advisory workflows prove safe.

## Original-roadmap reconciliation

- Original Iteration 5 is split: detection becomes Iteration 5 sensor work; richer execution
  adapters move to the point where smart tasks need them.
- Original Iteration 6 risk work moves later so project understanding and usable actions come first.
- Original Iteration 7 deterministic planning becomes revised Iteration 6.
- Original Iteration 8 provider foundation becomes revised Iteration 7 and expands into project
  understanding.
- Original Iteration 9 AI risk is deferred; revised Iteration 9 focuses on configuration and
  explanation.
- Deep intelligence, AI risk, test generation, MCP, and autonomy remain valid but follow the
  corrected core experience.

## Action availability by iteration

| Action                  | First useful iteration | Behavior before/without AI                                      | Later AI enhancement                                      |
| ----------------------- | ---------------------- | --------------------------------------------------------------- | --------------------------------------------------------- |
| Understand Project      | 5                      | Refresh and display the deterministic profile and evidence      | Summarize ambiguity and recommend next steps in 7         |
| Verify Changes          | 6                      | Build and execute an approved deterministic quick plan          | Advise among approved checks in 7                         |
| Full Verification       | 6                      | Execute the approved full plan                                  | Explain strategy and evidence in 8/9                      |
| Review / Customize Plan | 6                      | Review commands, reasons, migration, overrides, and approval    | Propose and explain policy edits in 9                     |
| Check for Test Cases    | 8                      | Run bounded deterministic test discovery with progress and Stop | Interpret non-obvious conventions and gaps when available |
| Run Tests               | 8                      | Execute approved Relevant, All, or selected suites              | Recommend a choice without expanding authority            |
| Run Project             | 8                      | Launch one approved contained target with logs and Stop         | Recommend a target without launching it                   |

Actions remain hidden, disabled, or annotated until their required profile, policy, and approval
state exists. Provider state affects only the separately labeled AI enhancement. That enhancement is
omitted—not treated as an error—when Ollama is unavailable.

Technical project, Git, command, output, gate, cancellation, and history panels remain below the
simple action area rather than acting as prerequisites for it.

## Validation strategy

- Golden fixtures for static sites, supported Node and Python stacks, mixed repositories, malformed
  metadata, and monorepos.
- Sensor contract tests for evidence, confidence, missing tools, failure isolation, and cancellation.
- Configuration parsing, migration, stale-edit, atomic-write, approval-digest, existing-data, and
  rollback tests.
- Protocol compatibility tests proving every v0.1.0 request retains its existing meaning.
- Core/CLI/desktop equivalence tests for profiles, plans, runs, gates, and cancellation.
- Deterministic mock-provider tests plus opt-in live Ollama tests.
- Security tests for command injection, unapproved policy, context leakage, loopback enforcement,
  and dependency-install attempts.
- Windows process-tree tests for analysis, testing, and launch cancellation.
- Packaged outside-checkout smoke tests with Node absent from the application's runtime PATH.
- Retain format, lint, typecheck, test, build, locked Rust, strict Clippy, Rust test, Tauri/NSIS, and
  hosted Windows CI gates.

## Decision record gate

TASK-014 may start only after the following decision records are accepted:

- product hierarchy and advisory AI authority;
- project sensors versus execution adapters;
- configuration v2 and local approval receipts;
- general cancellable-operation protocol;
- Ollama isolation, context privacy, and AI workflow versioning;
- approved launch targets and process ownership.

Approved planning defaults are a fast deterministic scan on open, AI beginning in Iteration 7,
Ollama as the first provider, explicit schema-v2 migration, approval once per executable-policy
digest, and approved loopback launch targets without automatic dependency installation.

ADR-009 through ADR-014 record these accepted decisions. Starting TASK-014 remains a separate
implementation action and is not part of this roadmap-reset milestone.

No product decisions remain open for TASK-014. Exact version-2 field syntax and later smart-action
presentation details are intentionally deferred to their iteration tasks; changing the authority,
approval, privacy, protocol-compatibility, or launch boundaries requires a superseding ADR.
