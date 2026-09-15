# TASK-015: Automatic Verification Plan Preview

## Status

Complete. This task covers only Iteration 6 slice 6A; later planning execution, configuration
migration, and approval work remain separate.

## Goal

Turn one bounded deterministic project profile into reviewable Quick and Full verification-plan
previews. The first supported input is a complete, unambiguous, single-root Node/Vite/Vitest
profile. The preview must identify selected and skipped observed checks, explain every decision,
and retain the source task, capability, and evidence references.

## Non-goals

- Executing a proposed check or converting it into approved policy.
- Persisting plans, approval receipts, profile data, or verification history.
- Changing or migrating `.verify/project.yml` schema version 1.
- Inspecting Git changes or performing affected-test selection.
- Adding AI/Ollama, smart Run Project/Run Tests actions, risk analysis, or test generation.
- Planning Python, Jest, static-site, mixed-project, or monorepo targets in this slice.

## Contract and rules

- `VerificationPlan` is a versioned portable domain record with `quick` or `full` mode, a
  deterministic readiness status, profile-version/time provenance, and separate selected/skipped
  decisions.
- A decision copies its command, working directory, and label from one observed
  `ProjectTaskCandidate`; it never synthesizes a command or execution policy.
- Each decision records the source candidate, supporting capabilities/evidence, and a
  human-readable reason.
- Slice 6A requires a complete, ambiguity-free profile with confirmed Node, Vite, and Vitest
  capabilities and one root workspace. Unsupported, partial, or ambiguous profiles produce no
  selected checks.
- Quick selects one confirmed root test and lint candidate. Typecheck and build remain visible but
  skipped with an explicit Quick-mode reason.
- Full selects one confirmed root test, lint, typecheck, and build candidate when each has matching
  confirmed capability evidence.
- Multiple credible candidates of one kind are skipped rather than guessed.
- The profile scan remains cancellable. A cancelled scan produces no preview; the planner itself is
  pure, bounded, and non-executing.

No stable profile digest exists yet. Slice 6A records the profile contract version and generation
time rather than inventing a digest. Configuration revisions and executable-policy digests belong
to the later migration/approval slice.

## Interfaces

- Core owns the pure planner and the one-shot profile-to-preview use case.
- Protocol version 1 adds one method without changing existing methods or results.
- CLI adds `verify plan [repository] [--json]` and shows both Quick and Full previews.
- Desktop displays the same normalized preview with simple decisions first and evidence/reasons
  underneath. It exposes no Run, Apply, Approve, or Save action.

## Acceptance

- The Node/Vite/Vitest fixture produces meaningfully different Quick and Full previews.
- Every returned check is copied from an observed task candidate and has a reason and source
  references.
- Missing, partial, ambiguous, and no-check profiles fail closed without invented selections.
- Core, protocol, CLI, and desktop expose equivalent plan records.
- Planning executes no command and writes no repository, configuration, or database state.
- Existing protocol-v1, profiling, configured verification, cancellation, persistence, and gate
  behavior remains unchanged.
- Format, lint, typecheck, tests, build, and `git diff --check` pass.

## Validation and limitation

The full sequential workspace gate passed on 2026-09-15, including core/protocol/CLI/desktop
equivalence and the unchanged configured-verification regression path. Native Rust format, locked
check, strict Clippy, and locked tests also passed for method-aware cancellation routing. A fresh
installed Windows package was not built or smoke-tested for this preview-only slice, so these
checks do not make a new packaged-app release claim.
