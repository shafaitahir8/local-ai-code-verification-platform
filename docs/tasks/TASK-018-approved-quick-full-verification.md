# TASK-018: Approved Quick/Full Verification (Iteration 6 Slice 6D)

## Status

Complete. Named schema-v2 Quick/Full suites execute through the existing verification core only
when a current local approval receipt authorizes the exact executable policy. The final Windows
package passed the installed outside-checkout workflow, including fail-closed approval, persisted
cancellation, legacy gates/history, and no-Node runtime checks. This slice adds no AI, launch
targets, or second command runner.

## Goal

Turn reviewed schema-v2 Quick and Full membership into deterministic verification actions, while
preserving legacy `verify run`, PASS/WARN/BLOCK, persisted history, and cancellation behavior.

## Execution authority

- Resolve the canonical Git root, load and validate the durable schema-v2 policy, compute its
  current semantic executable-policy digest, and compare the local active receipt at execution
  time. A cached status or earlier preview is never authority.
- Reject missing, invalid, or version-1 policy; absent, revoked, or outdated receipt; and missing,
  empty, or unresolved suite membership before starting a project command or saving a run.
- Select only named suites in the requested mode, in policy membership order, from the same
  validated policy snapshot whose digest was authorized. Never synthesize a command from profile or
  AI evidence, and never auto-approve.
- Pass selected suites through the existing verification runner, gate evaluator, run repository,
  and process/cancellation controls. A cancelled action persists a cancelled BLOCK run.
- Recheck current authorization immediately before handing selected suites to the runner. No
  change to legacy configured `verification.run` semantics is permitted.

## Interfaces

- Add an additive protocol-v1 plan-run request/result with Quick/Full mode. Preserve existing
  events, correlated cancellation, terminal run result, and all older method meanings.
- Add CLI Quick and Full actions with the current exit-code and JSON conventions.
- Add clear desktop Quick/Verify Changes and Full Verification actions, showing current approval
  state and a review path when unavailable. React and Rust do not choose suites or authorize work.

## Non-goals

Automatic policy writing, new approval semantics, AI/Ollama, Run Project, standalone smart Run
Tests, risk scoring, test generation, natural-language configuration, and Iteration 7 work.

## Acceptance

- Approved Quick runs only Quick suite IDs; approved Full runs only Full IDs and preserves order.
- Every fail-closed case above starts no check and persists no synthetic verification run.
- Editing any executable policy field after approval requires explicit reapproval.
- Cancellation, PASS/WARN/BLOCK, history, and CLI/desktop/core/protocol equivalence use the
  existing deterministic execution path.
- A cancellation accepted while approved-run authorization is pending executes no command and
  persists one empty cancelled BLOCK run, preserving the existing verification-cancellation
  terminal contract without granting policy approval.
- Version-1 and existing configured verification, profile, plan preview, migration, and approval
  contracts continue to behave as before.
- Full workspace and applicable Rust/native/package validation pass before closing the slice.
