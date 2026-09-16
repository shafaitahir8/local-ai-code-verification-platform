# TASK-016: Reviewable Project Policy Migration (Iteration 6 Slice 6B)

## Status

Complete. This task ends at an explicit, read-only v1-to-v2 preview and a guarded atomic apply.
Command approval and smart-plan execution remain later work.

## Goal

For a configured single-root repository, preserve the existing schema-v1 policy until the user
reviews an exact YAML diff and explicitly accepts migration. Expose the same preview/apply operation
through core, protocol-v1 additive methods, CLI, and desktop.

## Schema-v2 boundary

Version 2 retains `project.name` and every named `suites` entry with its version-1 command,
type, failure policy, and timeout semantics. It adds:

```yaml
version: 2
project:
  name: example
suites: {} # unchanged named suites
plans:
  quick:
    suites: [] # existing test/lint suite IDs proposed by migration
  full:
    suites: [] # every existing suite ID proposed by migration
launch_targets: {} # declared launch policy; not approved or executable in 6B
discovery:
  exclusions: [] # repository-relative exclusions; not consumed in 6B
overrides: {} # explicit user overrides; not consumed in 6B
```

The last three fields are empty in this slice and non-empty values fail validation until their
rules and effects are implemented in a later task. This prevents a policy field from silently
claiming an effect that this binary does not provide. Quick/Full membership is a deterministic
proposal from existing suites, not an accepted executable plan or approval receipt. A future
configuration task may extend version 2 additively, but cannot reinterpret these fields silently.

## Preview and apply

- Preview reads the raw source bytes, validates schema v1, and returns source/target versions,
  SHA-256 source and target digests, the complete proposed YAML, a deterministic exact unified
  diff, and a human explanation of the proposed suite membership. It writes nothing.
- Preserve existing project, suite values, and comments where the YAML parser can represent them.
  Do not invent a command, target, exclusion, or override.
- Apply requires the reviewed source and target digests. It regenerates and revalidates the target
  server-side; the caller never supplies executable target YAML.
- Reject a changed source byte-for-byte as stale, including comment-only edits. Reject unsupported,
  missing, malformed, or symbolic source paths safely.
- Write a synced sibling temporary file and atomically replace the source only after a final digest
  check; clean up a failed temporary file. A failed apply leaves the original valid source intact.
- Applying migration does not approve commands, persist a receipt, run a suite, or mutate SQLite.
- Schema-v1 parsing and `config.get` stay strict and unchanged. Add version-aware policy inspection
  separately so the desktop can reopen a migrated repository. Legacy configured verification must
  retain its v1 behavior; if it can read v2 suites, it must not execute plan membership or targets.

## Interfaces

- Core resolves the canonical repository root and delegates migration/inspection through a narrow
  configuration port. Interfaces do not calculate the migration or the diff.
- Protocol version 1 adds configuration-policy inspection and migration preview/apply methods;
  existing strict methods and cancellation semantics are unchanged.
- CLI provides `verify config migrate [repository] [--json]` for preview and a separate explicit
  `--apply --expected-digest <source> --expected-target-digest <target>` flow.
- Desktop shows current/target version, summary, exact diff, and Apply Migration. A stale conflict
  is explicit. Selecting another repository prevents old preview/apply results from replacing its
  state. No migration is triggered merely by opening a repository.

## Non-goals

Approval receipts, smart-plan execution or persistence, schema-v2 launch/exclusion/override
editing, AI/Ollama, Run Project, smart Run Tests, risk analysis, and test generation.

## Acceptance

- Existing v1 fixtures parse, inspect, and run exactly as before; v2 is never written on open.
- Preview produces an exact deterministic diff and changes no repository/config/database files.
- Explicit apply is atomic and rejects stale source and target revisions without overwriting.
- Malformed, missing, symbolic, and unsupported policy fails closed.
- Core, protocol, CLI, and desktop expose equivalent preview/apply results.
- Existing 6A plan preview, verification gates/history, and protocol-v1 methods remain compatible.
- No discovered or migrated command is executed by the migration path.
- Sequential format, lint, typecheck, tests, build, `git diff --check`, and affected native checks
  pass before the slice is considered complete.

## Validation and limitation

The full sequential workspace format, lint, typecheck, test, and build gates passed on 2026-09-16.
Focused coverage proves deterministic no-write preview, exact diff reconstruction, comment-only
stale rejection, target-revision rejection, symbolic/malformed/unsupported safety, atomic replace
cleanup after simulated failure, core/protocol/CLI equivalence, deliberate desktop apply, and
unchanged 6A planning across a real Node/Vite/Vitest migration. No Rust/native source changed, so
native packaging was intentionally not rerun. Version 2 launch targets, exclusions, overrides,
approval receipts, and smart execution remain non-operational later slices.
